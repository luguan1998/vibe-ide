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

生成（都不需要杀进程）：
- Task Manager → 右键进程 → 创建转储文件（完整）
- `rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump <pid> <path> full`（**需管理员**，非管理员静默失败）
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dump-process.ps1 -TargetPid <pid> -Out <file.dmp>`（dbghelp P/Invoke，**非管理员可用**，默认 0x802 = 全内存 + MemoryInfoListStream）

⚠️ 坑：
- comsvcs 转储文件 **ACL 受限**，读取前 `icacls <file> /grant "%USERNAME%":(R)`
- comsvcs 转储**没有 MemoryInfoListStream** → `dmp-peek.mjs` 会自动 fallback 到
  Memory64List（把 PE 镜像挑出来，其余按区域大小排序）

解析：
- `node scripts/analyze-dmp.mjs <file.dmp>` — 进程计数/模块/top 已提交区域
- `node scripts/dmp-peek.mjs <file.dmp> --scan 15` — 最大私有区域 + 内容指纹
- `node scripts/dmp-peek.mjs <file.dmp> --summary` — 全部已提交区域按内容分类汇总（private/mapped/image 分开；类别=sparse-pool/blink-css-values/font-file/exec-code/heap-other 等）
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
| GPU | 88~145MB（跑间双模态 → 见 §8.2：启动尖峰 425–465MB 后 20–30s 回落到 210–310MB，取样时机/窗口状态决定读数） |
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

---

## 8. GPU 进程与平台底盘校正（2026-09-19）

> 起因："GPU 进程 350–480MB 是不是可优化"。结论：**那个数字是启动尖峰，不是稳态；GPU 进程基本不是可优化项**。
> 口径：未打包 `out/` + 独立 `--user-data-dir` + CDP，本机 125% 缩放（device-scale-factor 1.5），
> 每状态 10–12 样本取中位数，**采样前等启动尖峰回落（≥30s）**。

### 8.1 平台底盘（先量底盘，再谈应用）

| 对照（同尺寸无边框 1400×900） | GPU WS | GPU private | 渲染 WS | 渲染 private |
|---|---|---|---|---|
| 裸 Electron 空窗口 | 161MB | 76MB | 107MB | 22MB |
| 裸 Electron + 仿 Vibe 布局（毛玻璃/阴影/圆角/CJK 文本/三栏） | 196MB | 112MB | 108MB | 24MB |

**UI 布局本身只值 +35MB**（毛玻璃 + 阴影 + 中文字形图集）。GPU 进程的大头是 Chromium/D3D11 平台税，不是我们的 CSS。

### 8.2 GPU 进程是"启动尖峰 + 缓慢回落"，双模态由此而来（修正 §6d 的"疑两条初始化路径"）

同一次启动内每 2s 采样（DevTools 按 dev 默认开着）：

| 时刻 | GPU WS | GPU private |
|---|---|---|
| t=0s | 304MB | 240MB |
| t=5s | 424MB | 327MB |
| t=14s | 344MB | 246MB |
| t=18s | 284MB | 186MB |
| t=23–41s | 279–283MB | 181–186MB |

1. 启动 0–10s 冲到 **425–465MB**（着色器编译、字形/纹理图集、compositor tile 分配），20–30s 回落并稳定在 210–310MB
2. **最小化不释放**（214 → 214MB），**恢复+聚焦会再抬一次水位**（214 → 309MB，+84MB private）
3. `peakWorkingSetSize` 会长期停在 426/464MB，容易被误读成"当前占用"
4. DevTools 在 GPU 侧只 **+24MB**（它的大头是那个独立渲染进程 220–310MB，见 §1 的判读坑）
5. 推论：**小于 50MB 的视觉效果改动淹没在这个抖动里**——本机同状态跨启动实测 GPU WS 从 234MB 到 381MB 都出现过

### 8.3 单会话边际成本（当前最大的可优化项）

`test/mem-probe.mjs` 实测：克隆 4 个会话后进程树 **+400MB**（4 × pwsh ≈ 100MB）+ 渲染 **+137MB**（≈34MB/会话）。

即 **+125~135MB/终端会话**，而恢复逻辑把它放大：保存 `loaded: true`（`src/renderer/src/App.tsx:2100`）、
恢复原样还原（`src/renderer/src/sessionRestore.ts:70`）→ 开机即给每个历史会话拉 pwsh 并全量挂载渲染。

### 8.4 桌宠（唯一值得留意的小项）

6 套精灵图全是 **1536×1872 静态 webp**（`pets/*/spritesheet.webp`），动画靠 CSS `steps()` 切 `background-position`，
不是动图。解码后常驻 RGBA ≈ **11MB/套**。默认开启（`getPetVisible()` 默认 true），关闭入口：AppearancePanel → Show Pet。
与 §6 的证伪一致：**动画本身不贵（关掉无可复现内存收益），贵的是"同时在动画的元素数"（~140KB/个）**。

### 8.5 补进工具箱：主进程 inspector 直连控制

```powershell
# 主进程也开 inspector，可在主进程里执行 require('electron')
electron.exe --inspect=9341 --remote-debugging-port=9281 --user-data-dir=$env:TEMP\probe <appDir> <workspace>
```

连 `http://127.0.0.1:9341/json/list` 的 node target，即可 `Runtime.evaluate`：

```js
const { BrowserWindow } = require('electron')
const w = BrowserWindow.getAllWindows()[0]
w.webContents.closeDevTools()   // 消除 dev-only 污染（比改 out/main/index.js 干净，重建不会冲掉）
w.minimize(); w.restore()       // 测合成层水分：最小化不释放，恢复会抬水位
```

### 8.6 旧结论勘误（`doc/memory_usage.md`，2026-06 对话记录）

该文仍是 2026-06 的原始记录（已在文首加勘误提示），其中被推翻的条目：

| 旧说法 | 实测 |
|---|---|
| "GPU 189–215MB = 多个 xterm WebGL 上下文"、"xterm WebGL 多上下文 ~200MB" | WebGL ≈11MB/终端（5 终端 vs DOM 渲染器差 55MB）；有终端与无会话欢迎页的 GPU 几乎一致。**推翻** |
| "空闲 800MB 主因排序：CodeGraph 170 + WebGL 200 + Chromium 100 + Vite 180 + MCP 58 + DevTools 80" | 正确排序见 §6d 与 §8.3：每会话 shell（100MB/个）> DevTools 渲染进程（220–310MB，dev-only）> 渲染进程非 JS 部分 > GPU 平台底盘。WebGL/动画不在主因里 |
| "主进程正常应 30–60MB，231MB 说明 CodeGraph 常驻" | 本机裸 Electron 主进程就 139MB（§8.1）；应用主进程 147–175MB。CodeGraph 增量可能真实存在，但基准错了 |
| "Monaco 是最大单点，常驻 100–200MB" | §6c 实测首开 Monaco +85~155MB（一次性，与 tab 数无关），非常驻 200MB |
| "Chromium 不归还内存，600MB 基线正常" | 方向对（引擎池 + 启动尖峰），但基线数值应改用 private/稳态口径：渲染 220–450MB + GPU 210–310MB（含 161MB 平台底盘） |
| "markdown 图片 base64 无上限" | 已修（改 `file://` 直读） |
| "CodeGraph 常驻主进程，可开关释放" | 有效，`code.setEnabled` 保留 |

### 8.7 可优化项排序（跨 §6d 与 §8 汇总）

| # | 改动 | 预期 | 代价 |
|---|---|---|---|
| 1 | 会话恢复不预启 PTY（恢复时 `loaded:false`，激活才 `ensureSessionLoaded`） | 会话数 × ~100MB | 首次切到该会话多 200–500ms spawn |
| 2 | dev 不自动开 DevTools（改环境变量/快捷键按需） | -220~310MB，并压低启动尖峰 | 调试时手动开 |
| 3 | 已加载对话常驻（§6d：6.4MB 对话 = 常驻 +39MB，3 连 +256MB，无 unload 路径） | 单会话几十 MB | 需设计对话/回退数据的落盘与卸载 |
| 4 | 不用桌宠就关掉 | ~11MB + 停常驻动画 | 无 |
| ⛔ | GPU 进程、无意义动画、毛玻璃、xterm WebGL | **不要动**（无稳定收益，见 §6/§8.2） | — |

## 9. 渲染进程 512MB 转储构成（2026-09-19 线上打包版实例）

对象：正在使用的 `dist/Vibe IDE-x64` 渲染进程（当时 1 个 cmd 终端会话；Get-Process private 530MB / ws 615MB）。
工具：`scripts/dump-process.ps1`（非管理员 dbghelp 全内存转储，0x802 带 MemoryInfoListStream）+ `dmp-peek --summary`。
转储内合计 1235.6MB = **PRIVATE 512MB**（任务管理器"内存"列口径）/ MAPPED 479MB / IMAGE 245MB。

**私有 512MB 构成（--summary 分类，后经 dmp-payload.mjs 修正"活数据"口径）**：

| 类别 | 大小 | 区域数 | 说明 |
|---|---|---|---|
| heap-other | 310.4MB | 1139 | JS 堆 + Blink 对象/资源缓存 + 长尾（此类别含大量半空池区，见下节载荷重估） |
| sparse-pool | 116.7MB | 185 | 已提交未用（最大单块 88.5MB）；只有重启回收。旧 928MB 案例为 314MB |
| blink-css-values | 68.5MB | 1 | 单个 CSS 值存储区（实际载荷仅 ~9MB） |
| 私有 exec（RWX JIT） | ~16MB | — | V8 编译代码（203.7MB exec-code 中减去 188MB 的 exe 映像页） |
| webgl / script-code-cache | ~0.4MB | 2 | 对比旧案例 WebGL 8MB / 代码缓存 46MB，大幅下降 |

**载荷重估（`scripts/dmp-payload.mjs`，每区 8 点 × 64KB 采样估算实际数据占比）**：

| 地址簇（推断归属） | committed | 实载荷（估） |
|---|---|---|
| 0x19b0…（V8 指针压缩 cage，4GB 对齐吻合） | 107.8MB | 60.6MB（56%） |
| 0x628c…（PartitionAlloc 大对象/超级页池） | **220.8MB** | **16.2MB（7%）** |
| 0x53dc…（PartitionAlloc 小对象池） | 131.6MB | 66.8MB（51%） |
| 0x7ff8…（V8 JIT code，RWX） | 15.8MB | 12.5MB |
| 其他簇 | ~36MB | ~18MB |
| **合计** | **511.9MB** | **~174MB（34%）** |

- 私有里只有 ~1/3 承载数据，~338MB 是已提交空容量（池）。**UI 显示占用大 ≠ 数据多**——重估前把 heap-other 当"活数据"会严重高估。
- JS 堆 ~60MB 与启动基线（§6d 的 55–66MB）持平：开一个对话并不显著撑大堆；"用着用着变大"主体是池容量只涨不缩。
- 空容量集中在 0x628c 簇（220MB 只用了 7%）：88.5MB 全零块、CSS 值区 68.5MB（载荷 ~9MB）都是它的成员。
- heap-other 内可直接归因的样本区（内容指纹）：Shiki/TextMate shell 语法正则表 12.5MB、KaTeX 符号表 8.3MB、
  Electron preload 模块表 8.3MB、Vite 模块地图与 Monaco js/ts 语言包脚本源 12.2MB、文档树文本（CLAUDE.md 内容）。
- **`@typescript/lib-*` 0MB —— ts worker 关闭在线上构建中确认生效**（对照旧案例 ~60MB）。

**非私有部分（任务管理器"内存"列不含，属本进程虚拟地址空间里的文件映射）**：
- IMAGE 245MB：其中 ~188MB 是 Vibe IDE.exe（Electron 主程序）映像的代码/只读页，全进程共享
- MAPPED 字体 354.8MB：25 个 ≥1MB 映射 = **9 个唯一字体文件（95.2MB）+ 249MB 重复映射**
  （SimSun×6、Noto Sans SC×6、msyh 常规×3/粗×2、Segoe UI Emoji×2、霞鹜文楷 GB×2…）。
  根因：**Chromium 已知 bug**——renderer 每次字体匹配请求都新开一个文件映射且整个进程生命周期不释放
  （issues.chromium.org/460405907；同类历史 BUG=430021 曾 mmap ~200 次致 OOM；上游修复=FontDataManager 加映射缓存）。
  影响面：文件后备页多份映射共享物理页、不进"专用工作集"，实际成本 ≈ 唯一字体驻留部分（全系统共享、可回收）+ 页表。
  本项目无 @font-face（grep 过），是 Chromium/DirectWrite 行为，应用侧无法修；Electron 升级含修复版本后收敛。
- mapped-other 120.7MB + nodata 60.3MB（54 区转储时不可达）

**判读**：与 §6d/§8 的旧构成相比无新增异常项；私有 = ~174MB 实数据（含 Monaco 预载/AI 渲染栈等常驻）+ ~338MB 池空容量。
字体/映像映射看似 700MB+ 但不进私有口径（其中字体重复映射是上游 bug，无害但可关注 Electron 升级）。

**后续（2026-09-19）**：字体重复映射 bug 的修复自 **Chromium M144** 起（"Use FontDataManager's typeface cache for
LegacyMakeTypeface" + mapped-file 缓存，2025-11-14 落地主线；源码 tag 验证 138/140/142 无修复，Electron 40 二进制含修复埋点
`Chrome.FontDataManager.NumMappedFiles`）→ **Electron 40 起修复**。2026-09-19 曾升级到 44.4.3 并完成验收，**当天回退至 37.10.3**
（用户决策：包体 +40MiB 不可接受；安全权衡已明示；回退用 `git restore` + `npm ci` 干净还原）。注意：Electron 44 起 npm 包取消 postinstall，二进制改为首次运行懒下载（`node_modules/electron/index.js`
→ install.js，走 .npmrc 的 electron_mirror）；验收方式 = 新构建运行后重跑 `dump-process.ps1` + `dmp-payload.mjs`，
重复映射应收敛到每字体文件 1 个。包体：exe 37=195MiB / 40=204MiB / 44=235MiB（纯 Chromium 体量增长，无开关可砍）；
locale 由项目自己的 `scripts/afterPack.js` 裁剪为 en-US/zh-CN 两枚（1.2MB vs 原装 49MB），与 Electron 版本无关。

**升级验收（2026-09-19）**：新打包版（Electron 44.4.3）渲染进程转储对比——字体映射从
25 区 / 9 唯一文件 / **重复 248.9MB** → 6 区 / 6 唯一文件 / **重复 0.0MB**（每字体恰好 1 个映射）。
private 口径无显著变化（该 bug 本就主要在共享映射侧，不进任务管理器"内存"列），本次升级的核心收益是
安全（37 已 EOL 8 个月）+ 消除上游映射泄漏；包体代价：exe 195→235MiB。（同日已回退，数据保留供未来再升级参考。）

## 10. "cwd 精灵/文件夹 svg 导致内存变大"的证伪（2026-09-19，干净启动同协议 A/B）

> 起因：用户反馈"没有 cwd 精灵图和丰富文件夹 svg 时内存不多"，怀疑 FileIcons 大调整（09-10/11）与
> 像素 cwd 精灵（09-12）把 renderer 内存搞大，且明确要求 "干净启动 + 很少会话" 场景下回答。
> 协议：dev electron（`electron.exe .` + WorkingDirectory + 独立 `--user-data-dir`，⚠️ 旧文档"对 dev electron
> 无效"实测有误——**有效**，可隔离 profile 并配合 `--remote-debugging-port` 直接用 CDP 连）+ 75s 稳态采样。

**A. 干净启动（全新 profile、0 会话）DOM 现场**（CDP 实测）：

    domNodes=129 · mascot svg=0 · file icon svg=1 · getAnimations=1 · CSS 规则 4523 · JS 堆 51MB
    renderer private ≈ 190MB（打包版探针）/ 177MB（HEAD dev 主窗口）

→ **精灵/图标元素在干净启动下根本不存在（0 个），贡献恒为 0**。190MB 全在堆外：Monaco 预载栈
（`main.tsx` 的 `import * as monaco` + getMonaco() 注册 16 主题/4 语言 tokenizer）、AI 渲染栈模块、
Blink CSS 值存储、引擎池。

**B. 版本 A/B**（同机器、同协议、先后各跑一次，v0.11.8 产物来自 worktree @ bf938cd2）：

| 版本 | renderer 主窗口 priv | renderer#2 priv（DevTools） |
|---|---|---|
| v0.11.8 bf938cd2（09-07，两功能**之前**） | **193MB** | 193–198MB |
| HEAD（09-19，两功能**之后**） | **177–178MB** | 179–206MB |

→ **新版不涨反降**（ts worker 全关 / mermaid 懒加载等优化的净效果）；"这两个 UI 功能导致内存增长"不成立。

**C. dev 模式的隐藏大头**：`src/main/index.ts:159-160` `if (is.dev) mainWindow.webContents.openDevTools()`
→ **每次 `npm run dev` 自动多开一个 renderer 进程**（DevTools 本体，实测 priv 179–206MB；运行中的 dev
实例里见过 375MB）。用户若在 dev 下使用，这 ~200MB 与任何 UI 功能无关，纯属开发模式开关
（修法：改环境变量/快捷键按需开，见 §8.7 #2）。

**D. 线上实例 310MB（打包版，1 gui + 1 dsh 会话）转储指纹**（dmp-peek，private 口径）：

    heap-other 172.5MB(n=973) + sparse-pool 106.7MB + blink-css-values 22.5MB + 私有 exec ~16MB

其中可归因的真实内容（区域字符串指纹）全部来自渲染栈、无一条来自左栏 UI：
- shiki 语言 chunk 源码（`javascript-EC1dc0zO.js` / `typescript-*.js` 等）12.2MB——AI 消息代码块高亮按需
  加载后**常驻模块缓存**
- katex / lucide-react / ruby / html chunk 5.6MB（同上，AI markdown 渲染栈）
- Monaco vscode 主题 CSS 变量区（10MB + 9.9MB 区，zero% 93–97% → 多为池空容量）、`ai-tab__*` 类名区 9MB
- 注：MAPPED 侧字体 323.3MB（44 区）仍是 Chromium 字体重复映射 bug，不进任务管理器"内存"列（§9）

**结论排序**（"干净启动就觉得大"）：开发模式 DevTools（+180~310MB，仅 dev）> 引擎池空容量
（sparse-pool ~107MB，只涨不缩、只有重启回收）> Monaco/shiki/KaTeX 预载栈（常驻 ~几十 MB 实数据）
≫ cwd 精灵 / 文件夹 svg（干净启动 0 元素，使用时 KB~MB 级）。

## 11. 打包版版本曲线（2026-09-19，"内存比以前大"的最终答复）

> 协议：**全部打包版**（dist 内历史包 + worktree @bf938cd2 现打包），`--user-data-dir` 独立 profile，
> 启动后 100s+ 稳态采样，同时记 priv / ws / wsPriv（任务管理器"内存"列口径）。
> 教训：**用户报告的内存问题一律按打包版回答**——本次先拿 dev 实例（DevTools/Vite 污染）作答被直接否定。

| 版本（打包时间） | renderer priv | wsPriv | 主进程 priv | GPU priv | JS 堆 | CSS 规则 | DOM 节点 |
|---|---|---|---|---|---|---|---|
| 0.10.7（08-12） | **89.9MB** | 78.3 | 56.9 | 114 | 35.6 | 2123 | 85 |
| v0.11.8（09-07，两功能之前） | **155.7MB** | 142.3 | 100.6 | 111 | — | — | — |
| 0.12.1（09-19，含两功能） | **153.8MB** | 140.9 | 104.2 | 127 | 51 | 4523 | 129 |

**结论**：renderer 增长段在 **0.10.7 → v0.11.8**（8 月中~9 月初的 0.11.x 演进，**+66MB**）；
**v0.11.8 → 0.12.1 零增长（-2MB）**。FileIcons（09-10）/cwd 精灵（09-12）上线时增长早已完成
→ **用户归因不成立，本次以打包版实测钉死**（与 §6b/§10 的证伪一致，但这次是用户认可的打包版口径）。

**构成对比**（同条件全新 profile 转储：0.10.7 = 92MB 实例 vs 0.12.1 = 163MB 实例）：

| 类别 | 0.10.7 | 0.12.1 | 差 |
|---|---|---|---|
| **heap-other** | **61.2MB（n=333）** | **134.1MB（n=712）** | **+72.9MB** |
| sparse-pool | 3.6 | 4.9 | +1.3 |
| blink-css-values | 10.3 | 8.5 | -1.8 |
| exec / font-mapped / mapped-other | 189/141/106 | 192/141/116 | ≈持平 |

→ 增长 = **Blink 对象/资源/模块字符串（≈57MB）+ JS 堆（+15.4MB）**；**不是引擎池**（干净启动池两版都低；
用户长跑实例的池 106MB 属时间累积，见 §9）。CSS 规则 2123→4523（+113%）是 CSSOM 上涨的直接注脚。

**新增模块**（0.10.7 asar 148 assets vs 0.12.1 244，`cmp-bundles` 对比）：**DshView（dsh 全套 GUI）、
KaTeX 全套字体（~60 个 woff/ttf）、mermaid 全族图表**、FileTabsView、更多主题/语言 chunk。

**主进程同向 +47MB**（56.9→104.2，未拆解）；用户看"整机/任务管理器总占用"时两者叠加 ≈ **+110MB**。

**遗留问题（下一步）**：0.10.7→v0.11.8 之间具体哪几笔提交贡献最大，需打中间版本包（0.11.0/0.11.1/0.11.5…）bisect；
候选：v0.11.1 会话模型统一（081e57a1）、dsh 全套、FileTabsView、主题扩充。测法可完全复用本次流程
（worktree + robocopy node_modules + @deepseek-ai junction 重建 + electron-builder 7z + probe-pack-ab.ps1，
注意 robocopy 用 MSYS_NO_PATHCONV=1 否则 /E 会被 git-bash 转义成路径；junction 目标须指向 worktree 内部）。

## 12. CSS 规则数 + dsh 预热的成本（2026-09-19，用户问"减少 global css 能否优化"）

**CSS 规则数 = CSSOM 对象数**：浏览器为每条"选择器+声明块"建立的对象（`document.styleSheets[i].cssRules`
可枚举；成本在 native 侧、不在 JS 堆）。0.12.1 干净启动 4523 条的来源：

| 来源 | 规则数 | 加载方式 |
|---|---|---|
| dsh UI 样式（context-*.css） | 2128 | 随 DshView 预热加载 |
| Tailwind + 项目 globals（index-*.css） | 1260 | index.html 静态 |
| Monaco 编辑器样式 | 1039 | index.html 静态 |
| 用户 snippets custom-css | 87 | 启动注入 |
| 桌宠 keyframes | 9 | 启动注入 |

**实测**（CDP 删除全部 styleSheet 元素 + HeapProfiler.collectGarbage ×2，60s 稳定复核）：renderer priv
**157.5 → 154.9MB，只降 2.6MB**（≈0.6KB/条；JS 堆 51.0MB 不变）。**结论：精简 CSS（含 CSS 变量/参数）
对内存收益上限 ~2.6MB，不值得做**。CSS 规则数翻倍（2123→4523）只是同期功能增长的伴生现象，非内存增长之因。

**顺藤摸出的真正可优化项**：`App.tsx:515` 启动后 3s idle 时**主动预热 DshView**
（`idle(() => import('./components/DshView'))`，注释注明为避免首次进 dsh 现场加载 2.5MB 卡交互）。
A/B（临时禁用预热 → 重新 build/打包，独立 output 目录，**打包版口径**）：

| 全新 profile，100s 稳态（打包版） | renderer priv | wsPriv |
|---|---|---|
| 原版（预热开） | 153.8 | 140.9 |
| **禁用预热** | **132.3** | **119.9** |

→ **dsh 预热 = 21.5MB 常驻**（dev electron 口径同 A/B 为 ~50MB，**高估一倍余——再次印证内存问题只认打包版**）。
v0.11.8 已含同一预热代码（App.tsx:473）→ 占 0.10.7→v0.11.8 增长（+66MB）约 1/3。
**优化方向**：预热改条件式（有 dsh 会话才预热 / 悬停或点击 dsh 区域时再加载）——不用 dsh 的用户直接省 21.5MB；
代价 = 首次打开 dsh 多等 chunk 加载（可折中为 hover 预热）。

---

## 13. 主进程内存爆炸：会话转录被反复整读（2026-10-06）

> 症状：AI 跑长任务时**主进程**从 ~0.6GB 冲到 3.5GB，整机卡死；对话一结束数字回落。
> 口径：打包版 + 任务管理器"内存"列（private bytes）。对象是**主进程**（browser），不是渲染进程。

### 13.1 实测

**进程树现场**（Task Manager 截图）：main **1335.8MB** / renderer 415.8 / GPU 223.4 / utility 6.5 —— 无终端 shell 进程，
claude CLI 子进程另有 3 个（315~463MB，属 CLI 自身，非本案）。

**同进程两次转储对比**（`dmp-peek --summary`）：

| 时刻 | heap-other | private 合计 | 说明 |
|---|---|---|---|
| 22:14（`dump-process.ps1` 自取） | **517MB** | 828MB | 会话进行中 |
| 22:29（Task Manager 取） | **2649MB** | 2913MB | 15 分钟后，同一进程 |

**同进程判定**：两次转储的 V8 cage 大区地址重合（都有 `0x36c02e80000`）⇒ 同一进程实例，可直接比大小。
**身份判定**（native 转储里认进程）：`node-pty` 1230 / `conpty` 462 / `pty.node` 21 / `browser_init` 24 / `[ai:term-` 5 = **main**；
`Minified React error` = 0 排除 renderer。⚠️ xterm/monaco/aiStore 等串会因 **asar 被映射**混入，**不能**当身份依据。

**堆内容指纹**：
- 各区最大块是 **V8 ValueSerializer 输出**（IPC 报文序列化，特征是 `$` + 长度前缀 + 逐字段字符串），内含
  `tool_use` 输入（Bash 命令原文）、工具输出、转录行 `{"parentUuid":…,"isSidechain":false,…}`、会话 id
- **重复度量化**（在 3.67GB 转储里 indexOf 计唯一串的存活份数）：`"parentUuid":` **90,839** 次、
  本会话 `6a794c0a-…` **130,843** 次、`"tool_use_id":` 22,134 次、某条 bash 输出 **794** 份
  → 份数 ≫ 来源数 = "同一份文件被反复整读"的铁证
- `dmp-payload.mjs` 载荷重估：各区 zero% 45~60% ⇒ private 2913MB 里 **~1.2GB 有字节 / ~1.4GB 是已提交空容量**

### 13.2 机制：为什么"正常使用"就会反复整读

1. 会话 jsonl 是**唯一真源**（可能被终端里的 claude / 别的窗口改写；revert/fork 必须按磁盘序列切）。
2. 但有 4 个**派生量没有内存副本**，取值方式写成"每次要用就整读一遍"：
   ①第几轮用户输入（`parseUserTurns(整个文件).length-1`）②用户轮清单（回退索引 + hover 弹窗）
   ③最后一条 assistant 回复（桌宠气泡）④会话 meta（列表名/时间/模型）。
3. **触发点全挂在 agent 干活的节奏上**，所以正常使用即高频：

| 事件 | 一次普通 run | 读多少 |
|---|---|---|
| 回合结束 result | ~10 次 | 整本 jsonl |
| **每次 Edit / Write** | **~50 次** | 整本（只为算 turnIndex） |
| busy→idle（桌宠） | ~10 次（**默认关**，见下） | 整本 |
| 开会话历史下拉 / 恢复会话 | 每次操作 × 全部会话 | 每文件一份（只取前 40 行） |

⚠️ 桌宠那条有开关：`vibe-ide-pet-listen-ai` **默认 false**（`petSettings.ts:134`），未开监听不注册游标
（`DesktopPet/index.tsx:121`），`readReplyIncrement` 直接 return、零 IO。**排查先查 localStorage 有没有这个键**，
别默认它在跑（本机没开 → 该项实贡献 0）。

**为什么贵**：一次整读的瞬时垃圾 ≈ 文件大小数倍（`readFile` 字符串 + `split('\n')` 切片数组 + 每行 `JSON.parse` 对象树）。
单次几 MB，但运行期连续且并发（一回合里编辑 5 次 = 5 次整读）→ **GC 追不上产垃圾速度**，堆高水位冲到 GB 级。
**"对话完回落" ≠ 没泄漏**：回落说明垃圾可回收（活数据不多），但**峰值已足够 OOM**；V8 已提交的页不还给 OS，
所以空闲读数停在 1.3GB（只有重启进程才还）。

**引入时间**：全部是 6-8 月的老代码（`6ed7cdbe` 06-17 图片 stringify 与 stdout 切行 / `86b1423e` 07-11 oldContent /
`a8ab597d` 07-13 turns 整读 / `5f58da02` 08-09 桌宠读整本），**不是某笔变坏**——是转录库长到 **316 本 / 304MB**
+ 会话开始带图 + agent 长跑（几十次编辑）把老代价放大。佐证：13:51 的 2.82GB 转储早于当天所有提交。

### 13.3 修复（2026-10-06，打包版实测有效）

| 位置 | 修前（每次都发生） | 修后 |
|---|---|---|
| `ai.ts` tool_result 三处 → `toolResultText()` | 带图结果整份 `JSON.stringify`（每张几百 KB）后再截到 16KB 丢掉 | 图片块换 `{type:'image',note:'[image]'}` 占位，几十字节 |
| `ai.ts` / `ai-revert.ts` → `readUserTurnsCached()` | `extractFileChange`（每次编辑）+ `AI_LIST_USER_TURNS`（每回合末）各自整读整本 | 按 `(size,mtime)` 共享缓存，未变零 IO |
| `ai.ts` `scanActiveJsonl` | 桌宠每次转闲整读最新 jsonl | 只读文件尾部（64KB 起，不够×4 递增，最多到文件头） |
| `ai.ts` stdout 分块 | 每 chunk 重切整缓冲（O(n²)）+ 跨块多字节被切坏（乱码） | `lineBuffer` 改 Buffer，只留未闭合行，按字节找 `\n` 逐行 decode |
| `ai.ts` `extractSessionMeta` | 列表扫描整读每个 jsonl 只为前 40 行 | `readSessionHeadLines()` 只读到前 40 行（**235MB→42MB**，316 个真实 jsonl 全量比对 meta 逐字一致） |
| `aiStore.onFileChange` | 同回合对同一文件每次改动都存一份整文件 `oldContent` | 同回合同文件只留首次（回退语义等价：消费方取 Map 首次命中） |

### 13.4 未做（下次若要继续）

- 渲染层"已加载会话不卸载"（每个常驻 AiTab 一份 DOM+memo；属渲染进程，非本案崩因）
- `buildSessionGraph` 每次刷新重读**未变过**的分支文件（只在开网状图时）
- 流式 token 一条一 IPC（改批处理会影响打字机手感）
