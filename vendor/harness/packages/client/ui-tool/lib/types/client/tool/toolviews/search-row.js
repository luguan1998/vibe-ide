import { jsx as _jsx } from "react/jsx-runtime";
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { searchCardModel } from "../models/search-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
const SEARCH_TITLES = {
    grep: 'Grep',
    glob: 'Glob',
};
/**
 * Search row: icon + Grep/Glob · {summary} in the shared ToolRow chrome, with the
 * completed search's card as the row's collapsed-by-default card body (a capped
 * search's recovery footer rides below it, inside ToolRow). Registered under
 * both `grep` and `glob`; the derived model's `kind` decides the card shape. A
 * settled call with no search card surfaces its model-facing text through
 * ToolRow's Output section, since the keyed SearchRow owns this render slot.
 */
export function SearchRow({ toolName, block, inspect, t }) {
    const model = toolRowModel(toolName, block);
    const search = searchCardModel(block);
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconSearchOutline16, { size: 14 }), title: SEARCH_TITLES[toolName] ?? model.title, 
        // The result view's replacement title outranks the args-derived summary,
        // matching the terminal card's description precedence.
        summary: search?.title ?? model.summary, body: null, 
        // A settled call with no search card (errored search, nested run_code
        // sub-dispatch, legacy generic result) has its text nowhere else to go;
        // ToolRow's Output section carries it, and errorSummary its first line.
        // When a card is present ToolRow renders it instead of the output, so
        // model.output passes unconditionally and the four card rows stay
        // symmetric.
        output: model.output, errorSummary: model.errorSummary, search: search, state: model.state, inspect: inspect }));
}
/**
 * The search view follows the atomic Tool-view declaration across activation
 * and reload. One component registers under both keys because `grep` and
 * `glob` are the same visual object discriminated by the result view's `kind`.
 */
export const searchToolview = {
    name: 'search-toolview',
    inject: ['slots'],
    /**
     * Register the search row into the Tool-owned keyed view slot under both
     * the `grep` and `glob` tool names.
     * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
     */
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', function* () {
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow);
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'glob', locale: NS }, SearchRow);
        });
    },
};
//# sourceMappingURL=search-row.js.map