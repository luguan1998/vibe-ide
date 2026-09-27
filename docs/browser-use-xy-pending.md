# browser-use 点击坐标：待验证 / 待修

> 来源：2026-09-27 修 computer-use 坐标契约（commit `4fe6bb16`）时顺带发现。
> 状态：**未验证、未修改**。是否中招取决于页面图有没有被客户端压过，必须实测。

## 已确认的机制（两边共用同一个客户端）

截图交付链路：MCP 交出去的 PNG → 客户端转 **JPEG** 并把长边压到 **2000**。

证据：本机 2560x1440 的屏截图，从会话 JSONL 里解出 22 张图块，**全部是 `2000x1125` / `image/jpeg`**（2560/2000 = 1.28，两轴同比）。

推论：**模型看到的像素空间既不等于 MCP 原图，也不等于元数据里报的 `physical`**。更糟的是模型自报的格子还不稳定——本次 computer-use 实测中，我按 dip(1707) 的格子读数、乘 1.5 才命中，而真实交付图是 2000 宽（正确系数该是 1.28）。所以「照图读数 + 除以/乘以某个 scale」这类契约本质不可靠，computer-use 已改为收归一化 0..1。

## browser-use 现状

- 唯一吃坐标的工具是 `browser_click_xy`（`src/main/browser-use.ts:950`），契约是 **top-viewport CSS px**（与 `browser_snapshot boxes:true` 的 rect 同空间）
- `browser_screenshot` 回一行换算提示（`src/main/browser-use.ts:1118`）：

  ```
  VIEWPORT: 1200x800 CSS px (zoom 1.00), image 1800x1200 px — for browser_click_xy: cssX = screenshotX / 1.500
  ```

  `scale = 图片px / viewport css` —— **这个公式的前提「模型读到的像素 = PNG 像素」正是 computer-use 栽的那个假设**
- 暴露面比 computer-use 窄：ref 系工具（`click`/`fill`/`press`）走真实 DOM 几何，不经视觉、不受缩放影响；只有 canvas 类目标（WPS/WebOffice 表格、地图）必须走截图这条路
- 旁证：`src/main/browser-use.ts:295` 那条「CDP 输入坐标是（缩放后）主框架 CSS px … 须乘 zoomFactor — 反复踩点」的注释，是同一个坑留下的
- `browser_scroll` 的 dx/dy 只作用在页面中心，不带坐标；`box` rect 是 DOM 真值 —— 这两处不受影响

## 预期（待实测）

浏览器 PNG = viewport CSS × dpr（本机 dpr = 1.5）。按长边 2000 的规则：

| viewport CSS 宽 | PNG 宽 | 是否被压 | note 的 scale 是否成立 |
|---|---|---|---|
| ≤1333 | ≤2000 | 不压 | 成立，无需改 |
| >1333 | >2000 | 压到 2000 | 不成立，偏差 = PNG宽/2000（1400→5%） |

即：小窗大概率本来是对的，大窗才开始偏，且偏差只有百分之几 —— 比 computer-use 的 33% 更隐蔽，容易被误判成「模型眼神不好」。

## 验证方案

### V0 交付尺寸（模型无关，最硬）

跑 `browser_screenshot` 之后，从会话 JSONL 里量图像块的真实尺寸，与 note 里的 `image WxH` 对比。

JSONL 位置：`~/.claude/projects/<项目slug>/<session>.jsonl`（本项目实测在 `~/.claude/projects/E--ai-claudeui/`，文件名就是 session id）；若该会话用了自定义 configDir，就去那个目录找。

```bash
node -e '
const fs=require("fs"), f=process.argv[1];
const size=b=>{for(let i=2;i<b.length-9;){if(b[i]!==255){i++;continue}
 const m=b[i+1]; if(m===216||m===1||(m>=208&&m<=215)){i+=2;continue}
 if(m>=192&&m<=207&&m!==196&&m!==200&&m!==204) return b.readUInt16BE(i+7)+"x"+b.readUInt16BE(i+5);
 i+=2+b.readUInt16BE(i+2)} return "?"};
const t={}; for(const L of fs.readFileSync(f,"utf8").split("\n")){ if(!L.trim())continue;
 let o; try{o=JSON.parse(L)}catch{continue}
 (function w(n){ if(!n||typeof n!=="object")return; if(Array.isArray(n))return n.forEach(w);
  if(n.type==="image"&&n.source&&n.source.data){const k=size(Buffer.from(n.source.data,"base64")); t[k]=(t[k]||0)+1}
  for(const k in n) w(n[k])})(o)}
console.log(t)' "~/.claude/projects/E--ai-claudeui/<session>.jsonl"
```

判定：交付尺寸 == note 里的 `image` → 没被压，note 成立；交付 < note → 被压，系数 = note宽 / 交付宽，按上表算偏差。

### V1 click_xy 空间自检（噪声≈0，先排除低级错误）

先证明 `click_xy` 收的确实是 top-viewport CSS px（dispatch 链 / zoom / iframe offset 都没问题），再谈缩放。标尺用 CSS px 标注，模型可直接读标签，不靠目测。

```js
(()=>{ window.__p={hits:[]}; document.__ui?.remove();
 const w=document.createElement('div'); document.__ui=w;
 w.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:10px monospace';
 for(let x=0;x<innerWidth;x+=100){const d=document.createElement('div');
  d.style.cssText=`position:fixed;top:0;left:${x}px;width:1px;height:100%;background:rgba(255,0,0,.35)`;w.append(d);
  if(x%200===0){const t=document.createElement('div');t.textContent='x'+x;
   t.style.cssText=`position:fixed;top:0;left:${x+2}px;color:#c00`;w.append(t)}}
 for(let y=0;y<innerHeight;y+=100){const d=document.createElement('div');
  d.style.cssText=`position:fixed;left:0;top:${y}px;height:1px;width:100%;background:rgba(0,0,255,.35)`;w.append(d);
  if(y%200===0){const t=document.createElement('div');t.textContent='y'+y;
   t.style.cssText=`position:fixed;left:2px;top:${y+2}px;color:#00c`;w.append(t)}}
 window.__targets=[[150,150],[450,120],[900,200],[1500,200],[600,400],[1200,600],[300,700],[1000,750],[1700,500],[150,850]];
 window.__targets.forEach(([x,y],i)=>{const c=document.createElement('div'); c.id='pt'+i;
  c.style.cssText=`position:fixed;left:${x-12}px;top:${y-12}px;width:24px;height:24px;border:2px solid #0a0;border-radius:50%;background:rgba(0,170,0,.25);pointer-events:auto`;
  w.append(c)});
 addEventListener('mousedown',e=>window.__p.hits.push({x:e.clientX,y:e.clientY,el:e.target.id||e.target.tagName}),true);
 return 'ok '+innerWidth+'x'+innerHeight})()
```

流程：`browser_screenshot` → 看标尺读出 pt3 的 CSS 坐标 → `click_xy` 点它 → 期望 `hit` 行报 `pt3`，且 `browser_eval('return window.__p.hits')` 里的落点与 `(900,200)` 差 ≤1px。

### V2 交付缩放回归（验 `css = screenshotX / scale`）

同一个注入页，**不许读标尺标签**，纯按 note 的公式换算，连点 6~10 个目标，每次都 `browser_eval('return window.__p.hits')` 记落点。

拟合 `landed = a + b·intended`（`b = 模型感知的图宽 / PNG 宽`）：

| b | 含义 | 处置 |
|---|---|---|
| ≈1.00 | 图没被压，note 成立 | 不改 |
| ≈ 2000/PNG宽 | 图被压到 2000，note 过校正，点击偏向原点 | 按下方方案改 |
| 其它 <1 | 模型格子与交付尺寸、PNG 都不一致 | 必须改归一化 |
| a ≠ 0 | 另有固定偏移（滚动条 / iframe 边框） | 单独修 |

### V3 不点击的交叉校验（最省 token）

`browser_snapshot boxes:true` 拿某元素的真实 CSS rect 中心 → `browser_screenshot` → 按 note 公式从图上反推该点 → 与真值比，差值即偏差。一次调用即可。

**顺序建议**：V0 先跑（一条命令拿到交付尺寸）→ PNG ≤2000 就 V3 抽一次确认，收工；否则上 V1/V2 定位是 dispatch 还是缩放。

## 待修方案（仅在 V0/V3 判定需要时）

不能照搬 computer-use 的「全面归一化」——`x/y` 的 CSS px 与 `snapshot boxes` rect 同空间，这条链是准的、有用的，废了可惜。推荐：

- `browser_click_xy` 保留 `x/y`（CSS px），**另加 `nx/ny`（0..1，相对最近一张 `browser_screenshot`）**，服务端按 `css = nx × viewport.w` 换算
- `browser_screenshot` 的 VIEWPORT 行与工具描述改成：canvas 目标走 `nx/ny` 报比例；`x/y` 仍是 CSS px（配 rect 用）
- 顺手删掉行里的 `image WxH px` 与 `scale` 两个数字（和 computer-use 一样，别再把「图上像素尺寸」摆出来当坐标空间）
- 备选（不加参数）：只改 note，教模型「报比例 × viewport 宽」，乘法在模型侧做，代价是多一次心算
