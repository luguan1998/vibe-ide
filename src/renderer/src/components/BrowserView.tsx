import React, { useRef, useState, useEffect, useCallback, useImperativeHandle } from 'react'
import { RotateCw, X, ArrowLeft, ArrowRight, Feather } from 'lucide-react'
import { useI18n } from '../i18n'
import { InlineAnnotationInput } from './AiTab'

interface BrowserViewProps {
  onBack: () => void
  onAnnotate: (line: string) => void
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

const INJECT_INSTALL = `
(function(){
  if(window.__vibePickInstalled)return;
  window.__vibePickInstalled=true;
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
  window.__vibePickHandler=function(e){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el)return;
    var sel=buildSelector(el);
    var text=(el.innerText||el.textContent||'').trim().slice(0,40);
    console.log('${PICK_PREFIX}'+JSON.stringify({selector:sel,text:text,x:e.clientX,y:e.clientY}));
  };
  document.body.style.cursor='url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2228%22%20height=%2228%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22black%22%20stroke-width=%222%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M20.24%2012.24a6%206%200%200%200-8.49-8.49L5%2010.5V19h8.5z%22/%3E%3Cline%20x1=%2216%22%20y1=%228%22%20x2=%222%22%20y2=%2222%22/%3E%3Cline%20x1=%2217.5%22%20y1=%2215%22%20x2=%229%22%20y2=%2215%22/%3E%3C/svg%3E")%202%2022, crosshair';
  document.addEventListener('click',window.__vibePickHandler,true);
})();
`

const INJECT_REMOVE = `
(function(){
  if(window.__vibePickHandler){
    document.removeEventListener('click',window.__vibePickHandler,true);
    delete window.__vibePickHandler;
  }
  document.body.style.cursor='';
})();
`

const BrowserView = React.forwardRef<BrowserViewHandle, BrowserViewProps>(function BrowserView({ onBack, onAnnotate }: BrowserViewProps, ref) {
  const { t } = useI18n()
  const webviewRef = useRef<any>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const annotationRef = useRef<PickData | null>(null)
  const [url, setUrl] = useState('about:blank')
  const [address, setAddress] = useState('')
  const [annotation, setAnnotation] = useState<PickData | null>(null)
  annotationRef.current = annotation
  const [pickMode, setPickMode] = useState(false)
  const pick = pickMode
  const pickRef = useRef(false)
  pickRef.current = pick

  useImperativeHandle(ref, () => ({
    loadURL: (u: string) => {
      const wv = webviewRef.current
      if (!wv) return
      try { wv.loadURL(u); setUrl(u); setAddress(u) } catch {}
    }
  }), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (!wrapperRef.current || !wrapperRef.current.offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (annotationRef.current) { setAnnotation(null); return }
      if (pickMode) { setPickMode(false); return }
      onBack()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onBack, pickMode])

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
      if (typeof msg !== 'string' || !msg.startsWith(PICK_PREFIX)) return
      try {
        const d = JSON.parse(msg.slice(PICK_PREFIX.length))
        setAnnotation({ selector: d.selector, text: d.text, x: d.x, y: d.y })
      } catch {}
    }
    const onNav = (e: any) => {
      setAddress(e.url ?? '')
      if (pickRef.current) { try { wv.executeJavaScript(INJECT_INSTALL) } catch {} }
    }
    const onWillNav = (e: any) => {
      if (pickRef.current) { e.preventDefault() }
    }
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('will-navigate', onWillNav)
    return () => {
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('will-navigate', onWillNav)
    }
  }, [])

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
    const final = u.includes('://') || u === 'about:blank' ? u : 'https://' + u
    setUrl(final)
    setAddress(final)
  }, [address])

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ cursor: pick ? 'crosshair' : 'default' }}>
      <div className="h-10 px-3 flex items-center gap-1.5 bg-ide-sidebar border-b border-ide-border shrink-0">
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
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitAddress() }}
          placeholder={t('Enter URL or search')}
          className="flex-1 min-w-0 h-6 px-2 text-xs bg-ide-bg border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent"
        />
        <button onClick={onBack} className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0" title={t('Close')}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={wrapperRef} className="flex-1 relative overflow-hidden bg-white">
        {React.createElement('webview', { ref: webviewRef, src: url, className: 'w-full h-full border-0' })}
        {annotation && (
          <InlineAnnotationInput top={annotation.y} left={annotation.x} containerRef={wrapperRef} onSubmit={handleAnnotateSubmit} onDismiss={() => setAnnotation(null)} />
        )}
      </div>
    </div>
  )
})

export default BrowserView
