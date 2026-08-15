import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// JsonBlock: collapsible JSON block (conversation side; independent from the RPC panel's PayloadJson to avoid cross-panel coupling).
import { useMemo, useState } from 'react';
import css from './JsonBlock.module.css';
const MAX_CHARS = 20_000;
/** Default truncation footer; the owner passes a localized formatter. */
function defaultTruncatedLabel(total) {
    return `… 已截断，共 ${total} 字符`;
}
export function JsonBlock({ label, payload, defaultOpen = false, truncatedLabel = defaultTruncatedLabel }) {
    const [open, setOpen] = useState(defaultOpen);
    const body = useMemo(() => {
        if (!open)
            return '';
        let s;
        try {
            // lib typing hides stringify's undefined arm (undefined/function/symbol payloads).
            // oxlint-disable-next-line typescript/no-unnecessary-condition
            s = JSON.stringify(payload, null, 2) ?? String(payload);
        }
        catch {
            s = String(payload);
        }
        return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n${truncatedLabel(s.length)}` : s;
    }, [open, payload, truncatedLabel]);
    return (_jsxs("div", { className: css.root, children: [_jsxs("button", { type: "button", className: css.toggle, onClick: () => { setOpen(v => !v); }, children: [open ? '▾' : '▸', " ", label] }), open && _jsx("pre", { className: css.body, children: body })] }));
}
//# sourceMappingURL=JsonBlock.js.map