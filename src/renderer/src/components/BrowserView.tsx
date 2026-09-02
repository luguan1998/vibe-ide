import React, { useRef, useState, useEffect, useCallback, useImperativeHandle } from 'react'
import { RotateCw, ArrowLeft, ArrowRight, Feather, PanelRight, PanelLeft, ZoomIn, ZoomOut } from 'lucide-react'
import { useI18n } from '../i18n'
import { InlineAnnotationInput } from './AiTab'
import { toFileUrl, resolveAbsPath } from '../utils/filePathUtils'

interface BrowserViewProps {
  onBack: () => void
  onAnnotate: (line: string) => void
  docked?: boolean
  onToggleDock?: () => void
  workspacePath?: string | null
}

export interface BrowserViewHandle {
  loadURL: (url: string) => void
}

interface PickData {
  selector: string
  text: string
  x: number
  y: number
}

const PICK_PREFIX = '__vibePick:'
const CTX_CLOSE_SIG = '__vibeCtxClose'

// 菜单打开时注入一次性 mousedown，把 webview 内的左键点点击传回宿主用于关闭菜单
function injectCtxCloseScript(): string {
  return `(function(){
    function f(){console.log('${CTX_CLOSE_SIG}');document.removeEventListener('mousedown',f,true);}
    document.addEventListener('mousedown',f,true);
  })()`
}

// webview 搬家（中栏 ↔ 右栏覆盖）必然重挂载，用模块级变量保住当前网址与缩放
let lastBrowserUrl = 'about:blank'
let lastBrowserZoom = 1

// 停靠偏好为右侧时，浏览器尚未挂载就要先定好起始网址（挂载时作为初始 url/address）
export function setBrowserStartUrl(u: string) {
  if (u) lastBrowserUrl = u
}

// 地址栏输入的路径判定：盘符/绝对/相对前缀，或以 .html 结尾且首段不像域名（src/a.html 本地、example.com/a.html 域名）
function looksLikePath(u: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(u) || u.startsWith('/') || /^\.\.?[\\/]/.test(u)) return true
  if (/\s/.test(u) || !/\.(html?|xhtml)$/i.test(u)) return false
  if (!/[\\/]/.test(u)) return true
  return !u.split(/[\\/]/)[0].includes('.')
}

const INJECT_INSTALL = `
(function(){
  if(window.__vibePickMove){document.removeEventListener('mousemove',window.__vibePickMove,true);}
  if(window.__vibePickHandler){document.removeEventListener('click',window.__vibePickHandler,true);}
  if(window.__vibePickScroll){document.removeEventListener('scroll',window.__vibePickScroll,true);}
  if(window.__vibePickLeave){document.removeEventListener('mouseleave',window.__vibePickLeave,true);}
  var oldOv=document.getElementById('__vibePickOverlay');if(oldOv)oldOv.remove();
  function buildSelector(el){
    if(el.id){try{return '#'+CSS.escape(el.id);}catch(e){}}
    var parts=[];var node=el;
    while(node&&node.nodeType===1&&node!==document.documentElement){
      var part=node.tagName.toLowerCase();
      if(node.className&&typeof node.className==='string'){
        var cls=node.className.trim().split(' ').filter(function(c){return c.length;}).slice(0,2).join('.');
        if(cls)part+='.'+cls;
      }
      var parent=node.parentNode;
      if(parent){
        var sibs=Array.prototype.filter.call(parent.children,function(c){return c.tagName===node.tagName;});
        if(sibs.length>1)part+=':nth-of-type('+(sibs.indexOf(node)+1)+')';
      }
      parts.unshift(part);node=parent;
    }
    return parts.length?parts.join(' > '):el.tagName.toLowerCase();
  }
  var overlay=document.createElement('div');
  overlay.id='__vibePickOverlay';
  overlay.style.cssText='position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;border:1.5px solid #419bf9;background:rgba(75,155,249,0.15);display:none;';
  var label=document.createElement('div');
  label.style.cssText='position:absolute;left:-1.5px;top:100%;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#419bf9;color:#fff;font:600 11px/1.6 ui-monospace,Consolas,Menlo,monospace;padding:1px 6px;border-radius:0 0 3px 3px;';
  overlay.appendChild(label);
  var currentEl=null;
  function positionOverlay(el){
    var r=el.getBoundingClientRect();
    if(r.width===0&&r.height===0){overlay.style.display='none';return;}
    overlay.style.display='block';
    overlay.style.left=r.left+'px';
    overlay.style.top=r.top+'px';
    overlay.style.width=r.width+'px';
    overlay.style.height=r.height+'px';
    var desc=el.tagName.toLowerCase();
    if(el.id)desc+='#'+el.id;
    else if(el.className&&typeof el.className==='string'){var c=el.className.trim().split(' ').filter(function(x){return x.length;}).slice(0,2);if(c.length)desc+='.'+c.join('.');}
    label.textContent=desc+'  ·  '+Math.round(r.width)+'×'+Math.round(r.height);
  }
  window.__vibePickMove=function(e){
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===overlay||el===label)return;
    if(el===currentEl)return;
    currentEl=el;
    positionOverlay(el);
  };
  window.__vibePickHandler=function(e){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el)return;
    var sel=buildSelector(el);
    var text=(el.innerText||el.textContent||'').trim().slice(0,40);
    console.log('${PICK_PREFIX}'+JSON.stringify({selector:sel,text:text,x:e.clientX,y:e.clientY}));
  };
  window.__vibePickScroll=function(){if(currentEl)positionOverlay(currentEl);};
  window.__vibePickLeave=function(){overlay.style.display='none';currentEl=null;};
  (document.body||document.documentElement).appendChild(overlay);
  document.body.style.cursor='url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2228%22%20height=%2228%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22black%22%20stroke-width=%222%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M20.24%2012.24a6%206%200%200%200-8.49-8.49L5%2010.5V19h8.5z%22/%3E%3Cline%20x1=%2216%22%20y1=%228%22%20x2=%222%22%20y2=%2222%22/%3E%3Cline%20x1=%2217.5%22%20y1=%2215%22%20x2=%229%22%20y2=%2215%22/%3E%3C/svg%3E")%202%2022, crosshair';
  document.addEventListener('mousemove',window.__vibePickMove,true);
  document.addEventListener('click',window.__vibePickHandler,true);
  document.addEventListener('scroll',window.__vibePickScroll,true);
  document.addEventListener('mouseleave',window.__vibePickLeave,true);
})();
`

const INJECT_REMOVE = `
(function(){
  if(window.__vibePickMove){document.removeEventListener('mousemove',window.__vibePickMove,true);delete window.__vibePickMove;}
  if(window.__vibePickHandler){document.removeEventListener('click',window.__vibePickHandler,true);delete window.__vibePickHandler;}
  if(window.__vibePickScroll){document.removeEventListener('scroll',window.__vibePickScroll,true);delete window.__vibePickScroll;}
  if(window.__vibePickLeave){document.removeEventListener('mouseleave',window.__vibePickLeave,true);delete window.__vibePickLeave;}
  var ov=document.getElementById('__vibePickOverlay');
  if(ov)ov.parentNode.removeChild(ov);
  document.body.style.cursor='';
})();
`

const BrowserView = React.forwardRef<BrowserViewHandle, BrowserViewProps>(function BrowserView({ onBack, onAnnotate, docked, onToggleDock, workspacePath }: BrowserViewProps, ref) {
  const { t } = useI18n()
  const webviewRef = useRef<any>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const annotationRef = useRef<PickData | null>(null)
  const [url, setUrl] = useState(() => lastBrowserUrl)
  const [address, setAddress] = useState(() => (lastBrowserUrl && lastBrowserUrl !== 'about:blank' ? lastBrowserUrl : ''))
  const [annotation, setAnnotation] = useState<PickData | null>(null)
  annotationRef.current = annotation
  const [pickMode, setPickMode] = useState(false)
  const pick = pickMode
  const pickRef = useRef(false)
  pickRef.current = pick
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(() => lastBrowserZoom)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    loadURL: (u: string) => {
      const wv = webviewRef.current
      if (!wv) return
      try { wv.loadURL(u).catch((err: any) => { if (!String(err?.message ?? err ?? '').includes('ERR_ABORTED')) console.warn('loadURL failed:', err) }); setUrl(u); setAddress(u); lastBrowserUrl = u } catch {}
    }
  }), [])

  useEffect(() => {
    if (docked) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (!wrapperRef.current || !wrapperRef.current.offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (ctxMenuRef.current) { setCtxMenu(null); return }
      if (annotationRef.current) { setAnnotation(null); return }
      if (pickMode) { setPickMode(false); return }
      onBack()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onBack, pickMode, docked])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    if (pick) {
      const install = () => { try { wv.executeJavaScript(INJECT_INSTALL) } catch {} }
      if (wv.isLoading && wv.isLoading() === false) install()
      else wv.addEventListener('dom-ready', install, { once: true } as any)
    } else {
      try { wv.executeJavaScript(INJECT_REMOVE) } catch {}
    }
  }, [pick])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onConsole = (e: any) => {
      const msg = e.message ?? e.detail?.message
      if (typeof msg !== 'string') return
      if (msg === CTX_CLOSE_SIG) { setCtxMenu(null); return }
      if (msg.startsWith(PICK_PREFIX)) {
        try {
          const d = JSON.parse(msg.slice(PICK_PREFIX.length))
          setAnnotation({ selector: d.selector, text: d.text, x: d.x, y: d.y })
        } catch {}
      }
    }
    const onNav = (e: any) => {
      setAddress(e.url ?? '')
      if (typeof e.url === 'string' && e.url && e.url !== 'about:blank') lastBrowserUrl = e.url
      if (pickRef.current) { try { wv.executeJavaScript(INJECT_INSTALL) } catch {} }
    }
    const onWillNav = (e: any) => {
      if (pickRef.current) { e.preventDefault() }
    }
    const onStart = () => setLoading(true)
    const onStop = () => setLoading(false)
    // webview 内部点击宿主 DOM 感知不到，只能靠 webview 的 context-menu 事件
    const onCtxMenu = (e: any) => {
      const p = e?.params ?? {}
      if (pickRef.current) return
      if (p.menuSourceType && p.menuSourceType !== 'mouse') return
      setCtxMenu({ x: (p.x ?? 0) - window.screenX, y: (p.y ?? 0) - window.screenY })
      try { wv.executeJavaScript(injectCtxCloseScript()) } catch {}
    }
    const onDomReady = () => { try { wv.setZoomFactor(lastBrowserZoom) } catch {} }
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('will-navigate', onWillNav)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('context-menu', onCtxMenu)
    wv.addEventListener('dom-ready', onDomReady)
    return () => {
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('will-navigate', onWillNav)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('context-menu', onCtxMenu)
      wv.removeEventListener('dom-ready', onDomReady)
    }
  }, [])

  const applyZoom = useCallback((next: number) => {
    const v = Math.round(Math.min(2, Math.max(0.5, next)) * 10) / 10
    setZoom(v)
    lastBrowserZoom = v
  }, [])

  // zoom state 变化立即下发；初次挂载/每次导航由 dom-ready 兜底
  useEffect(() => {
    try { webviewRef.current?.setZoomFactor(zoom) } catch {}
  }, [zoom])

  // contextMenu：mousedown 外部关闭（webview 内点击感知不到，由下次右键/ESC/工具栏点击关闭）
  useEffect(() => {
    if (!ctxMenu) return
    const handle = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [ctxMenu])

  const handleAnnotateSubmit = useCallback((text: string) => {
    const a = annotationRef.current
    setAnnotation(null)
    if (!text.trim()) return
    const sel = a?.selector ?? ''
    const ref = sel.includes(' ') ? '"' + sel + '"' : sel
    onAnnotate((ref ? ref + ' → ' : '') + text.trim())
  }, [onAnnotate])

  const commitAddress = useCallback(() => {
    const u = address.trim()
    if (!u) return
    let final: string
    if (u.includes('://') || u === 'about:blank') {
      final = u
    } else if (looksLikePath(u) && (/^[A-Za-z]:[\\/]/.test(u) || u.startsWith('/') || workspacePath)) {
      const abs = /^[A-Za-z]:[\\/]/.test(u) || u.startsWith('/') ? u : resolveAbsPath(u, workspacePath || undefined)
      final = toFileUrl(abs)
    } else {
      final = 'https://' + u
    }
    setUrl(final)
    setAddress(final)
    lastBrowserUrl = final
  }, [address, workspacePath])

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ cursor: pick ? 'crosshair' : 'default' }}>
      <div className="h-8 px-3 flex items-center gap-1.5 bg-ide-sidebar border-b border-ide-border shrink-0">
        <button onClick={onBack} className="w-6 h-6 mr-1 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors shrink-0" title="Esc">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5"><polyline points="15 4 7 12 15 20" /></svg>
        </button>
        <button onClick={() => setPickMode(v => !v)} className={`w-6 h-6 mr-1 rounded flex items-center justify-center transition-colors shrink-0 ${pick ? 'bg-ide-accent text-white' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`} title={t('Web Brush (Annotate)')}>
          <Feather className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => webviewRef.current?.goBack()} className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0" title={t('Back')}>
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => webviewRef.current?.goForward()} className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0" title={t('Forward')}>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => webviewRef.current?.reload()} className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0" title={t('Refresh')}>
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 min-w-0 relative">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitAddress() }}
            placeholder={t('Enter URL or search')}
            className="w-full h-6 px-2 pr-7 text-xs bg-ide-bg border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent"
          />
          {loading && <div className="absolute right-2 top-1.5 w-3 h-3 border-2 border-ide-accent/30 border-t-ide-accent rounded-full animate-spin pointer-events-none" />}
        </div>
        {onToggleDock && (
          <button onClick={onToggleDock} className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0" title={docked ? t('Move to Center') : t('Move to Right')}>
            {docked ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelRight className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <div ref={wrapperRef} className="flex-1 relative overflow-hidden bg-white">
        {React.createElement('webview', { ref: webviewRef, src: url, className: 'w-full h-full border-0', allowpopups: 'true' })}
        {annotation && (
          <InlineAnnotationInput top={annotation.y} left={annotation.x} containerRef={wrapperRef} onSubmit={handleAnnotateSubmit} onDismiss={() => setAnnotation(null)} />
        )}
        {ctxMenu && (
          <div
            ref={ctxMenuRef}
            style={{ position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 200), top: Math.min(ctxMenu.y, window.innerHeight - 200), zIndex: 100 }}
            className="bg-ide-sidebar border border-ide-border rounded-md shadow-2xl py-1 min-w-[170px]"
          >
            <button
              disabled={!webviewRef.current?.canGoBack()}
              onClick={() => { webviewRef.current?.goBack(); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('Back')}
            </button>
            <button
              disabled={!webviewRef.current?.canGoForward()}
              onClick={() => { webviewRef.current?.goForward(); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {t('Forward')}
            </button>
            <button
              onClick={() => { webviewRef.current?.reload(); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {t('Refresh')}
            </button>
            <div className="border-t border-ide-border my-1" />
            <button
              disabled={zoom <= 0.5}
              onClick={() => applyZoom(zoom - 0.1)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ZoomOut className="w-3.5 h-3.5" />
              {t('Zoom Out')}
            </button>
            <button
              disabled={zoom >= 2}
              onClick={() => applyZoom(zoom + 0.1)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              {t('Zoom In')}
            </button>
            <button
              disabled={zoom === 1}
              onClick={() => applyZoom(1)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {t('Reset Zoom')}
              <span className="ml-auto text-ide-text-muted">{Math.round(zoom * 100)}%</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

export default BrowserView
