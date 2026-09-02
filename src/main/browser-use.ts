import { app } from 'electron'
import type { WebContents } from 'electron'
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

// ---------- page-side scripts (run in guest main frame) ----------

const SNAP_FN = String.raw`(function (base, max, boxes) {
var NATIVE = { INPUT: 1, SELECT: 1, TEXTAREA: 1 };
var STRONG = { A: 1, BUTTON: 1, SUMMARY: 1 };
var STRUC = { FORM:1, MAIN:1, SECTION:1, NAV:1, ASIDE:1, HEADER:1, FOOTER:1, ARTICLE:1, BODY:1, HTML:1, UL:1, OL:1, TABLE:1, THEAD:1, TBODY:1, TR:1, FIELDSET:1 };
var WROLES = { button:1, link:1, textbox:1, searchbox:1, checkbox:1, radio:1, combobox:1, listbox:1, menuitem:1, menuitemcheckbox:1, menuitemradio:1, option:1, slider:1, spinbutton:1, switch:1, tab:1, treeitem:1 };
var items = []; var truncated = 0;
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
  if (nm && nm !== txtv) p.push('name=' + JSON.stringify(nm));
  if (el.disabled || attr(el,'aria-disabled') === 'true') p.push('disabled');
  if (el.required) p.push('required');
  if (tag === 'A' && el.href) p.push('href=' + clip(el.href, 80));
  if (boxes) { var r = el.getBoundingClientRect(); p.push('box=' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
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
return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
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

// ---------- snapshot / act plumbing ----------

let refBase = 0

async function doSnapshot(c: WebContents, boxes: boolean, max: number): Promise<BrowserToolResult> {
  await settlePageShort(c)
  const r = await c.executeJavaScript(`(${SNAP_FN})(${refBase},${max},${boxes ? 1 : 0})`)
  if (!r || !Array.isArray(r.items)) return textResult('snapshot failed: page did not respond (still loading or crashed?)', true)
  refBase = r.base
  const head = `URL: ${r.url}\nTITLE: ${r.title || '(none)'}\n`
  const body = r.items.length
    ? r.items.join('\n')
    : '(no interactive elements found — canvas/image UI or page still loading; try browser_screenshot / browser_extract)'
  const tail = r.truncated
    ? `\n...truncated at ${max} elements — use browser_find "text" to locate a specific control`
    : ''
  return textResult(head + body + tail)
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

async function clickRef(c: WebContents, ref: string, button: string, count: number): Promise<BrowserToolResult | null> {
  const pos = await c.executeJavaScript(`(${CLICK_FN})(${JSON.stringify(ref)},${JSON.stringify(button || 'left')},${count})`)
  if (pos?.lost) return lostResult(ref)
  if (pos?.err) return textResult(pos.err, true)
  if (!pos || !pos.w || !pos.h) {
    return textResult(`element ${ref} has zero size (hidden until hover?) — try browser_eval on it, or click a visible parent`, true)
  }
  const x = Math.max(0, Math.min(pos.vw - 1, Math.round(pos.x)))
  const y = Math.max(0, Math.min(pos.vh - 1, Math.round(pos.y)))
  const btn = button === 'right' ? 'right' : 'left'
  c.sendInputEvent({ type: 'mouseMove', x, y } as any)
  await sleep(30)
  if (count >= 2) {
    c.sendInputEvent({ type: 'mouseDown', x, y, button: btn, clickCount: 1 } as any)
    c.sendInputEvent({ type: 'mouseUp', x, y, button: btn, clickCount: 1 } as any)
    await sleep(60)
    c.sendInputEvent({ type: 'mouseDown', x, y, button: btn, clickCount: 2 } as any)
    c.sendInputEvent({ type: 'mouseUp', x, y, button: btn, clickCount: 2 } as any)
  } else {
    c.sendInputEvent({ type: 'mouseDown', x, y, button: btn, clickCount: 1 } as any)
    await sleep(40)
    c.sendInputEvent({ type: 'mouseUp', x, y, button: btn, clickCount: 1 } as any)
  }
  return null
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
        const out = await c.executeJavaScript(`(${FIND_FN})(${JSON.stringify(q)})`)
        if (!Array.isArray(out)) return textResult('find failed: page did not respond', true)
        if (!out.length) return textResult(`no element matches "${args.text}" — take a browser_snapshot to see all refs`)
        return textResult(out.join('\n'))
      }
      case 'click': {
        const ref = okRef(args.ref)
        if (!ref) return textResult('ref (like "e12" from a snapshot) required', true)
        const err = await clickRef(c, ref, args.button || 'left', args.double ? 2 : 1)
        if (err) {
          const snaps = await afterAct(c, !!args.quiet)
          return combine(err, snaps)
        }
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(`clicked ${ref}${args.double ? ' (double)' : ''}${args.button && args.button !== 'left' ? ` ${args.button}` : ''}`), snaps)
      }
      case 'fill': {
        const ref = okRef(args.ref)
        if (!ref) return textResult('ref required', true)
        const r = await c.executeJavaScript(fillJob(ref, String(args.text ?? '')))
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
          const r = await c.executeJavaScript(fillJob(ref, String(f.value ?? '')))
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
        if (args.ref) {
          const ref = okRef(args.ref)
          if (!ref) return textResult('ref must be a snapshot ref like "e12"', true)
          const f = await c.executeJavaScript(`(${FOCUS_FN})(${JSON.stringify(ref)})`)
          if (f?.lost) return lostResult(ref)
        }
        const parsed = parseKeys(keys)
        if (parsed.err || !parsed.keyCode) return textResult(`bad keys "${keys}": ${parsed.err || 'no main key'}`, true)
        const ev: any = { type: 'keyDown', keyCode: parsed.keyCode }
        if (parsed.mods.length) ev.modifiers = parsed.mods
        c.sendInputEvent(ev)
        await sleep(30)
        c.sendInputEvent({ ...ev, type: 'keyUp' })
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(`pressed ${keys}${args.ref ? ` on ${args.ref}` : ''}`), snaps)
      }
      case 'scroll': {
        if (args.ref) {
          const ref = okRef(args.ref)
          if (!ref) return textResult('ref must be a snapshot ref', true)
          const r = await c.executeJavaScript(String.raw`(function (ref) {
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
          const vs = await c.executeJavaScript('({ w: innerWidth, h: innerHeight })')
          c.sendInputEvent({ type: 'mouseWheel', x: Math.round(vs.w / 2), y: Math.round(vs.h / 2), deltaX: dx * 120, deltaY: dy * 120 } as any)
        }
        const snaps = await afterAct(c, !!args.quiet)
        return combine(textResult(args.ref ? `scrolled ${args.ref} into view` : `scrolled dx=${args.dx || 0} dy=${args.dy || 0}`), snaps)
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
          const has = await c.executeJavaScript(`(${HAS_TEXT_FN})(${JSON.stringify(needle)})`)
          if (gone ? !has : has) return textResult(`text "${needle.slice(0, 60)}" ${gone ? 'disappeared' : 'found'}`)
          if (Date.now() - t0 > timeout) return textResult(`timeout ${timeout}ms waiting for text "${needle.slice(0, 60)}"${gone ? ' to disappear' : ''}`, true)
          await sleep(400)
        }
      }
      case 'screenshot': {
        const img = await c.capturePage()
        return {
          content: [
            { type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `screenshot of ${c.getURL()}` },
          ],
          isError: false,
        }
      }
      case 'extract': {
        const cap = Math.min(Math.max(Number(args.max_chars) || 8000, 100), 50000)
        const r = await c.executeJavaScript(`(${EXTRACT_FN})(${JSON.stringify(String(args.selector ?? '').trim())},${cap})`)
        if (r?.err) return textResult(r.err, true)
        return textResult(r.v + (r.more > 0 ? `\n...[+${r.more} more chars — raise max_chars or scope with selector]` : ''))
      }
      case 'eval': {
        const code = String(args.code ?? '')
        if (!code.trim()) return textResult('code required', true)
        const ref = args.ref ? okRef(args.ref) : null
        if (args.ref && !ref) return textResult('ref must be a snapshot ref like "e12"', true)
        const r = await c.executeJavaScript(buildEvalJs(ref, code), true)
        if (r?.err) return textResult(`eval error: ${r.err}`, true)
        return textResult(`(async function(el){...}) returned:\n${r?.v ?? 'undefined'}`)
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
