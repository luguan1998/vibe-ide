# NES 8-bit CSS 研究

## 概述

NES（Nintendo Entertainment System）8 位审美在 Web 前端中有多种实现方式，主要分为三条技术路线：

1. **NES.css 框架** — 一个完整的 CSS 组件库，将 NES 时代的 UI 风格（按钮、对话框、容器、表单等）封装为可直接使用的 class
2. **纯 CSS 技术** — 利用 `box-shadow`、`border-image`、CSS 渐变、`image-rendering` 等底层 CSS 特性渲染像素风图形
3. **Canvas/SVG 增强** — 通过 Canvas 像素操作、SVG 滤镜等实现 CRT 扫描线、色差等高级视觉效果

本文从第一手源文档和源码出发，逐项分析各技术的原理、规范依据、浏览器兼容性和实际应用。

---

## 1. NES.css 框架分析

### 1.1 框架概述

**NES.css** 是由 [B.C.Rikko](https://github.com/BcRikko) 创建的 NES 风格 CSS 框架，托管于 [nostalgic-css](https://github.com/nostalgic-css) 组织。由 jp, eng, zh 简体中文等6种语言 README。

- **GitHub**: https://github.com/nostalgic-css/NES.css
- **官网**: https://nostalgic-css.github.io/NES.css/
- **版本**: 2.3.0（最新发布版本，2024年1月最后更新）
- **Star**: 21,778（截至2026年7月）
- **许可证**: MIT
- **标签**: `8bit`, `css`, `css-framework`, `nes`, `scss`
- **技术栈**: SCSS，无 JavaScript 依赖

**设计理念**（来源：README-zh-CN.md）：

> NES.css 是一款 NES-风格(8位机) 的 CSS 框架。NES.css 只提供组件，你需要定义你自己的布局。NES.css 仅仅需要 CSS 而不依赖其他任何 JavaScript。

框架不对布局做任何假设，只提供 UI 组件本身的样式。

### 1.2 核心实现技术

#### 1.2.1 按钮系统（buttons.scss）

按钮是 NES.css 中最具代表性的组件。其核心是一个 SCSS mixin `btn-style`：

```scss
@mixin btn-style($color, $background, $hover-background, $shadow) {
  color: $color;
  background-color: $background;

  &::after {
    position: absolute;
    top: -$border-size;
    right: -$border-size;
    bottom: -$border-size;
    left: -$border-size;
    content: "";
    box-shadow: inset -4px -4px $shadow;
  }

  &:hover { &::after { box-shadow: inset -6px -6px $shadow; } }
  &:focus { box-shadow: 0 0 0 6px rgba($shadow, 0.3); }
  &:active:not(.is-disabled)::after { box-shadow: inset 4px 4px $shadow; }
}
```

**技术要点**：

- 使用 `::after` 伪元素配合 `box-shadow: inset` 实现 NES 按钮标志性的 3D 浮雕效果
- Normal 态：`inset -4px -4px` — 右下阴影，按钮凸起
- Hover 态：`inset -6px -6px` — 阴影加深，按钮更立体
- Active 态：`inset 4px 4px` — 阴影反转为左上，按钮被按下的效果
- Focus 态：用 `box-shadow: 0 0 0 6px` 产生外发光而不遮挡按钮本身

按钮类型通过 SCSS map 循环生成：default（灰）、primary（蓝）、success（绿）、warning（黄）、error（红）。

#### 1.2.2 像素圆角边框（rounded-corners-mixin.scss）

NES.css 最精妙的技术在于像素风格的圆角边框，它利用 CSS `border-image` 属性结合内联 SVG 实现了真正的"像素风"圆角：

```scss
@mixin border-image($color) {
  border-image-source: url('data:image/svg+xml;utf8,<?xml version="1.0" ... ?>
    <path d="M3 1 h1 v1 h-1 z M4 1 h1 v1 h-1 z ... "
    fill="rgb(#{red($color)},#{green($color)},#{blue($color)})" />');
}
```

该内联 SVG 绘制了一个 8x8 像素的图案，其中每个 1x1 的 `path` 方块代表圆角转角处的一个像素。用这种方式，圆角是通过真正的像素块拼出来的，而非通过 `border-radius` 的平滑曲线。

**`border-image` 技术原理**（来源：MDN border-image 文档）：

1. `border-image-slice: 3` — 将 8x8 的源图片按 3 像素切分为 9 宫格（四角 + 四边 + 中心）
2. `border-image-width: 3` — 边框宽度为 3 像素
3. `border-image-repeat: stretch` + Chrome 下使用 `space`（因为 Chrome 对 `stretch` 的渲染方式不同）

```scss
// Chrome 专有修复
@media all and (-webkit-min-device-pixel-ratio: 0) and (min-resolution: 0.001dpcm) {
  border-image-repeat: space;
}
// Firefox 专有修复
@supports (-moz-appearance: meterbar) {
  border-image-repeat: stretch;
}
```

框架还提供了紧凑版 `compact-rounded-corners`，使用 5x5 的 SVG + `border-image-slice: 2`。

#### 1.2.3 容器（containers.scss）

容器 `nes-container` 使用固定的 `border-width: 4px` 和 `border-style: solid`，模拟 NES 游戏中常见的粗框设计。支持 `with-title` 变体，通过负 `margin-top` 将标题"嵌入"上边框：

```scss
&.with-title > .title {
  display: table;
  padding: 0 0.5rem;
  margin: -1.8rem 0 1rem;  // 负 margin 使标题跨越边框
  background-color: $background-color;  // 遮盖边框线
}
```

深色模式（`is-dark`）使用 `::after` 伪元素扩展背景色到边框之外，模拟 NES 游戏中的深色对话框。

#### 1.2.4 对话框（dialogs.scss）

支持原生 `<dialog>` 元素及其 `::backdrop` 伪元素：

```scss
.nes-dialog {
  > .backdrop, &::backdrop {
    background-color: rgba(0, 0, 0, 0.3);
  }
}
```

#### 1.2.5 图标像素画（icon-mixin.scss）

NES.css 内置了一个强大的 SCSS 像素画生成器 `pixelize` mixin。它接收一个二维矩阵（数字索引）、颜色列表和像素尺寸，循环生成 `box-shadow` 字符串：

```scss
@mixin pixelize($size, $matrix, $colors, $default-color: null) {
  // 自动检测使用最多的颜色作为默认色（减少 box-shadow 条目）
  // ...
  @for $i from 1 through length($matrix) {
    @for $j from 1 through length($row) {
      $dot: nth($row, $j);
      @if $dot != 0 {
        $ret: $ret + ($j * $size) + " " + ($i * $size) + " " + $color;
      }
    }
  }
  width: $size;
  height: $size;
  color: $default-color;
  box-shadow: unquote($ret);
}
```

**优化**：自动计算出现频率最高的颜色作为 `default-color`，该颜色条目在 `box-shadow` 中省略颜色值（继承自 `color` 属性），从而减少 CSS 体积。

**Firefox 兼容**：Firefox 在 `box-shadow` 的 1x1px 渲染上有 bug（像素被挤压不可见），因此 mixin 额外生成一个带 `0 0.020em` 虚化半径的副本用于 Firefox。

#### 1.2.6 自定义像素光标

框架使用自定义光标图片模拟 NES 风格的箭头光标和点击光标。变量定义在 `variables.scss` 中：

```scss
$cursor-url: url(get-file-as-data-uri("../assets/cursor.png")) !default;
$cursor-click-url: url(get-file-as-data-uri("../assets/cursor-click.png")) 14 0 !default;
```

#### 1.2.7 动画（animations.scss）

NES.css 只定义一个动画：经典的 NES 闪烁效果：

```scss
@keyframes blink {
  0%   { opacity: 1; }
  50%  { opacity: 0; }
}
```

#### 1.2.8 推荐字体

README 中明确推荐 "Press Start 2P" 作为默认英文字体，中文推荐 "Zpix (最像素)"。

### 1.3 源码架构总结

```
scss/
├── nes.scss         # 入口：导入所有模块
├── nes-core.scss    # 核心入口
├── base/            # 基础层
│   ├── _index.scss
│   ├── variables.scss       # 字体、颜色、尺寸变量
│   ├── color-palette.scss   # NES 64色调色板
│   ├── generic.scss         # 覆盖 reboot 的通用样式
│   └── reboot.scss          # 基于 Bootstrap Reboot 4.1.3
├── utilities/       # 工具层
│   ├── _index.scss
│   ├── animations.scss      # blink 动画
│   ├── fill-gaps.scss
│   ├── icon-mixin.scss      # pixelize() 像素画生成器
│   ├── rounded-corners-mixin.scss  # border-image 圆角系统
│   └── visually-hidden.scss
├── helpers/         # 辅助类
├── elements/        # 组件层
│   ├── buttons.scss         # 按钮系统（核心组件）
│   ├── containers.scss      # 容器
│   ├── dialogs.scss         # 对话框
│   ├── lists.scss           # 列表
│   ├── progress.scss        # 进度条
│   ├── tables.scss          # 表格
│   ├── text.scss            # 文本样式
│   ├── badges.scss          # 徽章
│   ├── balloons.scss        # 对话气泡
│   └── avatar.scss          # 头像
├── form/            # 表单层
│   ├── inputs.scss
│   ├── checkboxes.scss
│   ├── radios.scss
│   └── selects.scss
└── icons/           # 像素图标（各游戏机手柄等）
```

---

## 2. 核心技术

### 2.1 image-rendering

**规范来源**：CSS Images Module Level 3 — [https://drafts.csswg.org/css-images-3/#the-image-rendering](https://drafts.csswg.org/css-images-3/#the-image-rendering)

`image-rendering` 属性设置图像的缩放算法。当图像尺寸与 CSS 设置的显示尺寸不一致时，用户代理(UA)使用该算法进行缩放。

**形式语法**（MDN）：
```
image-rendering = auto | smooth | high-quality | pixelated | crisp-edges
```

**各值含义**：

| 值 | 说明 |
|---|---|
| `auto` | 默认值，UA 自行决定。Gecko(Firefox) 使用双线性插值 |
| `smooth` | 最大化显示质量的算法（双线性插值等），适合照片 |
| `crisp-edges` | 使用"最近邻"算法，保留对比度和边缘。适合像素画/线条画 |
| `pixelated` | 先按最近邻算法缩放到原始尺寸的整数倍，再平滑插值到最终尺寸。产生清晰的像素块 |

**浏览器兼容性**：Baseline Widely Available 从 2020 年 1 月起覆盖所有现代浏览器。

**典型用法**：

```css
.pixel-art {
  image-rendering: pixelated;
  image-rendering: crisp-edges;  /* 更广泛兼容 */
  -ms-interpolation-mode: nearest-neighbor; /* IE 专有 */
}
```

**关键区别**：`crisp-edges` 和 `pixelated` 在大多数浏览器上行为一致，但规范定义有细微区别：`pixelated` 要求先缩放到整数倍再平滑处理。实际测试中 Chrome 对两者的渲染几乎相同。

**NES 场景**：当页面中包含 8-bit 像素图时，必须设置此属性防止浏览器使用双线性插值模糊像素边缘。

### 2.2 Box-shadow 像素画

**技术原理**：利用 `box-shadow` 的多重值渲染能力（任意多个 shadow 条目以逗号分隔），每个条目作为一个像素点。

**核心实现**（CSS 规范：CSS Backgrounds and Borders Module Level 3 — [https://drafts.csswg.org/css-backgrounds/#propdef-box-shadow](https://drafts.csswg.org/css-backgrounds/#propdef-box-shadow)）：

- `box-shadow: none | <shadow>#`
- 一个`<shadow>` = `<offset-x> <offset-y> <blur-radius>? <spread-radius>? <color>?`
- 多个 shadow 以逗号分隔，按先后顺序堆叠（第一个在最上）
- 当 blur 和 spread 均为 0 时，shadow 与元素等大(1x1px)

**渲染机制**：

```css
.pixel-sprite {
  width: 1px;
  height: 1px;
  box-shadow:
    0px  0px  red,      // (0,0) 红色像素
    1px  0px  red,      // (1,0)
    0px  1px  blue,     // (0,1) 蓝色像素
    1px  1px  red;      // (1,1)
}
```

每个 `box-shadow` 条目实际是一个与元素等大的色块(1x1px)，通过 X/Y 偏移定位。

**缩放**：用 `transform: scale(N)` 放大，每个像素变为 NxN 的可视块。

**性能考量**（来自 MDN box-shadow 性能章节）：

- box-shadow **不改变盒模型尺寸**
- 大量阴影条目会增加绘制复杂度，尤其是动画时
- 每个阴影条目的渲染成本大约是 O(1)，但总条目数达到数百上千时影响显著

**实际应用**：

- NES.css 的 `pixelize` mixin 自动从矩阵生成 box-shadow 字符串
- GitHub: FoxyStoat/pixel-art（大量盒阴影像素画示例）
- npm: `box-shadow-pixels` — 从像素网格生成 CSS 的工具库

### 2.3 CSS 渐变与 CRT 效果

**规范来源**：CSS Images Module Level 3 — [https://drafts.csswg.org/css-images-3/#funcdef-linear-gradient](https://drafts.csswg.org/css-images-3/#funcdef-linear-gradient)

CSS 渐变通过 `linear-gradient()` 和 `repeating-linear-gradient()` 函数实现。

#### 扫描线效果（Scanlines）

使用 `repeating-linear-gradient` 和硬色断点(hard color stops)：

```css
.crt-scanlines {
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.15) 0px,
    rgba(0, 0, 0, 0.15) 1px,
    transparent 1px,
    transparent 3px
  );
}
```

原理：`rgba(0,0,0,0.15)` 从 0px 到 1px（黑色半透明扫描线），然后 `transparent` 从 1px 到 3px（像素间隙），形成一个 3px 周期的重复单元。

#### RGB 子像素效果（Aperture Grille）

```css
.crt-rgb {
  background: repeating-linear-gradient(
    to right,
    red 0px, red 2px,
    green 2px, green 4px,
    blue 4px, blue 6px
  );
  mix-blend-mode: screen;
  opacity: 0.15;
  pointer-events: none;
}
```

#### 暗角（Vignette）

通过 `radial-gradient` 在边缘产生暗角，模拟老式 CRT 屏幕的四周暗角：

```css
background: radial-gradient(
  ellipse at center,
  transparent 60%,
  rgba(0, 0, 0, 0.6) 100%
);
```

#### 组合 CRT 效果

将多层渐变叠加在 `::after` 伪元素上，通过 `pointer-events: none` 允许用户与下层内容交互。

### 2.4 像素字体

**规范来源**：CSS Fonts Module Level 4 — [https://drafts.csswg.org/css-fonts/#font-face-rule](https://drafts.csswg.org/css-fonts/#font-face-rule)

NES 8-bit 风格中，字体是实现观感的关键一环。常规的矢量字体边缘过于平滑，像素字体使用点阵位图，每个字母在固定网格中绘制。

#### @font-face 配置

```css
@font-face {
  font-family: "Press Start 2P";
  src: url("press-start-2p.woff2") format("woff2");
  font-display: swap;
}

body {
  font-family: "Press Start 2P", monospace;
}
```

**推荐像素字体**（来源：NES.css README）：

| 语言 | 字体 | 来源 |
|---|---|---|
| 英文(默认) | Press Start 2P | Google Fonts |
| 英文 | Kongtext | dafont.com |
| 日语 | 美咲フォント | littlelimit.net |
| 中文 | Zpix (最像素) | GitHub: SolidZORO/zpix-pixel-font |

**font-display 考量**：像素字体通常较大文件（尤其是 CJK 字符集），建议使用 `font-display: swap` 或 `font-display: optional` 防止阻塞渲染。

### 2.5 NES 调色板

NES 的 PPU（Picture Processing Unit，型号 2C02）生成复合 NTSC 信号，以 6-bit 索引引用 64 种颜色。颜色编码（来源：nesdev.org — [PPU palettes](https://www.nesdev.org/wiki/PPU_palettes)）：

- **Bits 4-5 (VV)**：亮度值（luma）
- **Bits 0-3 (HHHH)**：色调（hue），通过相位控制色度副载波

**亮度层级**：
- `$0F`: 黑色
- `$00`: 深灰
- `$10`: 亮灰/银
- `$20`: 白色
- `$01-$0C`: 暗色
- `$11-$1C`: 中色
- `$21-$2C`: 亮色
- `$31-$3C`: 淡色

**色调命名**（按照高半字节 hex 值）：$x0 灰, $x1 蔚蓝, $x2 蓝, $x3 紫罗兰, $x4 品红, $x5 玫瑰, $x6 红/褐红, $x7 橙, $x8 黄/橄榄, $x9 黄绿, $xA 绿, $xB 春绿, $xC 青

**NES.css 定义的 64 色调色板**（来源：color-palette.scss，注释引用 Wikipedia）：

```scss
// 行 $x0：灰阶
$color-00: #7c7c7c;  $color-10: #bcbcbc;  $color-20: #f8f8f8;  $color-30: #fcfcfc;

// 行 $x1：蔚蓝 (Azure)
$color-01: #0000fc;  $color-11: #0078f8;  $color-21: #3cbcfc;  $color-31: #a4e4fc;

// 行 $x2：蓝 (Blue)
$color-02: #0000bc;  $color-12: #0058f8;  $color-22: #6888fc;  $color-32: #b8b8f8;

// 行 $x3：紫 (Violet)
$color-03: #4428bc;  $color-13: #6844fc;  $color-23: #9878f8;  $color-33: #d8b8f8;

// ... 其余条目见 color-palette.scss
```

注意 NES.css 未使用 $xE 和 $xF 行的颜色（黑色重复，实际上色为 `#000`），保留了完整的 64 条目结构。

**对 CSS 开发的意义**：使用 NES 调色板中的精确色彩（而非近似值）是实现忠实 NES 视觉风格的前提。色板中有不少颜色在标准 Web 调色板中不常见（如特定色调的深绿、橙红），需要直接从 NES 色板中提取。

---

## 3. 高级技术

### 3.1 Canvas 像素渲染 + CSS 覆盖层

**规范来源**：Canvas API — [Pixel manipulation with canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas)

Canvas 提供底层像素操作能力：

1. `ctx.getImageData(x, y, w, h)` — 获取像素数据
2. `ImageData.data` — `Uint8ClampedArray`，每个像素 RGBA 各 1 字节
3. `ctx.putImageData(imageData, dx, dy)` — 写回

**与 CSS 结合的场景**：

```javascript
// 像素渲染
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;  // 保持像素清晰

// 获取像素数据
const imageData = ctx.getImageData(0, 0, width, height);

// 像素操作：NES 色调量化等
for (let i = 0; i < data.length; i += 4) {
  // 将每个像素映射到最近的 NES 调色板颜色
  const nesColor = mapToNearestPalette(data[i], data[i+1], data[i+2]);
  data[i] = nesColor.r;
  data[i+1] = nesColor.g;
  data[i+2] = nesColor.b;
}

ctx.putImageData(imageData, 0, 0);
```

**CSS 叠加层**：Canvas 渲染的内容可以覆盖 CSS 滤镜（`filter: url(#scanlines)`）、`mix-blend-mode`（`screen`、`multiply` 等）来叠加 CRT 效果。

### 3.2 SVG 滤镜与 CRT 扫描线

**规范来源**：SVG `<filter>` — [https://developer.mozilla.org/en-US/docs/Web/SVG/Element/filter](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/filter)

CSS `filter: url()` — [https://developer.mozilla.org/en-US/docs/Web/CSS/filter](https://developer.mozilla.org/en-US/docs/Web/CSS/filter#url)

SVG 滤镜提供了比 CSS 渐变更强大的 CRT 模拟能力，可以通过组合多个滤镜原语(primitives)实现真实感的 CRT 效果：

```html
<svg width="0" height="0">
  <filter id="crt-effect">
    <!-- 扫描线：用锯齿波(feTurbulence)配合颜色矩阵 -->
    <feTurbulence type="fractalNoise" baseFrequency="0 0.5" numOctaves="1"
      result="scanlines" />
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.15 0"
      in="scanlines" result="scanlines-alpha" />

    <!-- 色差模拟 (chromatic aberration) -->
    <feOffset in="SourceGraphic" dx="1" dy="0" result="red-shift" />
    <feColorMatrix in="red-shift" type="matrix"
      values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 0" result="red-layer" />
    <feOffset in="SourceGraphic" dx="-1" dy="0" result="blue-shift" />
    <feColorMatrix in="blue-shift" type="matrix"
      values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.3 0" result="blue-layer" />

    <!-- 合并所有层 -->
    <feBlend in="red-layer" in2="blue-layer" mode="screen" result="chromatic" />
    <feBlend in="chromatic" in2="SourceGraphic" mode="screen" result="with-color" />
    <feBlend in="with-color" in2="scanlines-alpha" mode="multiply" />
  </filter>
</style>
```

**关键 SVG 滤镜原语**：

| 原语 | CRT 用途 |
|---|---|
| `feTurbulence` | 生成扫描线的垂直噪波 |
| `feColorMatrix` | 控制颜色通道、透明度、灰度转换 |
| `feOffset` | 实现 RGB 色差位移 |
| `feBlend` | 多层混合（screen、multiply 模式） |
| `feGaussianBlur` | 模拟老电视的模糊 |
| `feComponentTransfer` | 精确的逐通道颜色映射（Gamma 校正） |

**CSS 引用**: `filter: url(#crt-effect)`

### 3.3 CSS 动画模拟 NES 精灵动画

**规范来源**：CSS Animations — [https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations)

NES 风格的动画关键特征：**帧率有限**（通常每秒 6-8 帧而非 60fps）、**无插值**、**有限状态切换**。

#### steps() 步进函数

`animation-timing-function: steps(N)` 是实现帧动画的核心工具：

```css
.sprite-walk {
  width: 16px;
  height: 16px;
  background: url('sprite-sheet.png') 0 0 no-repeat;
  animation: walk 0.8s steps(4) infinite;  /* 4 帧，每帧 0.2s */
}

@keyframes walk {
  from { background-position: 0 0; }
  to   { background-position: -64px 0; }  /* 4 frames × 16px */
}
```

`steps()` 参数：
- `<integer>`：步数（帧数），必须为正整数
- `<step-position>`：`jump-start` | `jump-end` | `jump-none` | `jump-both` | `start` | `end`
  - `start` / `jump-start`：动画开始时即跳到第一帧
  - `end` / `jump-end`（默认）：动画结束时跳到最后一帧

#### Box-shadow 帧动画

使用 `@keyframes` 切换整个 `box-shadow`：

```css
@keyframes walk-cycle {
  0%   { box-shadow: /* frame 1 的像素 */ }
  25%  { box-shadow: /* frame 2 的像素 */ }
  50%  { box-shadow: /* frame 3 的像素 */ }
  75%  { box-shadow: /* frame 4 的像素 */ }
}
```

通常配合 `animation-timing-function: steps(1)` 实现逐帧硬切（无插值）。

#### NES 闪烁效果

NES 游戏中的经典闪烁（敌人受伤闪烁、光标闪烁）：

```css
@keyframes nes-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.blinking {
  animation: nes-blink 0.3s steps(2) infinite;
}
```

### 3.4 双边框与 outline 技术

**规范来源**：CSS `outline` — [https://developer.mozilla.org/en-US/docs/Web/CSS/outline](https://developer.mozilla.org/en-US/docs/Web/CSS/outline)

`outline` 与 `border` 的关键区别：
- `outline` **不占据盒模型空间**，绘制在元素外部
- `outline` 使用 `outline-offset` 控制与 border 的间距
- `outline` **不受 `border-radius` 影响**（但现代浏览器中 outline 的角会跟随 border-radius）

**NES 双边框实现**：

```css
.nes-border {
  border: 4px solid #000;          /* 内边框 */
  outline: 4px solid #f8f8f8;      /* 外边框 */
  outline-offset: 4px;             /* 与内边框间隔 4px */
  padding: 8px;
}
```

这种技术无需额外的 HTML 嵌套，就能实现 NES 游戏中常见的双层边框效果。

### 3.5 像素画边框（border-image 内联 SVG）

这是 NES.css 的核心创新，但也可以独立使用。原理：

1. 创建一个很小的 SVG（如 8x8 像素），在其中用 `path` 元素逐个像素绘制转角图案
2. 通过 `border-image-source: url('data:image/svg+xml;...')` 将 SVG 嵌入 CSS
3. 用 `border-image-slice` 切分为 9 宫格，四角保持像素图案，四边拉伸/平铺

**独立使用示例**：

```css
.pixel-border {
  border-style: solid;
  border-width: 4px;
  border-image-source: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect x="0" y="0" width="3" height="3" fill="black"/><rect x="5" y="0" width="3" height="3" fill="black"/><rect x="0" y="5" width="3" height="3" fill="black"/><rect x="5" y="5" width="3" height="3" fill="black"/></svg>');
  border-image-slice: 3;
  border-image-width: 3;
  border-image-repeat: stretch;
}
```

### 3.6 media query 与纵横比约束

**规范来源**：CSS `@media (aspect-ratio)` — [https://developer.mozilla.org/en-US/docs/Web/CSS/@media/aspect-ratio](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/aspect-ratio)

NES 游戏的标准纵横比为 **4:3**，NES PPU 内部实际使用的像素纵横比是 **8:7**（256x240 像素渲染到 4:3 显示）。可通过 media query 针对不同屏幕比例进行布局调整：

```css
/* NES 内部比例 8:7 (~1.143) */
@media (aspect-ratio: 8/7) {
  .game-frame { max-width: 512px; }
}

/* 传统电视 4:3 比例 */
@media (min-aspect-ratio: 4/3) {
  .retro-layout { padding: 0 15%; }
}

/* 宽屏适配 */
@media (min-aspect-ratio: 16/9) {
  .retro-layout { padding: 0 25%; }
}
```

注意 `device-aspect-ratio` 已被弃用，应始终使用 `aspect-ratio`，它反映视口而非物理屏幕。

---

## 4. 性能考量

### 4.1 box-shadow 像素画性能

- **渲染成本**：浏览器需要为每个 `box-shadow` 条目执行独立的像素渲染操作。每个条目成本低，但总数达到数百时影响显著。
- **绘制复杂度（paint complexity）**：大量 shadow 条目会将元素提升为合成层(composite layer)，增加 GPU 内存占用。特别是动画时，每次变化都会触发重绘。
- **动画性能**：切换整个 `box-shadow` 值比逐条过渡更高效。使用 `steps(1)` 硬切而非渐变可以避免插值计算。
- **优化策略**：
  - 使用 SCSS 预处理器生成，避免运行时计算
  - 将默认（出现次数最多的）颜色省略，从 3~4 个值减为 2~3 个值（NES.css 的做法）
  - 优先使用 `transform: scale()` 放大而非更大的像素尺寸
  - 复杂精灵优先使用 Canvas 或 Sprite Sheet + `background-position` 动画

### 4.2 滤镜性能

- **`filter` 属性**：CSS 滤镜会在元素上创建新的渲染层，复杂滤镜（尤其是 SVG `url()` 引用）可能触发 GPU 光栅化。`blur()` 和 `drop-shadow()` 是最吃性能的。
- **`backdrop-filter`**：比 `filter` 更耗费性能，因为它需要处理元素背后的所有内容。
- **避免方法**：扫描线效果优先使用 CSS `repeating-linear-gradient` 而非 SVG `feTurbulence`，因为 CSS 渐变的渲染路径更高效。

### 4.3 字体加载

- 像素字体（如 Press Start 2P）在 16px 时表现最佳，放大到 24px 以上可能显示锯齿
- CJK 像素字体体积较大（Zpix 约 2-3MB），建议使用 `font-display: optional` 或 `swap`
- 使用 `unicode-range` 限制字体加载范围，仅加载需要的字符子集

### 4.4 最佳实践总结

1. **CSS 渐变扫描线** vs **SVG 滤镜**：前者性能更好，适用于简单的扫描线；后者效果更丰富但开销更大
2. **精灵动画**：CSS `background-position` + `steps()` 比 `box-shadow` 动画性能更好（GPU 加速），但 `box-shadow` 无需外部图片资源（无 HTTP 请求）
3. **边框**：`border-image` 内联 SVG 仅首次渲染成本，后续无额外开销
4. **Canvas**：适用于需要实时像素操作的场景，但要注意 `getImageData`/`putImageData` 的 GC 压力

---

## 参考来源

### 规范文档

- [CSS Images Module Level 3 — image-rendering](https://drafts.csswg.org/css-images-3/#the-image-rendering) — 定义 `image-rendering` 属性及其值
- [CSS Backgrounds and Borders Module Level 3 — box-shadow](https://drafts.csswg.org/css-backgrounds/#propdef-box-shadow) — 定义 `box-shadow` 属性及其多重值语法
- [CSS Images Module Level 3 — linear-gradient / repeating-linear-gradient](https://drafts.csswg.org/css-images-3/#funcdef-linear-gradient) — 定义渐变语法，硬色断点
- [CSS Fonts Module Level 4 — @font-face](https://drafts.csswg.org/css-fonts/#font-face-rule) — 定义自定义字体规则
- [CSS Borders and Box Decorations Module Level 4 — border-image](https://drafts.csswg.org/css-borders-4/) — 定义 border-image 属性系列
- [CSS Animations Level 1](https://drafts.csswg.org/css-animations/) — 定义 animation 属性和 @keyframes

### MDN Web Docs

- [MDN: image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering) — 各值说明、形式语法、浏览器兼容表
- [MDN: box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow) — 多重 shadow 的堆叠顺序、动画插值规则、性能注意事项
- [MDN: linear-gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient) — 硬色断点、autoposition 等高级用法
- [MDN: filter](https://developer.mozilla.org/en-US/docs/Web/CSS/filter) — 所有滤镜函数详解，含 SVG filter 引用
- [MDN: SVG filter 元素](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/filter) — 所有滤镜原语列表及用途
- [MDN: border-image](https://developer.mozilla.org/en-US/docs/Web/CSS/border-image) — 9 切片原理、slice/width/outset 详解
- [MDN: outline](https://developer.mozilla.org/en-US/docs/Web/CSS/outline) — outline 与 border 的区别，outline-offset
- [MDN: aspect-ratio media query](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/aspect-ratio) — 4:3 和 8:7 比例适配
- [MDN: CSS Animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations) — @keyframes、animation 属性、多动画组合
- [MDN: easing-function / steps()](https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function#steps) — 步进函数的参数详解
- [MDN: Pixel manipulation with canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas) — ImageData、getImageData/putImageData 用法
- [MDN: @font-face](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face) — 自定义字体规则详解

### NES.css 框架源码

- [NES.css GitHub 仓库](https://github.com/nostalgic-css/NES.css) — MIT 协议，SCSS 源码
- [buttons.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/elements/buttons.scss) — 按钮系统，核心 inline box-shadow 3D 效果实现（第 1-91 行）
- [rounded-corners-mixin.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/utilities/rounded-corners-mixin.scss) — border-image + 内联 SVG 实现像素圆角（第 1-110 行）
- [color-palette.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/base/color-palette.scss) — 完整 NES 64 色调色板（第 1-72 行）
- [icon-mixin.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/utilities/icon-mixin.scss) — box-shadow 像素画生成器 mixin（第 1-97 行）
- [variables.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/base/variables.scss) — 字体、尺寸、颜色变量定义（第 1-42 行）
- [containers.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/elements/containers.scss) — 容器组件（第 1-117 行）
- [dialogs.scss](https://github.com/nostalgic-css/NES.css/blob/develop/scss/elements/dialogs.scss) — 对话框组件（第 1-30 行）
- [README-zh-CN.md](https://github.com/nostalgic-css/NES.css/blob/develop/.github/README-zh-CN.md) — 简体中文 README

### NES 硬件参考

- [nesdev.org: PPU palettes](https://www.nesdev.org/wiki/PPU_palettes) — NES PPU 调色板技术细节，颜色编码（6-bit VVHHHH 格式）
- [NES 2C02 技术参考](https://www.nesdev.org/2C02%20technical%20reference.TXT) — 原始技术文档
- [Wikipedia: List of video game console palettes](https://en.wikipedia.org/wiki/List_of_video_game_console_palettes) — NES 调色板表格（NES.css 引用的来源）

### 社区与工具

- [Press Start 2P (Google Fonts)](https://fonts.google.com/specimen/Press+Start+2P) — 最常用的 NES 风格像素字体
- [Zpix (最像素)](https://github.com/SolidZORO/zpix-pixel-font) — 中文字体像素字体
- [box-shadow-pixels (npm)](https://npm.io/package/box-shadow-pixels) — 从像素网格生成 box-shadow CSS 的工具
- [FoxyStoat/pixel-art (GitHub)](https://github.com/FoxyStoat/pixel-art) — 单 div + box-shadow 像素画示例集

---

## 5. 项目实践踩坑

### 5.1 center-overlay 双层边框汇聚

**问题**：Markdown/Image 预览面板出现 4-6px 的异常粗边框。

**根因**：App.tsx 中 MarkdownPreview / ImagePreview 的渲染结构存在双层 `center-overlay`：

```
外层 wrapper（App.tsx:2307）              ← center-overlay + border-ide-border
  └─ 内层组件（MarkdownPreview.tsx:293）  ← center-overlay（无 border-ide-border）
       └─ header（h-10 + border-b）       ← 内部分隔线
```

CSS snippet 对 `.center-overlay` 设 `border: 2px solid`，两层各加 2px 外框，叠加 + header 底线 = 4-6px。

**解决**：用 `.center-overlay.border-ide-border` 限定只给外层（App.tsx 中同时挂了 `border-ide-border` Tailwind class 的 wrapper）加边框，内层不受影响。

```css
/* 只给外层容器加 NES 边框，内层组件不加 */
.center-overlay.border-ide-border {
  border: 2px solid rgb(var(--ide-border)) !important;
}
```

**教训**：CSS snippet 覆盖全局 class 时要注意同名 class 的嵌套复用场景，优先用组合选择器限定作用范围。
