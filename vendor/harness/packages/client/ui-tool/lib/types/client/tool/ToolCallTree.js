import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo } from 'react';
import { GenericToolCard } from "./toolviews/GenericToolCard.js";
import css from './ToolCallTree.module.css';
/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node) {
    return 'kind' in node ? node.call?.name ?? '' : node.name;
}
/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({ renderSlot, callId, toolName, block, openFile, selected, cwd, inspectCall, t, children, }) {
    const owner = useMemo(() => ({
        callId,
        toolName,
        block,
        openFile,
        cwd,
        inspect: () => { inspectCall(callId); },
    }), [callId, toolName, block, openFile, cwd, inspectCall]);
    return (_jsxs("div", { className: css.callRow, "data-chat-anchor-key": `call:${callId}`, "data-chat-call-id": callId, "data-selected": selected || undefined, children: [renderSlot('tool.call.toolview', owner, {
                entryKey: toolName,
                fallback: _jsx(GenericToolCard, { ...owner, t: t }),
            }), children] }));
});
const ToolCallBranch = memo(function ToolCallBranch({ renderSlot, block, selectedCallId, cwd, openFile, inspectCall, t, }) {
    return (_jsx(ToolCall, { renderSlot: renderSlot, callId: block.callId, toolName: callName(block), block: block, openFile: openFile, selected: block.callId === selectedCallId, cwd: cwd, inspectCall: inspectCall, t: t, children: block.subCalls.length > 0 ? (_jsx("div", { className: css.subCalls, "data-subcalls": true, children: block.subCalls.map(child => (_jsx(ToolCallBranch, { renderSlot: renderSlot, block: child, selectedCallId: selectedCallId, cwd: cwd, openFile: openFile, inspectCall: inspectCall, t: t }, child.callId))) })) : null }));
});
/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({ renderSlot, node, selectedCallId, cwd, openFile, inspectCall, t, }) {
    const block = node.data.root;
    return (_jsx(ToolCallBranch, { renderSlot: renderSlot, block: block, selectedCallId: selectedCallId, cwd: cwd, openFile: openFile, inspectCall: inspectCall, t: t }));
}
//# sourceMappingURL=ToolCallTree.js.map