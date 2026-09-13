# 内存分析技巧（实战总结）

> 来源：2026-09-13「渲染进程 700-900MB、疑似 v0.11.8 之后变重」的完整排查。
> 结论先放这里：**JS 堆只占 ~100MB，其余全是 Chromium/Monaco 引擎内部结构**——
> 走错层（只看 JS 堆）会得出"没有泄漏"的错误结论。下面按"层"给出工具与判读法。

## 0. 心智模型：内存分四层，别混层

| 层 | 内容 | 能看到它的工具 |
|---|---|---|
| JS 堆（主 isolate） | 应用对象、字符串、消息数据 | `performance.memory`、堆快照 |
| Worker 堆 | Monaco TS worker（全量 lib.d.ts）、分词正则 | **只有内存转储**（`performance.memory` 不含） |
| Blink/渲染 | DOM、CSS 值、字形轮廓、合成瓦片 | 内存转储 |
| 引擎池/缓存 | PartitionAlloc 池、V8 池、代码缓存 | 内存转储；**提交后不归还 OS，只有重启回收** |

实测构成参考（渲染进程 private 928MB）：稀疏引擎池 314MB / Blink CSS 值 49MB /
Skia 字形轮廓 42MB / 代码缓存 46MB / TS worker + Monaco 语言包 ~60MB /
WebGL 8MB / 其余长尾 ~340MB / **JS 堆仅 ~100MB**。

## 1. 第一层：进程观测（PowerShell，零侵入）

```powershell
# 进程角色 + 内存（用 --type= 区分 browser/gpu/renderer/utility）
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Vibe IDE.exe' } | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId
  $Typ = if ($_.CommandLine -match '--type=([a-z-]+)') { $matches[1] } else { 'browser(main)' }
  $Typ + ' pid=' + $_.ProcessId + ' ws=' + [math]::Round($p.WorkingSet64/1MB) + 'MB private=' + [math]::Round($p.PrivateMemorySize64/1MB) + 'MB'
}

# 每线程 CPU 差分 → 定位烧 CPU 的线程（渲染主线程 tid 可在 trace 的 thread_name 里对上名）
$p = Get-Process -Id <pid>; $t1 = @{}; $p.Threads | % { $t1[$_.Id] = $_.TotalProcessorTime.TotalSeconds }
Start-Sleep 8; $p.Refresh()
$p.Threads | % { $d = $_.TotalProcessorTime.TotalSeconds - $t1[$_.Id]; if ($d -gt 0.5) { "tid=$($_.Id) +$([math]::Round($d,1))s" } }
```

判读与坑：
- **private bytes > working set** 是常态；对比一律用 PrivateMemorySize64（WS 波动可达 ±200MB）
- ⚠️ **先核对"进程数+角色"再对比总数**——多出来的进程最容易伪装成"内存变多"：
  DevTools 渲染器 ~240MB + tracing 服务 ~106MB（开过一次 DevTools 就留驻）。本案例
  用户看到的"大了 300MB"就是这两个。
- 单进程燃烧但子进程全闲 → 是渲染层自身空转（IPC/动画/引擎），不是业务在干活

## 2. 第二层：可调试实例（无侵入，不动正在用的 app）

```powershell
# 复制 user-data-dir 副本（单实例锁按目录隔离，副本可并行跑）
robocopy "$env:APPDATA\<产品>-<hash>" "$env:TEMP\probe" /E /XD "Cache" "Code Cache" "GPUCache" /R:0 /W:0
Start-Process <electron.exe 或打包 exe> -ArgumentList '--remote-debugging-port=9223','--enable-precise-memory-info','--no-sandbox',"--user-data-dir=$env:TEMP\probe",'<appDir>'
```

- 打包版没有 DevTools 自动打开的问题；**未打包（electron.exe + 目录）`is.dev=true` 会自动
  `openDevTools()`** —— ⚠️ 会污染一切对比。临时在 out/main/index.js 里把条件改成
  `if (false && utils.is.dev)`（每次 `npm run build` 都会冲掉，重建后要重打）
- `--enable-precise-memory-info` 必须加，否则 `performance.memory` 是量化值（对比无意义）
- 探针脚本（`scripts/`）：
  - `probe-snapshot.mjs <port>` — 所有进程内存表 + JS 堆
  - `probe-gui-idle.mjs` — 注入会话列表复刻"恢复场景"并按 30s 采样
  - `probe-open-tabs.mjs` — 连开 N 个文件 tab 的增量成本
  - `probe-anim-growth.mjs` — 注入全套动画测增长（本次用于**证伪**动画假设）
  - `probe-fix-verify.mjs` — 行为验证（启动不加载/点击才加载）

## 3. 第三层：堆快照（只管 JS 侧）

DevTools → Memory → Heap snapshot → `node scripts/analyze-heap.mjs <file.heapsnapshot>`
（self/retained 尺寸 top30）

- 适用：确认 JS 堆大小、找大对象/异常引用
- 局限：**native/Blink/Worker 全不可见**。本案例 928MB private 里堆只有 100MB——
  快照"干净"≠没有内存问题
- 经验值：本 app 渲染进程 JS 堆 60-100MB 属正常区间

## 4. 第四层：内存转储（native 真相）★ 杀器

生成（两种都不需要杀进程）：
- Task Manager → 右键进程 → 创建转储文件（完整）
- `rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump <pid> <path> full`

⚠️ 坑：
- comsvcs 转储文件 **ACL 受限**，读取前 `icacls <file> /grant "%USERNAME%":(R)`
- comsvcs 转储**没有 MemoryInfoListStream** → `dmp-peek.mjs` 会自动 fallback 到
  Memory64List（把 PE 镜像挑出来，其余按区域大小排序）

解析：
- `node scripts/analyze-dmp.mjs <file.dmp>` — 进程计数/模块/top 已提交区域
- `node scripts/dmp-peek.mjs <file.dmp> --scan 15` — 最大私有区域 + 内容指纹
- `node scripts/dmp-peek.mjs <file.dmp> <VAhex> [lenMB]` — 单区域 hex + 字符串

**区域指纹速查（用来认出"是谁的内存"）**：

| 指纹 | 身份 |
|---|---|
| 90-100% 全零 + 稀疏指针 | 引擎分配池的已提交未用页（不归还 OS） |
| `-internal-auto-base(...)` 字符串 | Blink CSS 值存储 |
| 长 `M…c…` 曲线路径串 | Skia 字形轮廓缓存（CJK 文本多时显著） |
| `@typescript/lib-*.d.ts` 路径 | Monaco TS worker 类型库 |
| `new ErrorHandler…` / `__vite__mapDeps` | 脚本源码 / 代码缓存 |
| `bufferData` / `texImage2D` | WebGL / ANGLE 层 |

**对比法（最有效的增长归属）**：同一 app「启动转储 vs 使用后转储」对比同一结构的
大小——本案例一块稀疏池 30MB → 314MB，一眼定位增长大头。

## 5. 第五层：A/B 复现协议（版本/改动对比）

```bash
git worktree add ../app-old <旧 commit>
powershell -Command 'New-Item -ItemType Junction -Path "..\app-old\node_modules" -Target "<repo>\node_modules"'
(cd ../app-old && npm run build)   # 各版本独立构建，互不污染
node scripts/ab-boot-mem.ps1       # 干净启动 A/B：每版 2 轮 × 固定采样点，只比 private
```

- **注入式场景复刻**：直接写 `localStorage['vibe-ide-open-sessions']` 注入会话列表 +
  `Page.reload`，比重启真实 app 更可控（可指定 kind/resumeSessionId/loaded 等）
- ⚠️ 最大的坑：**对比前确认两侧构建产物状态一致**（DevTools 补丁、构建时间、参数）。
  本案例曾因一侧补丁被重建冲掉，测出"+300MB"的假差异——真实只有 +40MB。
- 每侧跑 2 轮以上，固定采样时点（如 +25s/+55s），否则单次采样会被启动抖动带偏

## 6. 证伪清单（本次已实测排除，别再走弯路）

- 终端输出 / Claude TUI 动画：20Hz 注入 = 渲染主线程 1%
- 桌宠 / 常驻 CSS 动画（mascot/shimmer/glow/sprite）：全量注入 2 分钟，内存**反降 52MB**
- 关闭文件 tab / 切换会话：释放逻辑内存，但进程内存不回（引擎池截留）
- 文件 tab 保活 vs 逐个替换（单编辑器）：A/B 增量一样（+215 vs +202MB）
- "在 JS 堆里找 700MB"——方向错误（堆只有 100MB）
- 文件图标 / cwd 精灵静态图标 / 左栏重复面板：KB 级/个，千级元素 ≈ 1-3MB（§6b）

## 6b. 四怀疑点实测（2026-09-13 晚，打包版 + 全新 profile + CDP 注入 14 个 cwd 组）

同一文档内 A/B（种子注入后不 reload）：6s 空转漂移 0.0MB，可分辨 ≥1MB 效应；**跨 reload
摆动 ±50MB（引擎池），小效应只能同文档比**。探针：`probe-suspects2/3.mjs` + `probe-run-suspects2/3.ps1`。

| 因素 | 实测 | 结论 |
|---|---|---|
| 文件名图标（FileIcon 内联 svg） | 1000 个克隆 +1.4MB（≈1.4KB/个） | 真实可见 ~200 个 ≈ 0.3MB，可忽略 |
| cwd 精灵静态 | 500 个 +1.0MB（≈2KB/个） | 可忽略 |
| cwd 精灵**动画中**（pixel-mascot-active） | 50/150/300 个 → +7.7/+21.6/+41.0MB，**线性 ≈130-150KB/个** | 真实 running 组数个位数 → ≲1MB；但"同时动画的元素数"是乘数 |
| 文件树展开行 | 83 行 ≈ +1~3MB（行 ~10KB：文本 glyph + 图标 + React 状态） | 千级行才到十 MB 级 |
| 左栏 Git/Dir 重复实例 | 挂载 +1.3MB（Dir）/ ~0（Git，~76 节点）；两侧同展开 → 树行翻倍 ≈1MB/83 行 | 内存 1-3MB；重复**拉取**开销已由 36162988 门控 |
| 开文件 tab（Monaco） | 首个 tab **+110MB**（净文档）/ +155MB（含 diff 场景）；第 2 个起边际 ≈0-1MB native、+1MB heap/个；全部关闭仅回收 ~0.2MB | 成本在"首次启用编辑器栈"，与 tab 数/保活策略无关（与 §6 A/B 一致） |

**排序（影响 renderer private 大小）**：Monaco/TS 编辑栈（一次性 +110~155MB）> 已加载对话
（§7，单个 6MB 会话 +35MB，多个非线性）> 引擎池只增不回（±50MB 摆动、关 tab/reload 不回吐）
> 同时动画的元素数（~140KB/个，仅当数量上规模）> 静态 DOM/图标/精灵（KB 级/个，常被池余量吸收显示 0 增长）。

**新判读点**：动画元素的单价（~140KB）是静态元素（~2KB）的 ~70 倍——"常驻动画"本身不贵（§6 已证伪），
贵的是**同时在动画的元素数量**；排查动画相关内存先数 `document.getAnimations()` 的目标元素数。

## 6c. 首开 Monaco 的代价是版本无关的固定成本（老版 vs 多 tab 版 A/B）

问题："打开 Monaco 一直有代价，那多 tab 化（FileTabsView, e0c60554）是不是把内存搞大了？"
同协议实测（同 5 个文件、同树展开路径、全新 profile、打包版）：

| 阶段 | 老版 ce893030（多 tab 前） | HEAD（FileTabsView） |
|---|---|---|
| boot+seed（14 会话组） | 168.8MB | 186.3MB |
| 树展开后 | 171.8MB（dom 1268） | 177.1MB（dom 1280） |
| 开第 1 个文件（Monaco） | **+83.8MB**（monaco=1） | **+89.3MB**（monaco=1） |
| 第 2~5 个文件 | +3.9 / +16.4 / -8.2 / -1.2 | +3.4 / +13.2 / +2.7 / -8.3 |
| 5 个文件后合计 | **+94.7MB** → 266.5MB | **+100.2MB** → 277.3MB |
| DOM 行为 | 每次开文件重挂载 DiffViewer（dom 1450~1613 波动，monaco 恒=1） | tab 保活（dom 单调 +65/个，monaco 逐个递增） |

**结论**：首开 Monaco ≈ +85~90MB（Monaco 运行时 + TS worker + 语言服务 + V8 代码缓存）在
两个架构下**一样贵**；多 tab 化的进程内存影响 ≈ 5MB/5 文件（噪声级），差别只在 DOM 与交互行为
（保活 vs 重挂载）。"每 tab 一个 Monaco 实例"的边际成本被"老版重挂载 churn"抵消。

工程坑：worktree 里用 junction 复用 node_modules 时 **electron-builder 会报
`<主仓库路径> must be under <worktree>`**（`node_modules/@deepseek-ai/*` 是 workspace symlink
绝对指向主仓库 vendor/harness）。打包 A/B 需要 robocopy 真实拷贝 node_modules（~1.5GB，junction
会被跟随展开成真目录）；或用 electron.exe 直接跑（但 --user-data-dir 对 dev electron 无效）。

## 6c. 启动基线回归的证伪（2026-09-13 晚，等值协议）

**结论：v0.11.8 → HEAD 的"启动基线 +69MB"是条件不一致造成的假差异；等值协议下两侧一致。**

等值协议（`scripts/boot-ab.ps1` + `probe-cdp-inject.mjs`）：全新 profile → 启动 → CDP 注入同一组
`loaded:false` 会话 → `Page.reload` → 固定点采样（+25s/+55s，分角色 private）。两侧各 3-4 轮：

| 版本 | 渲染 +25s | 渲染 +55s | 全进程合计 |
|---|---|---|---|
| v0.11.8 (bf938cd2) | 150/152/167 → 中位 **152** | 142/146/167 → 中位 **146** | 433~516 |
| HEAD | 151/152/152/177 → 中位 **152** | 132/144/144/159 → 中位 **144** | 422~505 |

差异都在跑间噪声（±25MB，GPU 进程 88 vs 145MB 双模态带动渲染进程同向波动）内。**无回归。**

**旧数字（144 → 213）的根因**：老版 `sessionRestore` 对 gui tab 是 `loaded: !!t.loaded`（保留持久化值），
HEAD 是 `loaded: false`（强制）。用"带 loaded:true 的真实 profile"启动时：老版会**开机 auto-resume 对话**
（复现：v0.11.8 = 243MB vs HEAD = 216MB，老版反而更大）；而早前 HEAD=213 的采样发生在 523e6c2d 修掉
开机自动加载**之前**。两笔叠在一起造出"+69MB"。

**教训（extends §5）**：跨版本比启动基线，seed profile 必须两边行为等价——含 `loaded:true` 的 seed 会被
老/新版本区别对待；跨 reload 采样有 ±50MB 系统性偏移，两侧必须同协议。

## 6d. 内存构成总览（2026-09-13 全部实测汇总，口径 = private bytes）

**启动态**（等值协议，无对话加载；v0.11.8 与 HEAD 相同）：

| 进程 | 实测 |
|---|---|
| 渲染 | 144~152MB（+55s 中位；JS 堆 ~55-66MB，其余=Monaco 预载/React/CSS/字体/引擎池） |
| 主进程 | ~190MB（**未拆**，含 git/watcher/codegraph/会话缓存，下一步方向） |
| GPU | 88~145MB（跑间双模态，疑两条初始化路径） |
| utility | 13MB |
| **合计** | **~435~505MB** |

**使用后水位**（真实场景 3 个 loaded 对话 + 开过文件 ≈ 渲染 660~830MB）：

| 增长项 | 单次实测 | 是否可回收 |
|---|---|---|
| 已加载对话 | 6.4MB 对话 = 峰值 +58MB / 常驻 +39MB；3 连非线性 +256MB | 否（无 unload 路径，切走仍常驻）|
| Monaco/TS 栈（首次开文件） | +85~155MB（视池余量；版本无关，老版相同）| 否 |
| 每个额外文件 tab | 边际 ≈0~1MB | 关 tab 回收 0~32MB |
| 引擎池（以上动作的副产物） | 删除 300 动画元素回 7/59MB；reload 摆动 ±50MB | 只有重启 |
| 引擎池长尾（转储 928MB 时） | 池 314 / Blink CSS 49 / Skia 字形 42 / 代码缓存 46 / TS worker ~60 / WebGL 8 / JS 堆 ~100 / 长尾 ~340 | - |

**逐项单价**（同文档 A/B，±1MB 精度）：文件图标 1.4KB/个 · cwd 精灵静态 2KB/个 · 精灵**动画中** ~140KB/个（乘数=同时动画元素数）· 文件树行 ~10KB/行 · 左栏重复 Git/Dir 实例 1~3MB。

**版本规律**：启动基线 v0.11.8 ≈ HEAD（§6c）；分水岭是 v0.11.1（081e57a1）会话持久化——此前重启清零，此后"恢复-常驻-累积"。老版（≤v0.11.8）恢复保留 `loaded:true` 会开机 auto-resume，HEAD 已改强制 false（523e6c2d）。

## 7. 本案例确认的真实结论

- **干净启动**：当前 HEAD 比 v0.11.8 (bf938cd2) 仅 **+40MB**（441/440 vs 481/480MB，两轮一致）
  ——⚠️ 该结论已被 §6c 等值复测推翻：两侧实为一致（差分来自采样条件，非版本）
- **真实差异路径**：`a2c59e75` 起"启动自动加载 active GUI 会话"（`loaded:false` + 
  `ensureSessionLoaded` effect）——同注入会话实测：v0.11.8 不挂载（jsHeap 61MB）
  vs HEAD 挂载并加载整段对话（87.5MB，private +110MB），**对话越大差越多**
- 使用中增长：引擎池/语言 worker/代码缓存，**只有重启渲染进程能回收**
  （修复方向参考：`App.tsx` 的 `bootActiveIdRef` 跳过启动恢复加载）
- `test/perf-file-switch.mjs` 的局限：只报 JS 堆（增长大头在堆外）+ 总内存阈值 500MB 过宽，
  大量真实增长会判 PASS
