import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** Card-aware output body for the selected Tool call in details. */
import { DiffBlock, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives';
import { diffCardModel } from "./models/diff-card-model.js";
import { readCardModel } from "./models/read-card-model.js";
import { searchCardModel } from "./models/search-card-model.js";
import { terminalBlockLabels, terminalCardModel } from "./models/terminal-card-model.js";
import { resultText } from "./models/tool-call-model.js";
import { webCardModel } from "./models/web-card-model.js";
import css from './ToolDetails.module.css';
/**
 * Render the selected Tool call's structured output when its presentation
 * intent is known, otherwise preserve the flattened result text.
 * @param props - selected call slice, workspace root, and locale seat.
 * @returns the details output body.
 */
export function ToolDetails({ block, cwd, t }) {
    const terminal = terminalCardModel(block, cwd);
    if (terminal !== null) {
        return (_jsxs(_Fragment, { children: [terminal.description !== undefined ? (_jsx("div", { className: css.description, children: terminal.description })) : null, _jsx(TerminalBlock, { ...terminal.card, labels: terminalBlockLabels(t), className: css.cardBody })] }));
    }
    const read = readCardModel(block, cwd);
    if (read !== null)
        return _jsx(ReadBlock, { ...read, className: css.read });
    const diff = diffCardModel(block);
    if (diff !== null)
        return _jsx(DiffBlock, { ...diff.card, className: css.cardBody });
    const search = searchCardModel(block);
    if (search !== null) {
        return (_jsxs(_Fragment, { children: [_jsx(SearchBlock, { ...search.card, className: css.cardBody }), search.recovery !== undefined ? _jsx("div", { className: css.recovery, children: search.recovery }) : null] }));
    }
    const web = webCardModel(block);
    if (web !== null) {
        const body = 'kind' in block ? resultText(block) : '';
        return (_jsxs(_Fragment, { children: [_jsx(WebBlock, { ...web, className: css.web }), body !== '' ? _jsx("pre", { className: css.code, children: body }) : null] }));
    }
    if (!('kind' in block))
        return _jsx("div", { className: css.empty, children: t('details.running') });
    return (_jsx("pre", { className: css.code, "data-error": block.isError || undefined, children: resultText(block) }));
}
//# sourceMappingURL=ToolDetails.js.map