# 终端首次打开乱码 / 闪屏排查日记

**日期**: 2026-07-02 | **耗时**: 跨多轮对话

## 现象

- 主终端第一次打开 → 屏幕显示**乱码**,不是正常 shell 提示符
- **最大化 / 最小化触发重绘后恢复正常**
- 主终端频繁调用 TUI(opencode、vim 等)时也观察到闪屏
- 老版本似乎没有此问题

## 相关历史提交(时间线)

### xterm 5.x 时代(5/12 之前)
- 使用内置 canvas 渲染器,**无 WebGL**
- `allowTransparency: true` 硬编码
- 此阶段**无乱码、无闪屏**——"老版本"基线

### 5/12 `eb89549` "feat:win 打包"
- xterm 5.5.0 → **6.1.0-beta.287**
- addon-webgl 0.18.0 → **0.20.0-beta.286**
- **引入 WebGL,在 `term.open()` 之前同步挂载**(init effect 内)
- 这是"老版本"基线的延续:WebGL 从第一帧起就是 renderer,**无切换、无乱码**

### 5/16 `87d199` "fix: 亮色主题字体渲染"
- `allowTransparency: true` → `currentTheme.terminal.allowTransparency ?? true`
- 主题 effect 同步更新 allowTransparency
- 亮色主题显式设 `false` 修字体;深色主题未设 → 兜底 `true`
- 埋下"透明 + WebGL"路径隐患(但此时仍 sync 加载,无明显问题)

### 5/21 `5b11332` "强制D3D11硬件加速"
- 主进程强制 D3D11 + ignore-gpu-blocklist,保 WebGL 可用

### 6/3 `31fe1aa` "fix: webgl丢失后强制重绘buffer防止白屏"
- 加 `onContextLoss` → dispose + `term.refresh(0, rows-1)`
- 修 context loss 白屏(本次 fix 沿用此 handler)

### 6/8 `ef0027f` "perf: 优化显存占用" ⚠️ **回归根源**
- **把 WebGL 从 init effect(同步、open 之前)挪到独立 `[isActive, isReady]` effect:激活才挂、失焦 dispose**
- 动机:所有 session 的 TerminalView 同时挂载(`App.tsx:1994` `sessions.map`),inactive 的 `display:none`。希望同一时刻只持一个 WebGL context 省显存
- **副作用**:canvas 先画内容 → 再切 WebGL → 已有 buffer 首帧渲染乱码,resize 才正常 → 即"第一次打开乱码、最大化最小化后正常"bug

### 6/25 `9a9dd3a` / 6/26 `87d420d` 背景图功能
- 引入 `readTerminalBgImage()` / `--terminal-bg-image`
- `bgImage ? transparent : theme` 逻辑
- 叠在已坏的懒加载 WebGL 之上

### 6/25 `6318437` "feat: 崩溃自动重建"
- 终端崩溃自动重建(同期终端健壮性)

### 7/1 `3fb3c9b` / `cfacb05` "重置term缓冲" / "清屏"
- `clearBuffer()` 保末 7 行 + keepLines 优化
- 与本次乱码无关

### pty.ts 600ms 启动抑制 + `chcp 65001`(早于 4/26)
- 解决 shell 启动 banner / 编码问题
- 与本次 renderer 侧乱码无关

## 排查路径(走偏一次)

| # | 尝试 | 依据 | 为何无效 / 走偏 |
|---|---|---|---|
| 1 | 怀疑透明度:改 `?? true` → `?? false`(不透明)+ `!bgImage` 守卫让背景图走 canvas | WebGL + 透明会在 alt-screen 清屏闪一帧(理论) | **用户从未观察到透明清屏闪**;实际症状是"乱码 + resize 后正常"——这是 renderer 切换问题,不是透明问题。6.1.0-beta 已修 CSS 黑底透明 bug,透明大概率不闪 |
| 2 | 怀疑 600ms 启动 chcp 编码切换 | 编码变化可能致乱码 | 600ms 在 shell 启动时,远早于 opencode 启动;乱码现象是 resize 能修——编码问题 resize 修不了 |
| 3 | **怀疑 WebGL 懒加载切换** | "乱码 + resize 后正常" 是经典 renderer 首帧渲染坏特征;ef0027f 把 WebGL 从 open 前移到 open 后 | ✅ 命中根因 |

关键转折:用户明确说"直接就是乱码,最大化最小化 重绘后就正常了"——**症状关键词"乱码 + resize 修"直接指向 renderer 切换**,我之前没抓准,走偏到透明度上。

## 根因

`ef0027f` 把 WebGL 挂载从 init effect 的 `term.open()` **之前**挪到了独立 `[isActive, isReady]` effect(open 之后)。

结果:
1. init effect 里 `term.open()` + `fit()` 用**内置 canvas 渲染器**渲染
2. canvas 渲染器画了首帧(shell 提示符等)
3. `isReady` 触发后,isActive effect 加载 WebGL
4. `term.loadAddon(webgl)` 切到 WebGL renderer
5. WebGL renderer 对已有 buffer 的首帧渲染**乱码**(atlas / 尺寸 / 状态未就绪)
6. 用户看到乱码
7. 最大化/最小化 → ResizeObserver → `fit()` → WebGL 重绘 → 正常

老版本(eb89549)WebGL 在 `term.open()` 之前挂载,**canvas 渲染器从未画过任何内容**,首帧就是 WebGL,无切换、无乱码。

## 修复

```ts
// TerminalView.tsx init effect:在 term.open 之前挂载 WebGL
try {
  const webglAddon = new WebglAddon()
  webglAddon.onContextLoss(() => {
    webglAddon.dispose()
    if (webglAddonRef.current === webglAddon) webglAddonRef.current = null
    term.refresh(0, term.rows - 1)
  })
  term.loadAddon(webglAddon)
  webglAddonRef.current = webglAddon
} catch {
  // WebGL 不可用 → 回退内置 canvas 渲染器
}

term.open(terminalRef.current)
fitAddon.fit()
```

同时**移除** `ef0027f` 加的 `[isActive, isReady]` WebGL 懒加载 / Dispose effect。

### 修改量

- 1 处插入(init effect `term.open` 前加 WebGL 挂载)
- 1 处删除(移除 isActive WebGL effect)
- 透明度保持原状(`?? true`)—— 不参与本次修复

### 权衡

失去 `ef0027f` 的"同一时刻只一个 WebGL context"显存优化。每个挂载的 TerminalView 各持一个 WebGL context(因 `sessions.map` 所有 session 同时挂载)。代价:显存 O(N sessions)。正确性优先。

## 验证路径(一次只动一个变量)

1. `npm run dev`
2. 第一次打开终端 → 不再乱码(核心验证)
3. 切换 session → 不乱码(无 renderer 切换)
4. 主 term 反复 opencode / vim 进出 → 观察是否闪
   - 不闪 → 透明度理论确属多虑,到此为止
   - **若闪** → 透明度理论成立,再单独加 `?? false`(不透明)继续验证
5. 有背景图时同样观察 → 6.1.0-beta 应能处理透明 WebGL

## 架构要点备忘

- **所有 session 终端同时挂载**(`App.tsx:1994` `sessions.map`)
- **inactive session 用 `display:none` 切换**(`App.tsx:2000`),非条件渲染
- 因此 WebGl 的"省显存"优化只能走 isActive 懒加载;但懒加载必然带来 canvas→WebGL 切换 —— 两者根本冲突。本次选择正确性,放弃显存优化
- **xterm 6.1.0-beta 已修 CSS 黑底 + WebGL 透明问题**(CLAUDE.md 所记),透明路径在 6.1.0-beta 上应不闪
- **xterm 6.x 移除 `windowsMode` 选项**(`TerminalView.tsx:464` 既有类型报错,非本次引入,也不影响运行)

## 教训

1. **症状关键词是第一诊断依据**:"乱码 + resize 修"直接指向 renderer 首帧渲染坏(切换 / atlas / 尺寸问题),不是透明度问题。一开始就该从这两个词切入
2. **一次只动一个变量**:本次透明度改动和 WebGL 懒加载改动混在一起,导致无法归因。最终靠"回退透明度,只保留 WebGL sync"来隔离
3. **"老版本没有"是最强线索**:定位到引入 WebGL 的提交(eb89549)和破坏它的提交(ef0027f)就找到了边界
4. **未观测到的症状不要过度修**:透明度闪屏从未被用户确认,是推测。推测的修复引入不必要的行为变更(bgImage 失去 WebGL),应推迟到确认后再做
