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

## 7. 本案例确认的真实结论

- **干净启动**：当前 HEAD 比 v0.11.8 (bf938cd2) 仅 **+40MB**（441/440 vs 481/480MB，两轮一致）
- **真实差异路径**：`a2c59e75` 起"启动自动加载 active GUI 会话"（`loaded:false` + 
  `ensureSessionLoaded` effect）——同注入会话实测：v0.11.8 不挂载（jsHeap 61MB）
  vs HEAD 挂载并加载整段对话（87.5MB，private +110MB），**对话越大差越多**
- 使用中增长：引擎池/语言 worker/代码缓存，**只有重启渲染进程能回收**
  （修复方向参考：`App.tsx` 的 `bootActiveIdRef` 跳过启动恢复加载）
- `test/perf-file-switch.mjs` 的局限：只报 JS 堆（增长大头在堆外）+ 总内存阈值 500MB 过宽，
  大量真实增长会判 PASS
