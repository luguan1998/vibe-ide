import { jsx as _jsx } from "react/jsx-runtime";
import { IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { diffCardModel } from "../models/diff-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
/**
 * File-mutation row: icon + {Edit,Write} · {path} in the shared ToolRow chrome,
 * with the applied diff as the row's collapsed-by-default card body. The
 * summary is a path link (a file tool's interaction); the host's `openFile`
 * resolves it against the session cwd, so this passes the tool's own path
 * verbatim. An errored mutation has no diff card, so ToolRow surfaces the
 * model-facing error text through its Output section and its first line in the
 * collapsed summary instead.
 */
export function FileMutationRow({ toolName, block, cwd, openFile, inspect, t }) {
    const model = toolRowModel(toolName, block, cwd);
    const diff = diffCardModel(block);
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconEditOutline16, { size: 14 }), title: model.title, summary: model.summary, body: null, output: model.output, errorSummary: model.errorSummary, diff: diff, state: model.state, filePath: model.filePath, onOpenFile: openFile, inspect: inspect }));
}
/**
 * The file-mutation rows as a plain registrant plugin following the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
export const fileMutationToolview = {
    name: 'file-mutation-toolview',
    inject: ['slots'],
    /**
     * Register the file-mutation row into the Tool-owned keyed view slot
     * under both mutation tool names.
     * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
     */
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', function* () {
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, FileMutationRow);
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, FileMutationRow);
        });
    },
};
//# sourceMappingURL=file-mutation-row.js.map