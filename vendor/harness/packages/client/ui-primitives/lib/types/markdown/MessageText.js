import { jsx as _jsx } from "react/jsx-runtime";
// MessageText is the literal-text primitive for user and steering content; assistant output uses MarkdownText.
import css from './MessageText.module.css';
export function MessageText({ text }) {
    return _jsx("div", { className: css.text, children: text });
}
//# sourceMappingURL=MessageText.js.map