import { jsx as _jsx } from "react/jsx-runtime";
import { IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16, IconSearchOutline16, IconSparkle16, } from '@deepseek-ai/dsh-client-ui-primitives';
import { readCardModel } from "../models/read-card-model.js";
import { diffCardModel } from "../models/diff-card-model.js";
import { searchCardModel } from "../models/search-card-model.js";
import { terminalCardModel, terminalFailed } from "../models/terminal-card-model.js";
import { webCardModel } from "../models/web-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
const VARIANT_ICONS = {
    search: _jsx(IconSearchOutline16, { size: 14 }),
    read: _jsx(IconBrowseOutline16, { size: 14 }),
    bash: _jsx(IconApiOutline14, { size: 14 }),
    write: _jsx(IconEditOutline16, { size: 14 }),
    edit: _jsx(IconEditOutline16, { size: 14 }),
    code: _jsx(IconCodeOutline16, { size: 14 }),
    others: _jsx(IconSparkle16, { size: 14 }),
};
export function GenericToolCard({ toolName, block, cwd, openFile, inspect, t }) {
    const model = toolRowModel(toolName, block, cwd);
    const terminal = terminalCardModel(block, cwd);
    const read = readCardModel(block, cwd);
    const diff = diffCardModel(block);
    const search = searchCardModel(block);
    const web = webCardModel(block);
    // A failing exit status is the terminal card's own error signal (the call
    // itself settles isError:false), surfaced as the row's red state dot.
    const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
        ? 'error'
        : model.state;
    const singleFile = model.filePath !== undefined;
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: VARIANT_ICONS[model.variant], title: model.title, 
        // A terminal presenter's description is the contract's above-card text, so
        // it outranks the args-derived summary here exactly as it does in BashRow;
        // a search result view's replacement title outranks it the same way.
        summary: terminal?.description ?? search?.title ?? model.summary, 
        // Single-file tools never expose an args body — the path link is the only
        // args interaction. A card is not an args body: a read/write/edit row is
        // single-file AND carries a card, so the card expands under the path link.
        body: singleFile ? null : model.body, output: model.output, errorSummary: model.errorSummary, terminal: terminal, diff: diff, read: read, search: search, web: web, state: state, filePath: model.filePath, onOpenFile: singleFile ? openFile : undefined, inspect: inspect }));
}
//# sourceMappingURL=GenericToolCard.js.map