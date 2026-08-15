import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// CodeBlock: one code surface for every consumer — markdown fences, the
// run_code program body, and the details panel's raw args/output — with
// shiki highlighting for the registered grammars and an identical-geometry
// plain fallback for everything else. Chrome (language banner + copy) matches
// deepsuite `@deepseek/md` code blocks; token colors stay on `--shiki-*`.
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { writeClipboard } from "../clipboard.js";
import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from "./highlight.js";
import css from './CodeBlock.module.css';
export function CodeBlock({ code, lang, className, copyLabel = '复制', copiedLabel = '复制成功' }) {
    const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code;
    // Re-render when a lazy grammar finishes loading, so a fence that showed plain
    // text while its language's grammar imported picks up highlighting. The
    // snapshot value is opaque; only its change across renders drives the memo.
    const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount);
    const html = useMemo(() => highlightToHtml(trimmed, lang), [trimmed, lang, loaded]);
    const rootRef = useRef(null);
    const [copied, setCopied] = useState(false);
    const onCopy = useCallback(() => {
        if (copied)
            return;
        /* v8 ignore next -- both arms always mount a <pre>; trimmed is the
           typed fallback if the DOM shape ever diverges. */
        const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed;
        void writeClipboard(text).then((ok) => {
            if (!ok)
                return;
            setCopied(true);
            window.setTimeout(() => { setCopied(false); }, 1000);
        });
    }, [copied, trimmed]);
    const body = html === undefined
        ? (_jsx("pre", { className: css.plain, children: _jsx("code", { children: trimmed }) }))
        : (_jsx("div", { dangerouslySetInnerHTML: { __html: html } }));
    return (_jsxs("div", { ref: rootRef, className: clsx(css.block, 'md-code-block', className), children: [_jsx("div", { className: css.bannerWrap, children: _jsxs("div", { className: css.banner, children: [_jsx("div", { className: css.infostring, children: lang ?? '' }), _jsx("div", { className: css.action, children: _jsx("button", { type: "button", className: css.copyButton, onClick: onCopy, children: copied ? copiedLabel : copyLabel }) })] }) }), body] }));
}
//# sourceMappingURL=CodeBlock.js.map