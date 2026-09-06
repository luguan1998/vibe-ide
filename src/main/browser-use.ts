import { app } from 'electron'
import type { WebContents, WebFrameMain } from 'electron'
import { createServer } from 'net'
import { join } from 'path'
import { unlinkSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'

export interface BrowserToolResult {
  content: any[]
  isError: boolean
}

// ---------- webview guest registry ----------

const live = new Map<number, WebContents>()
const order: number[] = []

export function trackWebview(contents: WebContents): void {
  live.set(contents.id, contents)
  order.push(contents.id)
  contents.on('did-navigate', () => {
    refFrames.clear()
  })
  contents.once('destroyed', () => {
    live.delete(contents.id)
    const i = order.indexOf(contents.id)
    if (i >= 0) order.splice(i, 1)
  })
}

function active(): WebContents | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const c = live.get(order[i])
    if (c && !c.isDestroyed()) return c
  }
  return null
}

// ---------- helpers ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function textResult(s: string, isError = false): BrowserToolResult {
  return { content: [{ type: 'text', text: s }], isError }
}

function noBrowser(): BrowserToolResult {
  return textResult(
    'No embedded browser is open. Ask the user to click the globe "Web Debug" (网页调试) button on the right side of the top title bar (next to the search icon) — the browser opens docked on the right by default — then navigate it to the target page and try again.',
    true,
  )
}

function okRef(ref: unknown): string | null {
  return typeof ref === 'string' && /^e\d+$/.test(ref) ? ref : null
}

function lostResult(ref: string): BrowserToolResult {
  return textResult(`ref ${ref} no longer exists — page changed since that snapshot. Take a fresh browser_snapshot.`, true)
}

async function settlePage(c: WebContents, budget = 15000): Promise<void> {
  await sleep(150)
  const t0 = Date.now()
  while (c.isLoading() && Date.now() - t0 < budget) await sleep(150)
  await sleep(300)
}

// ---------- frame plumbing (cross-origin capable) ----------

const refFrames = new Map<string, WebFrameMain>()

function framesOf(c: WebContents): WebFrameMain[] {
  const out: WebFrameMain[] = []
  try {
    const mf = c.mainFrame
    if (!mf) return out
    out.push(mf)
    try {
      const sub = mf.framesInSubtree
      if (sub) for (const f of sub) if (!sameFrame(f, mf)) out.push(f)
    } catch { /* ignore */ }
  } catch { /* ignore */ }
  return out
}

async function safeExec<T = any>(f: WebFrameMain, js: string, ug = false): Promise<{ v?: T; err?: string }> {
  try {
    return { v: (await f.executeJavaScript(js, ug)) as T }
  } catch (e: any) {
    return { err: String(e?.message || e) }
  }
}

function frameUrl(f: WebFrameMain): string {
  try {
    return f.url || ''
  } catch {
    return ''
  }
}

// WebFrameMain 跨 getter 调用不保证同实例，文档背书的可比字段是 routingId
function sameFrame(a: WebFrameMain, b: WebFrameMain): boolean {
  if (a === b) return true
  try {
    const ra = (a as any).routingId
    return typeof ra === 'number' && ra === (b as any).routingId
  } catch {
    return false
  }
}

function refFrame(ref: string): WebFrameMain | null {
  const f = refFrames.get(ref)
  if (!f) return null
  try {
    if (!f.url) {
      refFrames.delete(ref)
      return null
    }
  } catch {
    refFrames.delete(ref)
    return null
  }
  return f
}

async function execOnRef(c: WebContents, ref: string, job: string): Promise<any> {
  const f = refFrame(ref)
  if (f && !sameFrame(f, c.mainFrame)) {
    const r = await safeExec(f, job)
    if (r.err) {
      refFrames.delete(ref)
      return { lost: 1 }
    }
    return r.v
  }
  if (f) return await f.executeJavaScript(job)
  return await c.executeJavaScript(job)
}

function normUrl(u: string): string {
  try {
    const x = new URL(u)
    x.hash = ''
    return x.href
  } catch {
    return u
  }
}

const FRAME_RECTS_FN = String.raw`(function () {
var out = [];
function collect(root) {
  var els = root.querySelectorAll('iframe, frame');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var r = el.getBoundingClientRect();
    out.push({ src: el.getAttribute('src') || '', href: el.src || '', name: el.getAttribute('name') || '', srcdoc: el.hasAttribute('srcdoc'), x: r.left, y: r.top, w: r.width, h: r.height });
  }
  var all = root.querySelectorAll('*');
  for (var j = 0; j < all.length; j++) { try { if (all[j].shadowRoot) collect(all[j].shadowRoot) } catch(e){} }
}
collect(document);
return out;
})`

function matchHostRect(rects: any[], want: string, raw: string, name: string, srcdoc: boolean, idx: number, childCount: number): any {
  if (!rects.length) return null
  const exact = rects.filter((r) => normUrl(r.href || '') === want)
  if (exact.length) return exact[0]
  const bySrc = rects.filter((r) => r.src && (r.src === raw || normUrl(r.src) === want))
  if (bySrc.length) return bySrc[0]
  if (srcdoc) {
    const d = rects.find((r) => r.srcdoc)
    if (d) return d
  }
  if (want === 'about:blank/') {
    const b = rects.find((r) => !r.src)
    if (b) return b
  }
  if (name) {
    const n = rects.find((r) => r.name === name)
    if (n) return n
  }
  if (rects.length === childCount && idx >= 0 && idx < rects.length) return rects[idx]
  const vis = rects.find((r) => r.w || r.h)
  return vis || rects[0]
}

async function frameOffsetCss(c: WebContents, f: WebFrameMain): Promise<{ x: number; y: number } | null> {
  let ox = 0
  let oy = 0
  let cur: WebFrameMain = f
  for (let hops = 0; hops < 16; hops++) {
    let parent: WebFrameMain | null = null
    try {
      parent = cur.parent
    } catch {
      return null
    }
    if (!parent) return { x: ox, y: oy }
    const kids: WebFrameMain[] = []
    try {
      const sub = parent.frames
      if (sub) for (const x of sub) kids.push(x)
    } catch { /* ignore */ }
    let childName = ''
    try {
      childName = (cur as any).name || ''
    } catch { /* ignore */ }
    const url = frameUrl(cur)
    const r = await safeExec<any[]>(parent, FRAME_RECTS_FN + '()')
    if (!Array.isArray(r.v)) return null
    let idx = -1
    for (let i = 0; i < kids.length; i++) if (sameFrame(kids[i], cur)) { idx = i; break }
    const hit = matchHostRect(r.v, normUrl(url), url.split('#')[0], childName, url.startsWith('about:srcdoc'), idx, kids.length)
    if (!hit) return null
    ox += Number(hit.x) || 0
    oy += Number(hit.y) || 0
    cur = parent
  }
  return { x: ox, y: oy }
}

async function viewportCss(c: WebContents): Promise<{ w: number; h: number }> {
  try {
    const v = await c.executeJavaScript('({ w: innerWidth, h: innerHeight })')
    if (v && Number(v.w) > 0 && Number(v.h) > 0) return { w: Number(v.w), h: Number(v.h) }
  } catch { /* ignore */ }
  return { w: 800, h: 600 }
}

async function zoomOf(c: WebContents): Promise<number> {
  try {
    const z = await (c as any).getZoomFactor()
    const n = Number(z)
    return n > 0 ? n : 1
  } catch {
    return 1
  }
}

const SYNTH_NOTE = 'fell back to synthetic input (CDP unavailable) — events may not reach cross-origin iframes'

async function withCdp<T>(c: WebContents, fn: (dbg: any) => Promise<T>): Promise<{ v?: T; err?: string }> {
  try {
    if (c.isDestroyed()) return { err: 'webContents destroyed' }
  } catch {
    return { err: 'webContents destroyed' }
  }
  const dbg: any = (c as any).debugger
  if (!dbg) return { err: 'no debugger' }
  let attachedHere = false
  try {
    dbg.attach('1.3')
    attachedHere = true
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (!/already attached/i.test(msg)) return { err: msg }
  }
  if (!attachedHere) return { err: 'debugger attached elsewhere' }
  try {
    return { v: await fn(dbg) }
  } catch (e: any) {
    return { err: String(e?.message || e) }
  } finally {
    try {
      dbg.detach()
    } catch { /* ignore */ }
  }
}

async function mouseClick(c: WebContents, x: number, y: number, button: string, count: number): Promise<string | null> {
  const btn = button === 'right' ? 'right' : 'left'
  const r = await withCdp(c, async (dbg) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    const down = (cc: number) => dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: btn, clickCount: cc })
    const up = (cc: number) => dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: btn, clickCount: cc })
    if (count >= 2) {
      await down(1)
      await up(1)
      await sleep(60)
      await down(2)
      await up(2)
    } else {
      await down(1)
      await sleep(40)
      await up(1)
    }
  })
  if (!r.err) return null
  // CDP 输入坐标是（缩放后）主框架 CSS px；sendInputEvent 是 DIP，须乘 zoomFactor — 反复踩点
  const z = await zoomOf(c)
  const sx = Math.round(x * z)
  const sy = Math.round(y * z)
  c.sendInputEvent({ type: 'mouseMove', x: sx, y: sy } as any)
  await sleep(30)
  if (count >= 2) {
    c.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: btn, clickCount: 1 } as any)
    c.sendInputEvent({ type: 'mouseUp', x: sx, y: sy, button: btn, clickCount: 1 } as any)
    await sleep(60)
    c.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: btn, clickCount: 2 } as any)
    c.sendInputEvent({ type: 'mouseUp', x: sx, y: sy, button: btn, clickCount: 2 } as any)
  } else {
    c.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: btn, clickCount: 1 } as any)
    await sleep(40)
    c.sendInputEvent({ type: 'mouseUp', x: sx, y: sy, button: btn, clickCount: 1 } as any)
  }
  return SYNTH_NOTE
}

async function insertTextViaDebugger(c: WebContents, text: string): Promise<{ ok?: 1; err?: string }> {
  const r = await withCdp(c, async (dbg) => {
    await dbg.sendCommand('Input.insertText', { text })
  })
  return r.err ? { err: r.err } : { ok: 1 }
}

async function anyFrameHasText(c: WebContents, needle: string): Promise<boolean> {
  for (const f of framesOf(c)) {
    const r = await safeExec<boolean>(f, `(${HAS_TEXT_FN})(${JSON.stringify(needle)})`)
    if (r.v === true) return true
  }
  return false
}

// ---- input activation ----
// JS focus()（fill/FOCUS_FN）设置的活动元素 CDP 键盘事件不派发：填充后直接 press Enter 页面无响应，
// 真实鼠标点过一次输入框后同一次 press 立即生效（智谱清言 double 验证）。故键盘派发前对文本输入类
// 元素先做一次真实点击激活，点击后再把 caret 恢复到文末（点击中心会移动 caret）。
// 非文本输入控件（按钮/链接/checkbox）不激活——多余 click 会先触发一次 click，与 Enter 双触发。
async function activateTypingInput(c: WebContents, ref: string | null, frame: WebFrameMain | null): Promise<string | null> {
  const q = ref
    ? `document.querySelector('[data-vibe-ref="${ref}"]')`
    : 'document.activeElement'
  const js = `(function(){
var el = ${q};
if (!el) return { gone: 1 };
var tag = el.tagName;
if (tag === 'INPUT') {
  var ty = (el.type || 'text').toLowerCase();
  if (ty === 'checkbox' || ty === 'radio' || ty === 'button' || ty === 'submit' || ty === 'reset' || ty === 'file' || ty === 'hidden') return { gone: 1 };
}
var isEd = false; try { isEd = !!el.isContentEditable; } catch (e) {}
if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !isEd) return { gone: 1 };
var r = el.getBoundingClientRect();
if (!r.width || !r.height) return { gone: 1 };
return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
})()`
  let r: { v?: any; err?: string }
  if (frame && !sameFrame(frame, c.mainFrame)) r = await safeExec<any>(frame, js)
  else r = await safeExec<any>(frame || c.mainFrame, js)
  if (r.err || !r.v || r.v.gone) return null
  let x = Number(r.v.cx) || 0
  let y = Number(r.v.cy) || 0
  if (frame && !sameFrame(frame, c.mainFrame)) {
    const off = await frameOffsetCss(c, frame)
    if (!off) return null
    x += off.x
    y += off.y
  }
  const vp = await viewportCss(c)
  x = Math.max(0, Math.min(vp.w - 1, Math.round(x)))
  y = Math.max(0, Math.min(vp.h - 1, Math.round(y)))
  const note = await mouseClick(c, x, y, 'left', 1)
  await safeExec(frame || c.mainFrame, `(function(){
var el = document.activeElement;
try {
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) { var n = el.value.length; el.setSelectionRange(n, n); }
  else if (el && el.isContentEditable) { var sel = window.getSelection(); var rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false); sel.removeAllRanges(); sel.addRange(rg); }
} catch (e) {}
})()`)
  return note
}

// ---- hit test (click feedback) ----
// click_xy 点完无反馈，"没报错=成功"是静默失败的根源：点击前用 elementFromPoint 报出命中元素，
// 无标注的 div/svg 图标按钮（.enter / .think-mode-trigger 类）靠 cls 一目了然。
// 坐标与 CDP 一致（layout CSS px）；须点击前查——点击后页面 rerender，报的是点击后的元素。
const HIT_FN = String.raw`(function (x, y) {
function T(s){ return (s||'').replace(/\s+/g,' ').trim(); }
var el = document.elementFromPoint(x, y);
if (!el) return { tag: 'NULL' };
var n = el, res = null;
for (var i = 0; i < 6 && n; i++) {
  // SVG 的 className 是 SVGAnimatedString，直接字符串化会变 "[object SVGAnimatedString]" 非空坏串，
  // 会让 svg 自己被当成"带 class 的可报元素"提前 break——一律走 getAttribute('class') 取字符串
  var cls = n.getAttribute('class') || '';
  var tag = n.tagName;
  if (tag !== 'SVG' && tag !== 'PATH' && tag !== 'G' && (cls.length > 0 || n.getAttribute('role'))) {
    var r = n.getBoundingClientRect();
    res = { tag: tag, cls: cls.slice(0, 56), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), t: T(n.innerText || n.textContent || '').slice(0, 40) };
    break;
  }
  n = n.parentElement;
}
if (!res) { var r0 = el.getBoundingClientRect(); res = { tag: el.tagName, cls: '', x: Math.round(r0.left), y: Math.round(r0.top), w: Math.round(r0.width), h: Math.round(r0.height), t: T(el.innerText || '').slice(0, 40) }; }
return res;
})`

function fmtHit(v: { tag: string; cls: string; w: number; h: number; x: number; y: number; t: string }): string {
  const bits = v.cls ? v.cls.split(/\s+/).slice(0, 4).join('.') : ''
  const head = `hit=<${String(v.tag).toLowerCase()}${bits ? '.' + bits : ''}> ${v.w}x${v.h} @${v.x},${v.y}`
  return v.t ? `${head} "${v.t}"` : head
}

async function hitTestInfo(c: WebContents, x: number, y: number): Promise<string | null> {
  const r = await safeExec<any>(c.mainFrame, `(${HIT_FN})(${Math.round(x)},${Math.round(y)})`)
  if (r.err || !r.v || r.v.tag === 'NULL') return null
  return fmtHit(r.v)
}

// ---------- page-side scripts (run in guest main frame) ----------

const SNAP_FN = String.raw`(function (base, max, boxes, dx, dy) {
var NATIVE = { INPUT: 1, SELECT: 1, TEXTAREA: 1 };
var STRONG = { A: 1, BUTTON: 1, SUMMARY: 1 };
var STRUC = { FORM:1, MAIN:1, SECTION:1, NAV:1, ASIDE:1, HEADER:1, FOOTER:1, ARTICLE:1, BODY:1, HTML:1, UL:1, OL:1, TABLE:1, THEAD:1, TBODY:1, TR:1, FIELDSET:1 };
var WROLES = { button:1, link:1, textbox:1, searchbox:1, checkbox:1, radio:1, combobox:1, listbox:1, menuitem:1, menuitemcheckbox:1, menuitemradio:1, option:1, slider:1, spinbutton:1, switch:1, tab:1, treeitem:1 };
var items = []; var truncated = 0; dx = dx || 0; dy = dy || 0;
function T(s){ return (s||'').replace(/\s+/g,' ').trim(); }
function clip(s,n){ s=T(s); return s.length>n ? s.slice(0,n)+'~' : s; }
function attr(el,n){ try { return el.getAttribute(n) || ''; } catch(e){ return ''; } }
function vis(el){ try { var r=el.getBoundingClientRect(); if(!r.width&&!r.height) return 0; var cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) return 0; return 1; } catch(e){ return 0; } }
function nameOf(el){
  try { if (el.labels && el.labels.length) { var lt = T(Array.prototype.map.call(el.labels, function(l){ return l.innerText; }).join(' ')); if (lt) return clip(lt, 80); } } catch(e){}
  var a = attr(el,'aria-label'); if (a) return clip(a, 80);
  var lb = attr(el,'aria-labelledby');
  if (lb) { try { var root = (el.getRootNode && el.getRootNode()) || document; var jt = T(lb.split(/\s+/).map(function(id){ var n=document.getElementById(id)||(root.getElementById&&root.getElementById(id)); return n?n.innerText:''; }).join(' ')); if (jt) return clip(jt, 80); } catch(e){} }
  var ph = attr(el,'placeholder'); if (ph) return clip(ph, 60);
  var alt = attr(el,'alt'); if (alt) return clip(alt, 60);
  var own = '';
  for (var c = el.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3) own += c.nodeValue; }
  own = T(own); if (own) return clip(own, 80);
  var ti = attr(el,'title'); if (ti) return clip(ti, 50);
  var nm = attr(el,'name'); if (nm) return clip(nm, 50);
  return '';
}
function line(el){
  var p = []; var tag = el.tagName; var role = attr(el,'role'); var txtv = '';
  if (tag === 'INPUT') {
    var it = (el.type || 'text').toLowerCase();
    p.push('input[' + it + ']');
    if (it === 'checkbox' || it === 'radio') p.push('checked=' + (el.checked ? 1 : 0));
    else if (it === 'password') p.push('v=***');
    else p.push('v=' + JSON.stringify(clip(el.value, 50)));
  } else if (tag === 'TEXTAREA') {
    txtv = clip(el.value, 60); p.push('textarea v=' + JSON.stringify(txtv));
  } else if (tag === 'SELECT') {
    var sv = ''; try { sv = Array.prototype.map.call(el.selectedOptions || [], function(o){ return T(o.text); }).join('|'); } catch(e) { sv = el.value; }
    p.push('select[' + (el.multiple ? 'multiple,' : '') + clip(el.name || el.id, 25) + '] v=' + JSON.stringify(clip(sv, 60)));
  } else if (el.isContentEditable) {
    txtv = clip(el.innerText || el.textContent, 50); p.push('editable v=' + JSON.stringify(txtv));
  } else if (role) {
    txtv = clip(el.innerText || el.textContent, 40); p.push('[' + role + '] v=' + JSON.stringify(txtv));
  } else {
    txtv = clip(el.innerText || el.textContent, 40); p.push(tag.toLowerCase() + ' v=' + JSON.stringify(txtv));
  }
  var nm = nameOf(el);
  if (nm && nm !== txtv) p.push('label=' + JSON.stringify(nm));
  if (el.disabled || attr(el,'aria-disabled') === 'true') p.push('disabled');
  if (el.required) p.push('required');
  if (tag === 'A' && el.href) p.push('href=' + clip(el.href, 80));
  if (boxes) { var r = el.getBoundingClientRect(); p.push('box=' + Math.round(r.left + dx) + ',' + Math.round(r.top + dy) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  return p.join(' ');
}
function walk(node, inside) {
  if (!node || !node.children) return;
  for (var i = 0; i < node.children.length; i++) {
    var el = node.children[i];
    var tag = el.tagName;
    if (tag==='SCRIPT'||tag==='STYLE'||tag==='LINK'||tag==='META'||tag==='NOSCRIPT'||tag==='TEMPLATE'||tag==='HEAD') continue;
    if (attr(el,'aria-hidden') === 'true') continue;
    var role = attr(el,'role');
    var isNative = NATIVE[tag] === 1 && el.type !== 'hidden';
    var isEd = false; try { isEd = !!el.isContentEditable; } catch(e){}
    var isWidget = isNative || isEd || WROLES[role] === 1;
    var isStrong = STRONG[tag] === 1 && !(tag === 'A' && !el.hasAttribute('href'));
    var isButtonish = isStrong || role==='button' || role==='link' || role==='tab' || role==='menuitem';
    var clickable = 0;
    if (!isWidget && !isStrong && !inside && tag !== 'LABEL' && !STRUC[tag]) {
      try { if (getComputedStyle(el).cursor === 'pointer') clickable = 1; } catch(e){}
      if (!clickable) { for (var a = 0; a < el.attributes.length; a++) { var an = el.attributes[a].name; if (an.length > 2 && an.slice(0,2) === 'on') { clickable = 1; break; } } }
    }
    var rec = (isWidget || isStrong || clickable) && (isNative || !inside);
    if (rec && vis(el)) {
      base++;
      try { el.setAttribute('data-vibe-ref', 'e' + base); } catch(e){}
      if (items.length < max) items.push('e' + base + ' ' + line(el));
      else truncated = 1;
    }
    var ni = inside || isButtonish;
    if (el.shadowRoot) walk(el.shadowRoot, ni);
    walk(el, ni);
    if (truncated) return;
  }
}
walk(document.documentElement, 0);
return { url: location.href, title: document.title, items: items, base: base, truncated: truncated };
})`

const CLICK_FN = String.raw`(async function (ref, button, count) {
var el = document.querySelector('[data-vibe-ref="' + ref + '"]');
if (!el) return { lost: 1 };
try { if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { err: 'element ' + ref + ' is disabled' }; } catch(e){}
el.scrollIntoView({ block: 'center', inline: 'center' });
await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 90); }); });
var r = el.getBoundingClientRect();
var tx = ''; try { tx = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); } catch (e) {}
var cls = el.getAttribute('class') || '';
return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, tag: el.tagName, cls: cls.slice(0, 56), tx: tx };
})`

const FOCUS_FN = String.raw`(function (ref) {
var el = document.querySelector('[data-vibe-ref="' + ref + '"]');
if (!el) return { lost: 1 };
el.scrollIntoView({ block: 'center' });
try { el.focus(); } catch(e){}
return { ok: 1, tag: el.tagName };
})`

const FILL_FNS = String.raw`
function T(s){ return (s||'').replace(/\s+/g,' ').trim(); }
function setNative(node, v) {
  var proto = node.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : node.tagName==='SELECT' ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  var d = Object.getOwnPropertyDescriptor(proto, 'value');
  if (d && d.set) d.set.call(node, v); else node.value = v;
}
async function fillOne(el, text) {
  var tag = el.tagName;
  if (tag === 'SELECT') {
    var opts = Array.prototype.slice.call(el.options);
    var want = T(text).toLowerCase(); var idx = -1; var i;
    for (i = 0; i < opts.length; i++) { var o = opts[i]; if ((o.value||'').toLowerCase() === want || T(o.text).toLowerCase() === want) { idx = i; break; } }
    if (idx < 0) { var wc = want.replace(/\s+/g,''); for (i = 0; i < opts.length; i++) { if (T(opts[i].text).replace(/\s+/g,'').toLowerCase().indexOf(wc) >= 0) { idx = i; break; } } }
    if (idx < 0) return 'no option matched "' + text + '"; available: ' + (opts.slice(0,30).map(function(o){ return T(o.text); }).filter(Boolean).join(' | ') || '(empty select)');
    if (el.multiple) { Array.prototype.slice.call(el.options).forEach(function(oo, ii){ oo.selected = (ii === idx); }); el.selectedIndex = idx; }
    else el.selectedIndex = idx;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return null;
  }
  if (tag === 'INPUT' && el.type === 'checkbox') {
    var wantC = /^(true|1|yes|on)$/i.test(T(text));
    if (el.checked !== wantC) el.click();
    return null;
  }
  if (tag === 'INPUT' && el.type === 'radio') {
    var wantR = /^(true|1)$/i.test(T(text));
    if (wantR) { if (!el.checked) el.click(); }
    else if (el.checked) {
      var g = document.getElementsByName(el.name);
      for (var r = 0; r < g.length; r++) { if (g[r] !== el && g[r].type === 'radio') { g[r].click(); break; } }
    }
    return null;
  }
  if (el.isContentEditable) {
    el.focus();
    try {
      var rng = document.createRange(); rng.selectNodeContents(el);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
      if (!document.execCommand('insertText', false, text)) { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
    } catch (e) { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
    return null;
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (tag === 'INPUT' && el.type === 'file') return 'file inputs cannot be filled yet';
    el.focus();
    setNative(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return null;
  }
  return 'unsupported element <' + tag.toLowerCase() + '> — click it and use browser_press, or browser_eval';
}
`

function fillJob(ref: string, value: string): string {
  return String.raw`(async function () {
${FILL_FNS}
var el = document.querySelector('[data-vibe-ref="${ref}"]');
if (!el) return { lost: 1 };
if (el.disabled) return { skipped: "${ref} is disabled" };
var err = await fillOne(el, ${JSON.stringify(value)});
if (err) return { skipped: "${ref}: " + err };
return { done: 1 };
})()`
}

const EXTRACT_FN = String.raw`(function (q, cap) {
function T(s){ return (s||'').replace(/\s+/g,' ').trim(); }
var el;
if (q) {
  if (/^#e\d+$/.test(q)) el = document.querySelector('[data-vibe-ref="' + q.slice(1) + '"]');
  else { try { el = document.querySelector(q); } catch(e) { return { err: 'invalid selector: ' + q }; } }
  if (!el) return { err: 'not found: ' + q };
} else { el = document.body; }
var t = T(el ? (el.innerText || el.textContent || '') : '');
return { v: t.slice(0, cap), more: Math.max(0, t.length - cap) };
})`

const FIND_FN = String.raw`(function (needle) {
function T(s){ return (s||'').replace(/\s+/g,' ').trim(); }
var out = [];
var els = document.querySelectorAll('[data-vibe-ref]');
for (var i = 0; i < els.length; i++) {
  var el = els[i];
  var r = el.getBoundingClientRect();
  if (!r.width && !r.height) continue;
  try { var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; } catch(e){}
  var lab = '';
  try { if (el.labels && el.labels.length) lab = el.labels[0].innerText; } catch(e){}
  var blob = [lab, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.value, el.innerText, el.textContent].map(T).join(' ');
  if (blob.toLowerCase().indexOf(needle) >= 0) out.push(el.getAttribute('data-vibe-ref') + ' | ' + blob.slice(0, 100));
  if (out.length >= 25) break;
}
return out;
})`

const HAS_TEXT_FN = String.raw`(function (n) {
var b = document.body ? document.body.innerText : '';
return b.indexOf(n) >= 0;
})`

function buildEvalJs(ref: string | null, code: string): string {
  const head = ref
    ? `var el=document.querySelector('[data-vibe-ref="${ref}"]');if(!el)return{err:'ref ${ref} not found — resnapshot'};`
    : 'var el=null;'
  return (
    '(async function(){' + head +
    'try{var r=await (async function(el){' + code + '})(el);' +
    'var s; if(typeof r==="string")s=r; else { try { s=JSON.stringify(r); } catch(e){ s=String(r); } }' +
    'if(s===undefined)s="undefined"; if(s===null)s="null";' +
    'return { v: s.length>10000 ? s.slice(0,10000)+"...[truncated]" : s };' +
    '}catch(e){ return { err: String((e && e.stack) || e) }; }})()'
  )
}

// ---------- keyboard ----------

const MOD_MAP: Record<string, string> = {
  ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', option: 'alt',
  meta: 'meta', cmd: 'meta', command: 'meta', super: 'meta', win: 'meta', windows: 'meta',
}
const KEY_MAP: Record<string, string> = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab',
  space: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', plus: 'Plus',
  minus: '-', comma: ',', period: '.', slash: '/', semicolon: ';', quote: "'",
  grave: '`', backslash: '\\', bracketleft: '[', bracketright: ']',
}

function parseKeys(keys: string): { keyCode?: string; mods: string[]; err?: string } {
  const parts = String(keys).split('+').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return { mods: [], err: 'empty keys' }
  const mods: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    const m = MOD_MAP[parts[i].toLowerCase()]
    if (!m) return { mods: [], err: `unknown modifier: ${parts[i]}` }
    if (!mods.includes(m)) mods.push(m)
  }
  const k = parts[parts.length - 1]
  const kl = k.toLowerCase()
  if (KEY_MAP[kl]) return { keyCode: KEY_MAP[kl], mods }
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(kl)) return { keyCode: kl.toUpperCase(), mods }
  if (/^[a-z]$/.test(kl)) return { keyCode: kl.toUpperCase(), mods }
  if (/^[0-9]$/.test(kl)) return { keyCode: kl, mods }
  if (k.length === 1) return { keyCode: k, mods }
  if (MOD_MAP[kl]) return { mods, err: `keys must end with a main key (e.g. "Control+a"), got "${keys}"` }
  return { mods, err: `unsupported key: ${k}` }
}

const CDP_MOD: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
const CDP_KEYS: Record<string, { key: string; code: string; vk: number }> = {
  Return: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Insert: { key: 'Insert', code: 'Insert', vk: 45 },
  Up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  Down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  Right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Plus: { key: '+', code: 'Equal', vk: 187 },
  '-': { key: '-', code: 'Minus', vk: 189 },
  ',': { key: ',', code: 'Comma', vk: 188 },
  '.': { key: '.', code: 'Period', vk: 190 },
  '/': { key: '/', code: 'Slash', vk: 191 },
  ';': { key: ';', code: 'Semicolon', vk: 186 },
  "'": { key: "'", code: 'Quote', vk: 222 },
  '`': { key: '`', code: 'Backquote', vk: 192 },
  '\\': { key: '\\', code: 'Backslash', vk: 220 },
  '[': { key: '[', code: 'BracketLeft', vk: 219 },
  ']': { key: ']', code: 'BracketRight', vk: 221 },
}

function cdpKeyEvent(keyCode: string, mods: string[]): any | null {
  let bits = 0
  for (const m of mods) bits |= CDP_MOD[m] || 0
  const shift = !!(bits & 8)
  let key = keyCode
  let code = ''
  let vk = 0
  const spec = CDP_KEYS[keyCode]
  if (spec) {
    key = spec.key
    code = spec.code
    vk = spec.vk
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(keyCode)) {
    code = keyCode
    vk = 111 + Number(keyCode.slice(1))
  } else if (/^[A-Z]$/.test(keyCode)) {
    key = shift ? keyCode : keyCode.toLowerCase()
    code = 'Key' + keyCode
    vk = keyCode.charCodeAt(0)
  } else if (/^[0-9]$/.test(keyCode)) {
    code = 'Digit' + keyCode
    vk = keyCode.charCodeAt(0)
  } else {
    return null
  }
  const out: any = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits }
  if (key.length === 1) out.text = key
  return out
}

// ---------- snapshot / act plumbing ----------

let refBase = 0

async function doSnapshot(c: WebContents, boxes: boolean, max: number): Promise<BrowserToolResult> {
  await settlePageShort(c)
  const frames = framesOf(c)
  if (!frames.length) return textResult('snapshot failed: page did not respond (still loading or crashed?)', true)
  let base = refBase
  let used = 0
  let head = ''
  let mainFailed = false
  const lines: string[] = []
  let truncated = false
  let skipped = 0
  for (const f of frames) {
    const isMain = sameFrame(f, frames[0])
    if (used >= max) {
      skipped++
      continue
    }
    let off = { x: 0, y: 0 }
    if (!isMain) {
      const o = await frameOffsetCss(c, f)
      if (o) off = o
    }
    const r = await safeExec<any>(f, `(${SNAP_FN})(${base},${max - used},${boxes ? 1 : 0},${Math.round(off.x)},${Math.round(off.y)})`)
    if (!r.v || !Array.isArray(r.v.items)) {
      if (isMain) mainFailed = true
      skipped++
      continue
    }
    const from = base
    base = Number(r.v.base) || base
    for (let i = from + 1; i <= base; i++) refFrames.set('e' + i, f)
    used += r.v.items.length
    if (r.v.truncated) truncated = true
    if (isMain) {
      head = `URL: ${r.v.url}\nTITLE: ${r.v.title || '(none)'}\n`
      lines.push(...r.v.items)
    } else if (r.v.items.length) {
      lines.push(`--- frame ${r.v.url || '(blank)'} ---`, ...r.v.items)
    }
  }
  refBase = base
  if (mainFailed && !lines.length) return textResult('snapshot failed: page did not respond (still loading or crashed?)', true)
  const body = lines.length
    ? lines.join('\n')
    : '(no interactive elements found — canvas/image UI or page still loading; try browser_screenshot / browser_extract, or browser_click_xy for canvas content)'
  const tail = truncated ? `\n...truncated at ${max} elements — use browser_find "text" to locate a specific control` : ''
  const skipNote = skipped ? `\n(${skipped} frame(s) skipped: detached, not responding, or over the element cap)` : ''
  return textResult((head || `URL: ${c.getURL()}\nTITLE: (main frame not responding)\n`) + body + tail + skipNote)
}

async function settlePageShort(c: WebContents): Promise<void> {
  const t0 = Date.now()
  while (c.isLoading() && Date.now() - t0 < 5000) await sleep(150)
}

async function afterAct(c: WebContents, quiet: boolean): Promise<BrowserToolResult[]> {
  if (quiet) return []
  await settlePage(c)
  return [await doSnapshot(c, false, 250)]
}

function combine(head: BrowserToolResult, snaps: BrowserToolResult[]): BrowserToolResult {
  return { content: [...head.content, ...snaps.flatMap((s) => s.content)], isError: head.isError }
}

async function clickRef(c: WebContents, ref: string, button: string, count: number): Promise<{ result: BrowserToolResult } | { note: string | null; hit: string | null }> {
  const frame = refFrame(ref)
  const inSub = !!frame && !sameFrame(frame, c.mainFrame)
  let pos: any
  if (inSub) {
    const r = await safeExec<any>(frame!, `(${CLICK_FN})(${JSON.stringify(ref)},${JSON.stringify(button || 'left')},${count})`)
    if (r.err) {
      refFrames.delete(ref)
      return { result: lostResult(ref) }
    }
    pos = r.v
  } else {
    const job = `(${CLICK_FN})(${JSON.stringify(ref)},${JSON.stringify(button || 'left')},${count})`
    pos = frame ? await frame.executeJavaScript(job) : await c.executeJavaScript(job)
  }
  if (pos?.lost) return { result: lostResult(ref) }
  if (pos?.err) return { result: textResult(pos.err, true) }
  if (!pos || !pos.w || !pos.h) {
    return { result: textResult(`element ${ref} has zero size (hidden until hover?) — try browser_eval on it, or click a visible parent`, true) }
  }
  let x = Number(pos.x) || 0
  let y = Number(pos.y) || 0
  if (inSub) {
    const off = await frameOffsetCss(c, frame!)
    if (!off) {
      return { result: textResult(`cannot locate the iframe hosting ${ref} (closed shadow root?) — take browser_screenshot and use browser_click_xy`, true) }
    }
    x += off.x
    y += off.y
  }
  const vp = await viewportCss(c)
  x = Math.max(0, Math.min(vp.w - 1, Math.round(x)))
  y = Math.max(0, Math.min(vp.h - 1, Math.round(y)))
  const note = await mouseClick(c, x, y, button || 'left', count)
  const hit = pos.tag
    ? fmtHit({ tag: pos.tag, cls: pos.cls || '', x: Math.round(pos.x - pos.w / 2), y: Math.round(pos.y - pos.h / 2), w: Math.round(pos.w), h: Math.round(pos.h), t: pos.tx || '' })
    : null
  return { note, hit }
}

// ---------- tool dispatch ----------

export async function handleCall(name: string, args: any): Promise<BrowserToolResult> {
  const c = active()
  if (!c) return noBrowser()
  try {
    switch (name) {
      case 'snapshot': {
        const max = Math.min(Math.max(Number(args.max) || 250, 10), 1000)
        return doSnapshot(c, !!args.boxes, max)
      }
      case 'find': {
        const q = String(args.text ?? '').trim().toLowerCase()
        if (!q) return textResult('text required', true)
        const frames = framesOf(c)
        const mainHits: string[] = []
        const subSections: string[] = []
        let got = false
        for (const f of frames) {
          const out = await safeExec<string[]>(f, `(${FIND_FN})(${JSON.stringify(q)})`)
          if (!Array.isArray(out.v)) continue
          got = true
          if (!out.v.length) continue
          for (const line of out.v) {
            const m = String(line).match(/^(e\d+)/)
            if (m) refFrames.set(m[1], f)
          }
          if (sameFrame(f, frames[0])) mainHits.push(...out.v)
          else subSections.push(`--- frame ${frameUrl(f) || '(blank)'} ---`, ...out.v)
        }
        if (!got) return textResult('find failed: page did not respond', true)
        const all = [...mainHits, ...subSections]
        if (!all.length) return textResult(`no element matches "${args.text}" — take a browser_snapshot to see all refs`)
        return textResult(all.join('\n'))
      }
      case 'click': {
        const ref = okRef(args.ref)
        if (!ref) return textResult('ref (like "e12" from a snapshot) required', true)
        const o = await clickRef(c, ref, args.button || 'left', args.double ? 2 : 1)
        const snaps = await afterAct(c, !!args.quiet)
        if ('result' in o) return combine(o.result, snaps)
        const hitTxt = o.hit ? ` ${o.hit}` : ''
        return combine(textResult(`clicked ${ref}${args.double ? ' (double)' : ''}${args.button && args.button !== 'left' ? ` ${args.button}` : ''}${hitTxt}${o.note ? ` [${o.note}]` : ''}`), snaps)
      }
      case 'click_xy': {
        let x = Number(args.x)
        let y = Number(args.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return textResult('x/y required — top-viewport CSS px (convert browser_screenshot pixels with its VIEWPORT scale line)', true)
        const vp = await viewportCss(c)
        x = Math.max(0, Math.min(vp.w - 1, Math.round(x)))
        y = Math.max(0, Math.min(vp.h - 1, Math.round(y)))
        const hit = await hitTestInfo(c, x, y)
        const note = await mouseClick(c, x, y, String(args.button || 'left'), args.double ? 2 : 1)
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(`clicked (${x}, ${y}) top-viewport CSS px${hit ? ` ${hit}` : ''}${args.double ? ' (double)' : ''}${args.button && args.button !== 'left' ? ` ${args.button}` : ''}${note ? ` [${note}]` : ''}`), snaps)
      }
      case 'fill': {
        const ref = okRef(args.ref)
        if (!ref) return textResult('ref required', true)
        const r = await execOnRef(c, ref, fillJob(ref, String(args.text ?? '')))
        const snaps = await afterAct(c, !!args.quiet)
        if (r?.lost) return combine(lostResult(ref), [])
        if (r?.skipped) return combine(textResult(`could not set ${r.skipped}`, true), snaps)
        return combine(textResult(`filled ${ref}`), snaps)
      }
      case 'fill_form': {
        const fields = Array.isArray(args.fields) ? args.fields.slice(0, 50) : null
        if (!fields || !fields.length) return textResult('fields array [{ref, value}] required', true)
        let filled = 0
        const skipped: string[] = []
        for (const f of fields) {
          const ref = okRef(f?.ref)
          if (!ref) { skipped.push(`bad ref ${JSON.stringify(f?.ref)}`); continue }
          const r = await execOnRef(c, ref, fillJob(ref, String(f.value ?? '')))
          if (r?.lost) skipped.push(`${ref} not found`)
          else if (r?.skipped) skipped.push(r.skipped)
          else filled++
        }
        const head = textResult(`filled ${filled}/${fields.length} fields${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`, filled === 0 && skipped.length > 0)
        const snaps = await afterAct(c, !!args.quiet)
        return combine(head, snaps)
      }
      case 'press': {
        const keys = String(args.keys ?? '').trim()
        if (!keys) return textResult('keys required, e.g. "Return", "Tab", "Control+a"', true)
        let focusRef: string | null = null
        let focusFrame: WebFrameMain | null = null
        if (args.ref) {
          const ref = okRef(args.ref)
          if (!ref) return textResult('ref must be a snapshot ref like "e12"', true)
          const f = await execOnRef(c, ref, `(${FOCUS_FN})(${JSON.stringify(ref)})`)
          if (f?.lost) return lostResult(ref)
          focusRef = ref
          focusFrame = refFrame(ref)
        }
        const parsed = parseKeys(keys)
        if (parsed.err || !parsed.keyCode) return textResult(`bad keys "${keys}": ${parsed.err || 'no main key'}`, true)
        const base = cdpKeyEvent(parsed.keyCode, parsed.mods)
        let note: string | null = null
        const act = await activateTypingInput(c, focusRef, focusFrame)
        const r = base
          ? await withCdp(c, async (dbg) => {
              await dbg.sendCommand('Input.dispatchKeyEvent', { ...base, type: 'keyDown' })
              await dbg.sendCommand('Input.dispatchKeyEvent', { ...base, type: 'keyUp', text: undefined })
            })
          : { err: 'no CDP mapping' }
        if (r.err) {
          const ev: any = { type: 'keyDown', keyCode: parsed.keyCode }
          if (parsed.mods.length) ev.modifiers = parsed.mods
          c.sendInputEvent(ev)
          await sleep(30)
          c.sendInputEvent({ ...ev, type: 'keyUp' })
          note = base ? SYNTH_NOTE : 'key sent via synthetic input (no CDP mapping) — may not reach cross-origin iframes'
        } else if (act) {
          note = act
        }
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(`pressed ${keys}${args.ref ? ` on ${args.ref}` : ''}${note ? ` [${note}]` : ''}`), snaps)
      }
      case 'type': {
        const text = String(args.text ?? '')
        if (!text) return textResult('text required', true)
        const chars = Array.from(text).length
        let via = 'Input.insertText'
        const r = await insertTextViaDebugger(c, text)
        if (!r.ok) {
          for (const ch of Array.from(text)) {
            try {
              c.sendInputEvent({ type: 'char', keyCode: ch } as any)
            } catch { /* ignore */ }
            await sleep(12)
          }
          via = `char events — may miss cross-origin frames (insertText: ${r.err || 'unavailable'})`
        }
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(`typed ${chars} char(s) via ${via} into the focused element (if nothing captured it, click the target first)`), snaps)
      }
      case 'scroll': {
        let note: string | null = null
        if (args.ref) {
          const ref = okRef(args.ref)
          if (!ref) return textResult('ref must be a snapshot ref', true)
          const r = await execOnRef(c, ref, String.raw`(function (ref) {
var el = document.querySelector('[data-vibe-ref="' + ref + '"]');
if (!el) return { lost: 1 };
el.scrollIntoView({ block: 'center', inline: 'nearest' });
return { ok: 1 };
})(${JSON.stringify(ref)})`)
          if (r?.lost) return lostResult(ref)
        } else {
          const dx = Number(args.dx) || 0
          const dy = Number(args.dy) || 0
          if (!dx && !dy) return textResult('dx/dy ticks or ref required', true)
          const vs = await viewportCss(c)
          const cx = Math.round(vs.w / 2)
          const cy = Math.round(vs.h / 2)
          const r = await withCdp(c, async (dbg) => {
            await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: dx * 120, deltaY: dy * 120 })
          })
          if (r.err) {
            const z = await zoomOf(c)
            c.sendInputEvent({ type: 'mouseWheel', x: Math.round(cx * z), y: Math.round(cy * z), deltaX: dx * 120, deltaY: dy * 120 } as any)
            note = SYNTH_NOTE
          }
        }
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(`${args.ref ? `scrolled ${args.ref} into view` : `scrolled dx=${args.dx || 0} dy=${args.dy || 0}`}${note ? ` [${note}]` : ''}`), snaps)
      }
      case 'navigate': {
        let url = String(args.url ?? '').trim()
        if (!url) return textResult('url required', true)
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !url.startsWith('//')) url = 'https://' + url
        c.loadURL(url)
        await settlePage(c, 25000)
        return doSnapshot(c, false, 250)
      }
      case 'back':
      case 'forward': {
        if (name === 'back' ? !c.canGoBack() : !c.canGoForward()) {
          return textResult(name === 'back' ? 'no history to go back' : 'no history to go forward', true)
        }
        if (name === 'back') c.goBack(); else c.goForward()
        await settlePage(c, 25000)
        return doSnapshot(c, false, 250)
      }
      case 'reload': {
        c.reload()
        await settlePage(c, 25000)
        return doSnapshot(c, false, 250)
      }
      case 'wait_for': {
        const needle = String(args.text ?? '')
        if (!needle) return textResult('text required', true)
        const gone = !!args.gone
        const timeout = Math.min(Math.max(Number(args.timeout) || 10000, 500), 60000)
        const t0 = Date.now()
        for (;;) {
          const has = await anyFrameHasText(c, needle)
          if (gone ? !has : has) return textResult(`text "${needle.slice(0, 60)}" ${gone ? 'disappeared' : 'found'}`)
          if (Date.now() - t0 > timeout) return textResult(`timeout ${timeout}ms waiting for text "${needle.slice(0, 60)}"${gone ? ' to disappear' : ''}`, true)
          await sleep(400)
        }
      }
      case 'screenshot': {
        const img = await c.capturePage()
        let note = `screenshot of ${c.getURL()}`
        try {
          const z = await zoomOf(c)
          const v = await viewportCss(c)
          const px = img.getSize()
          if (px.width > 0 && v.w > 0) {
            const scale = px.width / v.w
            note += `\nVIEWPORT: ${Math.round(v.w)}x${Math.round(v.h)} CSS px (zoom ${z.toFixed(2)}), image ${px.width}x${px.height} px — for browser_click_xy: cssX = screenshotX / ${scale.toFixed(3)}`
          }
        } catch { /* ignore */ }
        return {
          content: [
            { type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: note },
          ],
          isError: false,
        }
      }
      case 'extract': {
        const cap = Math.min(Math.max(Number(args.max_chars) || 8000, 100), 50000)
        const sel = String(args.selector ?? '').trim()
        let r: any
        if (/^#e\d+$/.test(sel)) {
          r = await execOnRef(c, sel.slice(1), `(${EXTRACT_FN})(${JSON.stringify(sel)},${cap})`)
          if (r?.lost) return lostResult(sel.slice(1))
        } else {
          r = await c.executeJavaScript(`(${EXTRACT_FN})(${JSON.stringify(sel)},${cap})`)
        }
        if (r?.err) return textResult(r.err, true)
        if (!sel && !(String(r.v || '').trim())) {
          const parts: string[] = []
          let more = 0
          for (const f of framesOf(c)) {
            if (sameFrame(f, c.mainFrame)) continue
            const fr = await safeExec<string>(f, `(${EXTRACT_FN})('',${cap})`)
            const t = String(fr.v || '')
            if (!t.trim()) continue
            parts.push(`--- frame ${frameUrl(f) || '(blank)'} ---\n` + t.slice(0, cap))
            more += Math.max(0, t.length - cap)
          }
          if (parts.length) {
            return textResult(parts.join('\n') + (more > 0 ? `\n...[+${more} more chars across frames — raise max_chars or scope with selector]` : ''))
          }
        }
        return textResult(r.v + (r.more > 0 ? `\n...[+${r.more} more chars — raise max_chars or scope with selector]` : ''))
      }
      case 'eval': {
        const code = String(args.code ?? '')
        if (!code.trim()) return textResult('code required', true)
        const ref = args.ref ? okRef(args.ref) : null
        if (args.ref && !ref) return textResult('ref must be a snapshot ref like "e12"', true)
        let target: WebFrameMain | null = ref ? refFrame(ref) : null
        if (!target && args.in_frame) {
          const sub = String(args.in_frame)
          target = framesOf(c).find((x) => frameUrl(x).includes(sub)) || null
          if (!target) {
            const urls = framesOf(c).map(frameUrl).filter(Boolean)
            return textResult(`no frame URL contains "${sub}" — current frames: ${urls.join(', ') || '(none)'}`, true)
          }
        }
        const inSub = !!target && !sameFrame(target, c.mainFrame)
        const js = buildEvalJs(ref, code)
        let r: any
        if (inSub) {
          const rr = await safeExec(target!, js, true)
          if (rr.err) return textResult(`eval error: ${rr.err}`, true)
          r = rr.v
        } else {
          r = await c.executeJavaScript(js, true)
        }
        if (r?.err) return textResult(`eval error: ${r.err}`, true)
        const label = inSub ? `\n(evaluated in frame ${frameUrl(target!)})` : ''
        return textResult(`(async function(el){...}) returned:\n${r?.v ?? 'undefined'}` + label)
      }
      default:
        return textResult(`unknown browser tool: ${name}`, true)
    }
  } catch (e: any) {
    return textResult(`error: ${e?.message || e}`, true)
  }
}

// ---------- per-session MCP pipe server (same shape as computer-use) ----------

interface SessionState {
  sessionId: string
  pipeName: string
  token: string
  server: ReturnType<typeof createServer> | null
  mcpConfigPath: string
  client: import('net').Socket | null
  clientBuf: string
}

const sessions = new Map<string, SessionState>()

function resolveMcpScriptPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'browser-mcp.js')
  return join(app.getAppPath(), 'resources', 'browser-mcp.js')
}

async function handleClientCall(session: SessionState, name: string, args: any): Promise<BrowserToolResult> {
  return handleCall(name.replace(/^browser_/, ''), args || {})
}

async function handleClientMessage(session: SessionState, sock: import('net').Socket, msg: any): Promise<void> {
  if (msg.type !== 'call') return
  if (msg.token !== session.token) {
    sock.write(JSON.stringify({ id: msg.id, type: 'error', message: 'bad token' }) + '\n')
    return
  }
  try {
    const result = await handleClientCall(session, msg.name, msg.arguments)
    sock.write(JSON.stringify({ id: msg.id, type: 'result', content: result.content, isError: result.isError }) + '\n')
  } catch (e: any) {
    sock.write(JSON.stringify({ id: msg.id, type: 'result', content: [{ type: 'text', text: `error: ${e?.message || e}` }], isError: true }) + '\n')
  }
}

export function startForSession(sessionId: string): { pipeName: string; token: string; mcpConfigPath: string } {
  const pipeName = `\\\\.\\pipe\\vibe-bm-${randomBytes(8).toString('hex')}`
  const token = randomBytes(16).toString('hex')
  const scriptPath = resolveMcpScriptPath()
  const mcpConfigPath = join(app.getPath('temp'), `vibe-bm-mcp-${sessionId}.json`)

  const session: SessionState = {
    sessionId,
    pipeName,
    token,
    server: null,
    mcpConfigPath,
    client: null,
    clientBuf: '',
  }

  const server = createServer((sock) => {
    session.client = sock
    sock.on('data', (chunk) => {
      session.clientBuf += chunk.toString('utf-8')
      const lines = session.clientBuf.split('\n')
      session.clientBuf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t) continue
        let msg: any
        try { msg = JSON.parse(t) } catch { continue }
        handleClientMessage(session, sock, msg).catch(() => {})
      }
    })
    sock.on('close', () => { if (session.client === sock) session.client = null })
    sock.on('error', () => { /* ignore */ })
  })
  server.on('error', (e: any) => {
    console.error(`[bm:${sessionId}] pipe listen error:`, e.message)
    try { session.server?.close() } catch { /* ignore */ }
    try { unlinkSync(session.mcpConfigPath) } catch { /* ignore */ }
    sessions.delete(sessionId)
  })
  session.server = server
  server.listen(pipeName)

  const config = {
    mcpServers: {
      'vibe-browser': {
        command: process.execPath,
        args: [scriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          VIBE_BM_PIPE: pipeName,
          VIBE_BM_TOKEN: token,
        },
      },
    },
  }
  writeFileSync(mcpConfigPath, JSON.stringify(config))

  sessions.set(sessionId, session)
  return { pipeName, token, mcpConfigPath }
}

export function stopForSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  try { session.server?.close() } catch { /* ignore */ }
  try { session.client?.destroy() } catch { /* ignore */ }
  try { unlinkSync(session.mcpConfigPath) } catch { /* ignore */ }
  sessions.delete(sessionId)
}
