import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// Skill toolview registrant: a domain-owned row over the keyed toolview hole.
// The compact accent row keeps loaded instructions scannable in the transcript;
// the exact durable tool output remains available in a bounded disclosure card.
import { useState } from 'react';
import { IconChevronDownOutline14, IconInspectOutline12, IconSkillOutline16, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './SkillRow.module.css';
/** First physical line for the collapsed error summary and malformed-args fallback. */
function firstLine(text) {
    const newline = text.indexOf('\n');
    return newline === -1 ? text : text.slice(0, newline);
}
/** Skill names are the only call argument the compact row presents. */
function skillName(argsRaw, callId) {
    try {
        const parsed = JSON.parse(argsRaw);
        if (typeof parsed === 'object' && parsed !== null) {
            const name = parsed.name;
            if (typeof name === 'string' && name !== '')
                return firstLine(name);
        }
    }
    catch {
        // Streaming can expose a truncated JSON prefix; its first line is still
        // more useful than replacing the call with an unrelated catalog lookup.
    }
    return argsRaw === '' ? callId : firstLine(argsRaw);
}
/** Flatten durable result blocks under the generic Tool-row text contract.
 *  Keep aligned with ui-tool's models/tool-call-model.ts `resultText`. */
function resultText(block) {
    if (!('kind' in block))
        return null;
    const parts = [];
    for (const item of block.content) {
        parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2));
    }
    if (parts.length === 0 && block.error !== undefined) {
        parts.push(`${block.error.name}: ${block.error.code}`);
    }
    return parts.join('\n') || null;
}
/** Derive display state without consulting the live skill catalog. */
function skillRowModel(block) {
    const settled = 'kind' in block;
    const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? '';
    const state = !settled
        ? 'running'
        : block.error?.code === 'interrupted'
            ? 'stopped'
            : block.isError ? 'error' : 'ok';
    const output = resultText(block);
    return {
        name: skillName(argsRaw, block.callId),
        output,
        errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
        state,
    };
}
/** State substitution for the collapsed leading slot. */
function leadingFor(state) {
    switch (state) {
        case 'error': return _jsx(StateDot, { state: "error" });
        case 'stopped': return _jsx(StateDot, { state: "warning" });
        default: return _jsx(IconSkillOutline16, { size: 14 });
    }
}
/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
function disclosureLeading(state, open, expandable) {
    if (open)
        return _jsx(IconChevronDownOutline14, { className: css.chevron });
    const icon = leadingFor(state);
    if (!expandable)
        return icon;
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: css.iconIdle, children: icon }), _jsx(IconChevronDownOutline14, { className: `${css.chevron} ${css.chevronHover}` })] }));
}
/** Visually hidden state copy for the colour-only lifecycle cues. */
function stateStatus(state, t) {
    switch (state) {
        case 'running': return t('row.running');
        case 'error': return t('row.failed');
        case 'stopped': return t('row.stopped');
        default: return null;
    }
}
/**
 * Render one `skill` tool call as an accent summary and instructions disclosure.
 * @param props - keyed toolview payload plus the skill locale seat.
 * @returns the dedicated skill row.
 */
export function SkillRow({ block, inspect, t }) {
    const model = skillRowModel(block);
    const [expanded, setExpanded] = useState(false);
    const expandable = model.output !== null;
    const open = expanded && expandable;
    const status = stateStatus(model.state, t);
    const summary = model.errorSummary ?? model.name;
    const toggleExpand = () => {
        setExpanded(value => !value);
    };
    const toggleFromKeyboard = (event) => {
        if (!expandable || (event.key !== 'Enter' && event.key !== ' '))
            return;
        event.preventDefault();
        toggleExpand();
    };
    const disclosureProps = expandable ? {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        onClick: toggleExpand,
        onKeyDown: toggleFromKeyboard,
    } : {};
    const leading = disclosureLeading(model.state, open, expandable);
    return (_jsxs("div", { className: css.card, "data-tool": "skill", "data-state": model.state, children: [_jsxs("div", { className: css.row, "data-expandable": expandable || undefined, ...disclosureProps, children: [_jsx("span", { className: css.leading, children: leading }), status !== null ? _jsx("span", { className: css.visuallyHidden, children: status }) : null, _jsx("span", { className: css.title, children: "Skill" }), _jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: model.errorSummary === null ? css.summary : `${css.summary} ${css.errorSummary}`, children: summary })] }), open ? (_jsxs("div", { className: css.bodyWrap, children: [_jsxs("section", { className: css.instructionsCard, "aria-label": t('row.instructions'), children: [_jsx("div", { className: css.instructionsHeader, children: t('row.instructions') }), _jsx("pre", { className: css.instructions, "data-error": model.state === 'error' || undefined, children: model.output })] }), inspect !== undefined ? (_jsxs("button", { type: "button", className: css.inspectButton, onClick: inspect, children: [_jsx(IconInspectOutline12, {}), "Inspect"] })) : null] })) : null] }));
}
//# sourceMappingURL=SkillRow.js.map