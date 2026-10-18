# xterm 透明底细字问题（亮色 + 背景图）

> 来源：2026-10-18「亮色主题 + 全屏背景图，打开 Claude Code TUI 后字发细/发硬/有棱角，暗色正常」的排查。
> 结论先放这里：**xterm.js 上游已知 bug，不是我们的样式或透明度参数问题**；加白纱、模糊、调字重都只是掩盖。

## 现象

- 亮色主题 + 背景图（终端 `allowTransparency: true`）时，TUI 里的深色文字明显偏细、边缘发硬；
- 同一份 TUI、同一张底图，切暗色后字形正常；
- 底图越亮、细节越多越明显（亮色下背景亮部与字缘同一亮度区间，视觉上把笔画切碎）。

## 根因

- 上游 issue：**xtermjs/xterm.js #4212 — Text is abnormally thin when setting allowTransparency=true with webgl renderer (even when color is opaque)**
  <https://github.com/xtermjs/xterm.js/issues/4212>
  - 2022-10-18 提出，至今 **open**，标记 `help wanted`，无上游修复；
  - 复现条件与亮暗无关：只要 `allowTransparency: true`，**主题背景色完全不透明也会变细**。
- 代码层：WebGL 渲染器的字形图集临时 canvas 按 `allowTransparency` 决定 2D context 的 alpha 通道：
  - `node_modules/@xterm/addon-webgl/src/TextureAtlas.ts:101` — `getContext('2d', { alpha: this._config.allowTransparency })`
  - `allowTransparency: true` → `alpha: true`，字形以**灰度 alpha coverage** 烘焙，再合成到透明画布，字缘变细；
  - `allowTransparency: false` → `alpha: false`，走 opaque 快路径，字形栅格化质量正常。
- 为什么暗色不觉得：暗色是**浅字压深底**，变细一档后视觉上仍然饱满；亮色是**深字压浅底**，变细直接表现为发硬、有棱角。同一 bug，只有亮色显形。
- 同一现象的下游修复提交可作旁证（注释原话：opaque canvas = WebGL's crisp fast-path，`allowTransparency` bakes glyphs as grayscale-alpha）：
  <https://github.com/NousResearch/hermes-agent/commit/78ce91750ec66cab722cb9c4cb897696854fc5c0>

## 影响面

- 本项目当前版本：`@xterm/xterm 6.1.0-beta.302` + `@xterm/addon-webgl 0.20.0-beta.298`；
- 上游 6.0.0 有相关 alpha 改动（#5335 `webgl: Ignore alpha channel when allowTransparency is false`），但**不是** #4212 的修复；
- 触发场景：所有需要终端透明的配置（背景图 snippet `summerdays.css` / `nailong.css`），亮色主题下最明显。

## 可选方案

| 方案 | 做法 | 效果 | 代价 |
|---|---|---|---|
| **A. 亮色 + 底图时改用 DOM 渲染器** | `webglAddon.dispose()` 后 xterm 自动回落到 DOM 渲染器（`WebglAddon` 的 dispose 会 `_createRenderer()` 恢复 DOM，不用重建终端） | 保留底图；字由 Chromium 正常栅格化，与 AI 区正文一致。Issue 评论者验证过 DomRenderer 正常 | DOM 渲染器比 WebGL 慢，大量输出时明显 |
| **B. 终端画布不透明** | `allowTransparency: false` | 字最清晰（WebGL opaque 快路径），性能最好 | 终端里看不到底图（其他区域不受影响） |
| **C. 字重 400/700 + 初始化前预加载字体** | 避免 Medium(500) 与 atlas 烘焙 fallback 字形 | 只缓解，不根治透明路径 | — |
| D. 换 Canvas 渲染器 | `@xterm/addon-canvas` | 网上称对透明度更稳 | **不可用**：最后更新 2024-07，xterm 6 已移除 canvas renderer |

补充：`allowTransparency` 官方文档注明必须在 `open()` 前设置，且会损失性能
<https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/>。

## 当前决定

- 暂不修，保持现有「WebGL + 透明终端」；`git` 里没有针对此问题的改动。
- 若后续要修，优先 **A**：只对「亮色 + 底图」组合切 DOM 渲染器，暗色/无底图仍用 WebGL。

## 复现与验证

1. 亮色（GitHub Light）+ 启用 `summerdays.css` 背景图，打开 Claude Code TUI，观察次要灰色文字的笔画；
2. 切暗色主题对比，字形明显更饱满；
3. 确认是透明路径：DevTools 控制台 `localStorage.setItem('vibe-ide-force-dom-renderer','1')` 后重启应用（该开关只在终端 mount 时读一次），字恢复正常即可确认根因。
