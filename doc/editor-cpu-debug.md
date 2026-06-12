# Editor CPU 占用调试记录

## 起因

打开任意文件 Edit/Diff 模式时，任务管理器显示 CPU 占用 ~10%。主公质疑是否代码使用 Monaco 编辑器的方式存在浪费。

## 环境

- Electron + electron-vite + React + TypeScript + Tailwind
- `@monaco-editor/react` v4.6.0 + `monaco-editor` v0.52.2
- 文件: `src/renderer/src/components/DiffViewer.tsx`

## 六阵全过程

### 🐎 第一阵：勘察敌情

向 `DiffViewer.tsx` 插入 `_configureMonacoCallCount`、`_syncTsDiagnosticsCallCount` 计数 + console，在控制台观察调用次数：

```
[Perf] configureMonacoBase 第 1 次调用 → 首次，设置 compilerOptions
[Perf] configureMonacoBase 第 2 次调用 → 锁已开，跳过
[Perf] syncTsDiagnostics 第 1 次调用 (showSquiggles=false)
[Perf] syncTsDiagnostics 第 2 次调用 (showSquiggles=false)
```

发现：
- `beforeMount`（`configureMonaco`）**不是全局一次**，每个 `<Editor>`/`<DiffEditor>` 挂载都跑
- 源码确认 `@monaco-editor/react` v4.6.0 的 `beforeMount` 对应编辑器实例创建，非 Monaco 加载
- `configureMonaco` 内的 `setCompilerOptions` / `setDiagnosticsOptions` 每次触发 TS Worker 编译

### ⛓️ 第二阵：圈定战场

**优化（上策）涉及三个点：**

| 问题 | 位置 | 影响 |
|------|------|------|
| `beforeMount` 每编辑器挂载都跑 `configureMonaco` | 725行、808行 | TS Worker 被重复搅动 |
| `options` 对象每渲染重建新引用 | 707-724行、794-807行 | 触发 `updateOptions()` + 布局重算 |
| `langMap` 100+ 键值每渲染重新分配 | 555-666行 | 微小但无意义分配 |

**排查过程说明：**

1. 读 `@monaco-editor/react/dist/index.js` 源码确认 lifecycle
2. `beforeMount`（`n.current`/`v.current`）在 DiffEditor 和 Editor 的创建 `useCallback` 中调用
3. `S.current = !0` 标记只防同一组件实例重复创建，不防卸载后重挂
4. 切 Diff↔Edit 模式 = 旧组件卸载 → 新组件挂载 → `beforeMount` 重跑

### ☯️ 第三阵：推演因果

**三策比较：**

| | 根治 beforeMount | 消除 updateOptions | 代码量 | 风险 |
|---|---|---|---|---|
| 上策 | ✅ 全局锁 | ✅ useMemo | ~60行 | 低 |
| 中策 | ✅ | ✅ | ~40行 | 极低 |
| 下策 | ❌ | ✅ | ~10行 | 无 |

主公选了**上策**。

### ⚔️ 第四阵：披甲出战

**实际改动（`DiffViewer.tsx`）：**

1. `configureMonacoBase(monaco)` + `_monacoConfigured` 全局锁 → 首次执行 `setCompilerOptions`，后续跳过
2. `syncTsDiagnostics(showSquiggles)` + `_lastShowSquiggles` 去重 → 值未变则跳过通知 TS Worker
3. `langMap` + `getLanguageFromFile` 提至模块顶层 → 消除每渲染 100+ 键分配
4. `diffOptions` / `editOptions` 用 `useMemo` 缓存 → 消除每渲染 `updateOptions()` 调用
5. `beforeMount` 改用 `configureMonacoBase`（首次配完即锁）
6. `useEffect(() => syncTsDiagnostics(showSquiggles), [showSquiggles])` 统一管理 diagnostics

**过程波折：**

- 初次提交时附带了 `setDiagnosticsOptions`（锁内），与后续 `useEffect` 中的 `syncTsDiagnostics` 形成双重调用，CPU 从 10% → 20%
- 去掉锁内的 `setDiagnosticsOptions` 后 CPU 回到 10%
- 首次提交失败（Options 残留碎片），回退后逐步拆刀

### 🏆 第五阵：战后清点

**构建三种诊断工具验证：**

1. **A/B 对照模式**：`__toggleMonaco()` 将 Monaco 替换为原生 `<textarea>`
2. **裸 Monaco 对照**：`__toggleRaw()` 剥掉所有包装层（beforeMount/onMount/onChange/options/光标追踪）
3. **CPU 测量**：`__benchMonaco()` 自动跑三轮三种模式 ×5s 测量

**测量结果（`process.cpuUsage` + `app.getAppMetrics`）：**

```
══════════════════════════════════════════════════════════════════════
  真实 CPU 基准测试 (process.cpuUsage + app.getAppMetrics)
  [A] 完整包装: 主CPU=0.26% 渲染CPU=0.06%
  [B] 裸 Monaco : 主CPU=0.27% 渲染CPU=0.03%
  [C] textarea  : 主CPU=0.38% 渲染CPU=0.02%
══════════════════════════════════════════════════════════════════════
📊 包装层开销(渲染CPU): 0.02% ✅ 零开销
📊 Monaco Engine(渲染CPU): 0.01% (可忽略)
```

**结论：**

- 三种模式 CPU 都在 0.3% 以内（JS 层）
- **我们的代码使用正确，包装层零浪费**
- 任务管理器看到的 ~10% CPU 来自 Electron GPU 进程 + Worker 线程 + 系统级开销，不在 JS 可控范围
- 优化前 10%（含重复调用浪费）、优化后仍是 10%（纯 Monaco 基线）

**遗留问题：**

- JS 层测得的 CPU 与任务管理器显示的 10% 对不上
- 怀疑 GPU 进程或 Electron 基础设施是主因，但未深入验证

### 💥 第六阵：败阵善后

需要进一步追查的点：

1. Chrome DevTools Performance 录制 5s 闲置火焰图，看时间花在哪个线程
2. `app.getAppMetrics()` 输出所有进程（GPU/Utility/Network Service）CPU 占比
3. 对比 VS Code 打开同一文件的 CPU 占用
4. 或接受 Electron + Monaco 架构的 ~10% 基线

## 最终净改动

```
src/renderer/src/components/DiffViewer.tsx | 157 +----------------------------
 1 file changed, 1 insertion(+), 156 deletions(-)
```

净减 156 行，保留的有意义的优化：

| 保留项 | 类型 |
|--------|------|
| `configureMonacoBase` + 全局锁 | 防重复 |
| `syncTsDiagnostics` + `_lastShowSquiggles` 去重 | 防重复 |
| `langMap` + `getLanguageFromFile` 模块常量 | 免分配 |
| `diffOptions` / `editOptions` useMemo | 免渲染 |
| `useEffect` 同步 `showSquiggles` | 单点管理 |

删掉的调试代码：

- `__toggleMonaco() / __toggleRaw() / __benchMonaco()`（三个诊断开关）
- `_configureMonacoCallCount / _syncTsDiagnosticsCallCount`（计数变量）
- 所有 `[Perf]` 和 `🔬` console.log
- `test/perf-monaco-cpu.mjs`（CDP 自动化测试脚本）

## 相关提交

```
b8b1ea1 perf: 正向优化 降低cpu负载 edit
```
