# 终端完整支持 Kitty 图像协议（TGP）的代价

> 来源：2026-10-11 调研「term 完整支持 kitty 图像协议」。
> 结论先放这里：**不用自己写** —— xterm 官方 addon 已有 kitty 图像 MVP（`@xterm/addon-image` beta 线），
> 接线成本很小；但拿不到"完整"支持（动画 / `t=f/t/s` / Unicode 占位符 全缺），且处于 alpha/WIP。
> **Windows 传输层已实测趟平**（见 §2），本条链无需额外工作。

## 0. 结论速览

| 维度 | 代价 |
|---|---|
| 依赖 | +1 包 `@xterm/addon-image@0.10.0-beta.301`（~82KB），xterm 升 `beta.302 → beta.304+` |
| 接线 | 十几行（挂 addon + 压内存参数，只挂主终端） |
| Windows 传输 | **零**（已用 node-pty 自带 conpty.dll，实测 APC byte-exact） |
| 能力 | 只能拿到 MVP 子集，**非完整**（动画/传输介质/占位符缺） |
| 真实持有成本 | beta 期两个运行时坑（parser brick、overlay 透明）+ 内存需自己压 |

## 1. 上游事实：实现已存在，但只是 MVP

- 代码在 PR [#5619](https://github.com/xtermjs/xterm.js/pull/5619)（已合并，7.0.0 milestone），
  落在 `KittyGraphicsHandler.ts` / `KittyImageStorage.ts` / `KittyImageRenderer.ts`，
  经 `registerApcHandler({final:'G'})` 接入。
- 官方 `@xterm/addon-image` README 自述 **"partially Kitty TGP"**，kitty 部分标注仍 **WIP**。
- **稳定版 `0.9.0` 无 kitty 代码**（只有 sixel + iTerm IIP）→ 必须走 `beta` tag。
- 本仓库 `@xterm/xterm` 已装 `6.1.0-beta.302`，typings 里 `registerApcHandler` 已存在（APC hook 就绪）。

### 1.1 能力边界（"完整"的差距）

**已实现**：APC 分帧、流式 base64、`a=t/a=T/a=p/a=q/a=d`、`f=24/32/100`、zlib(`o=z`)、
多 chunk、`c/r` 缩放、源裁剪、单元格偏移、z-index、光标策略、存储+淘汰(≤256 图)、`OK/EINVAL/ENOENT` 应答。

**缺失**：

- **全部动画**：`a=f` / `a=a` / `a=c`（帧、时序、合成）—— 零
- **传输介质**：只支持 `t=d`（内联 base64）；`t=f`(文件) / `t=t`(临时文件) / `t=s`(共享内存) 全拒
- **Unicode 占位符**：U+10EEEE、`U=1` 虚拟放置
- **相对放置**：`P/Q/H/V`、链式/环检测
- **大部分删除选择器**：`n/N/c/C/p/P/q/Q/r/R/x/X/y/Y/z/Z/f/F`

现实影响：`chafa`/`timg`/`wezterm imgcat` 多走 `t=d`，能用；
但 `kitty +kitten icat` 默认 `<path>` 走 `t=f` → **不走**，需让它降级到内联；动画完全没有。

## 2. 关键实测：APC 在本机 byte-exact 透传 ✅

最大的不确定性在 Windows 传输层（in-box ConPTY 会丢 APC）。**已用本仓库 node-pty 实测通过**。

```
received chars: 2049
APC byte-exact? true
head: "\u001b_Gf=32,s=1,v=1,a=q,t=d;AAAAAA"
```

原因：`src/main/pty.ts:23` 已 `useConptyDll`，走 node-pty 自带的新版 OpenConsole
（`conpty.dll` 版本 **1.23.251008001**）。对比实测（noctty）：in-box ConPTY = `dropped`，
bundled OpenConsole = `byte_exact`。

> **推论**：以后别把 `useConptyDll` 关掉，否则 kitty/sixel 图像全废。

### 复现探针

```js
// tmp-apc-probe.mjs  (node tmp-apc-probe.mjs)
import pty from 'node-pty'
import { existsSync } from 'fs'

const dll = 'E:/ai/claudeui/node_modules/node-pty/build/Release/conpty/conpty.dll'
const payload = 'Gf=32,s=1,v=1,a=q,t=d;' + 'A'.repeat(2000)
const ESC = String.fromCharCode(27)
const ST = ESC + String.fromCharCode(92)

const script = "$p='" + payload + "'; [Console]::Out.Write([char]27 + '_' + $p + [char]27 + [char]92)"
const p = pty.spawn('powershell.exe', ['-NoLogo','-NoProfile','-Command', script], {
  name: 'xterm-256color', cols: 120, rows: 30, cwd: process.cwd(),
  useConpty: true, useConptyDll: existsSync(dll),
})
let buf = ''
p.onData(d => { buf += d })
setTimeout(() => {
  console.log('received chars:', buf.length)
  console.log('APC byte-exact?', buf.includes(ESC + '_' + payload + ST))  // → true
  p.kill(); process.exit(0)
}, 4000)
```

## 3. 接线代价

```ts
import { ImageAddon } from '@xterm/addon-image'

// 只挂主终端；aux 不挂。allowProposedApi 已开，无需改。
if (!isAux) {
  term.loadAddon(new ImageAddon({
    kittySupport: true, sixelSupport: false, iipSupport: false,
    storageLimit: 32,        // MB，默认 128
    pixelLimit: 4_000_000,   // 默认 16M px
    enableSizeReports: true, // 让应用拿到像素/单元格尺寸，kitty 定位才准
  }))
}
```

- 依赖：`npm i @xterm/addon-image@beta` + 升 `@xterm/xterm` 到 `beta.304+`（addon 的 peerDependency
  要求 `^6.1.0-beta.304`，当前 beta.302）。lib `addon-image.mjs` ≈ 82KB（wasm base64 解码器内联，无独立 `.wasm`），
  无额外运行时依赖。
- ⚠️ `enableSizeReports` 会改 xterm `windowOptions`（自动应答 CSI 14t/16t/18t），
  与 `pty.ts` 里对 `\x1b[c`(DA1) 的自定义应答**不冲突**（不同序列）。
- ⚠️ **内存**：默认 `storageLimit 128MB` FIFO + 解码峰值（`pixelLimit×4×2` 字节）。
  本仓库多终端 + 有内存分析历史 → 显式压小，且**每个终端实例各建一个 addon**（`storageUsage` 可运行时查）。

## 4. 已知坑（beta 级，真实存在）

1. **resize 期间解码会 brick 掉 parser**（最需警惕）：addon 的 APC/IIP 是 async handler +
   `createImageBitmap`，此时 `FitAddon.fit()` → `resize()` → `flushSync()` 会抛 "improper continuation"，
   让 **parser 永久 FAILED**。**上游 beta.304 仍未修**（[#5352](https://www.cubic.dev/pr/superset-sh/superset/pull/5352) / #7188 都是下游 patch）。
   本仓库面板折叠/拖拽/最大化到处 fit → 概率不低。
2. **透明 overlay canvas**：addon 在文本层（WebGL）之上叠一层透明 canvas；部分 Chrome/GPU 组合该层
   **不透明 → 图片盖黑文字**（[issue #5343](https://github.com/xtermjs/xterm.js/issues/5343)，Chrome-only，桌面某些显卡也复现）。
   本仓库是 WebGL 渲染器 → **必须实机验证**。
3. **ConPTY 光标 desync**（[microsoft/terminal #19926](https://github.com/microsoft/terminal/issues/19926)，
   报的就是 Win 10.0.26200 + conpty 1.23，与本机一致）：ConPTY 只透传不解析 APC，图占位后 conhost
   仍以为光标在原位，shell 重绘时可能错位。修复 PR #20009 是否已进 1.23.251008001 待确认，影响有限。
4. 上游建议：**长图传输期间避免 resize**。

## 5. 还有一层：让程序真的发图

- 本仓库 pty `name: 'xterm-256color'`，未设 `KITTY_WINDOW_ID` / `TERM_PROGRAM`。
  多数工具靠**自检**（发 kitty 查询、等应答）或**环境变量**决定是否发图。
- addon 会对 `a=q` 查询回 `OK`，但工具未必主动查。
- 若目标是 Claude Code / pi 之类内联显示截图 → 可能还要配合设环境变量或用工具自身开关触发。

## 6. 建议

- **最低代价路径**：`npm i @xterm/addon-image@beta` + 升 xterm 一个 beta → 十几行 + 调参，
  拿到 kitty 图像 MVP（`t=d` 直传 + PNG/RGBA/裁剪/缩放/删除）。
- **"完整支持"**：只能等上游（7.0.0 milestone 在推进）；自己 fork addon 补动画/占位符/`t=f` 是大工程，现阶段不建议。
- **真实成本不在代码**，在两件事：① beta 期的 parser-brick（配合频繁 fit）+ overlay 透明两个运行时坑；② 内存占用得自己压。

## 参考

- [xterm.js Discussion #5683](https://github.com/xtermjs/xterm.js/discussions/5683)（kitty 特性清单）
- [PR #5619](https://github.com/xtermjs/xterm.js/pull/5619)（kitty MVP 合并）
- [Issue #5343](https://github.com/xtermjs/xterm.js/issues/5343)（overlay canvas 透明失效）
- [microsoft/terminal #19926](https://github.com/microsoft/terminal/issues/19926)（ConPTY APC 光标 desync）
- [notcurses #2245](https://github.com/dankamongmen/notcurses/issues/2245)（ConPTY 与 kitty APC）
