import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Agent-presets settings section: the roster as cards, a copy dialog as the
 * only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text — a shipped preset opens read-only to
 * be READ (it is the known-good composition a copy starts from), and a custom
 * preset is edited in its own files, which is what the location action leads
 * to. Deleting a preset leaves running sessions alone: a composition is
 * mounted once at session creation and nothing re-reads the file.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconBrowseOutline16, IconCopyOutline16, IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16, Modal, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import { draftBlocker } from "./section-store.js";
import { presetDisplayText } from "./locales.js";
import css from './AgentPresetSection.module.css';
function CopyDialog({ state, t, actions }) {
    const draft = state.copy;
    const blocker = draft === null ? undefined : draftBlocker(draft, state.rows);
    const message = draft === null ? null : draft.error ?? (blocker === undefined ? null : t(blocker));
    const source = draft === null ? undefined : state.rows.find(row => row.id === draft.from);
    const sourceTitle = source === undefined ? draft?.fromTitle : presetDisplayText(source, t).name;
    return (_jsx(Modal, { open: draft !== null, onClose: () => { actions.cancelCopy(); }, title: draft === null ? t('copyTitle') : `${t('copyTitle')} · ${t('copyOf')} ${sourceTitle}`, closeLabel: t('close'), description: t('copyIntro'), className: css.dialog, footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: draft?.saving === true, onClick: () => { actions.cancelCopy(); }, children: t('cancel') }), _jsx(Button, { disabled: draft === null || draft.saving || blocker !== undefined, onClick: () => { void actions.confirmCopy(); }, children: draft?.saving === true ? t('creating') : t('create') })] })), children: draft === null
            ? null
            : (_jsxs("div", { className: css.dialogFields, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { className: css.fieldLabel, children: t('presetId') }), _jsx("input", { className: css.input, value: draft.id, autoFocus: true, spellCheck: false, placeholder: t('presetIdPlaceholder'), onChange: (event) => { actions.setCopyId(event.target.value); } })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { className: css.fieldLabel, children: t('displayName') }), _jsx("input", { className: css.input, value: draft.name, spellCheck: false, placeholder: t('displayNamePlaceholder'), onChange: (event) => { actions.setCopyName(event.target.value); } })] }), message === null ? null : _jsx("p", { className: css.error, role: "alert", children: message })] })) }));
}
/**
 * Render one card's description, clamped by CSS and offered in full on hover.
 * The tooltip is attached only while the text is actually cut off, so a short
 * description does not answer a hover with a bubble repeating the card.
 * @param props.text - the description as rendered, already localized.
 * @returns the description element, tooltip-anchored while it overflows.
 */
function CardDescription({ text }) {
    const ref = useRef(null);
    const [truncated, setTruncated] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        /* v8 ignore next -- the ref is attached before layout effects run. */
        if (el === null)
            return;
        const measure = () => { setTruncated(el.scrollHeight > el.clientHeight); };
        measure();
        // Card width follows the settings pane, which resizes with the window.
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => { observer.disconnect(); };
    }, [text]);
    return (_jsx(Tooltip, { label: text, side: "bottom", delayMs: 400, disabled: !truncated, maxWidth: 360, children: _jsx("span", { ref: ref, className: css.cardDesc, title: "", children: text }) }));
}
/**
 * Render the Agent presets section content column.
 * @param props - composed slot props.
 * @returns the section, or null when the deployment composes no presets.
 */
export function AgentPresetSection(props) {
    const { useAgentPresetSection, t, load } = props;
    const state = useAgentPresetSection(snapshot => snapshot);
    const viewedId = state.view?.id;
    const viewedRow = viewedId === undefined ? undefined : state.rows.find(row => row.id === viewedId);
    const viewedTitle = state.view === null
        ? ''
        : viewedRow === undefined ? state.view.title : presetDisplayText(viewedRow, t).name;
    useEffect(() => {
        void load();
    }, [load]);
    // A deployment that composes no presets has nothing to manage: every
    // session shares the host composition and the page would be an empty list.
    if (state.status === 'unavailable')
        return null;
    if (state.status === 'error') {
        /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
        const detail = state.error ?? '';
        return (_jsxs("div", { className: css.section, children: [_jsx("p", { className: css.error, role: "alert", children: `${t('error')} ${detail}` }), _jsx("button", { type: "button", className: css.secondaryButton, onClick: () => { void load(); }, children: t('retry') })] }));
    }
    /* The guided alternative to copying: the self-referential preset can
       read this very composition and author a new one in conversation.
       Offered only where that preset is actually on the roster and a
       session can be landed; without a writable root the draft could
       never be discovered, so the reason rides the disabled button. */
    const creatorButton = props.startCreatorDraft !== undefined && state.rows.some(row => row.id === 'cordis')
        ? (_jsxs("button", { type: "button", className: css.creatorButton, disabled: !state.authorable, title: state.authorable ? undefined : t('duplicateUnavailable'), onClick: () => {
                props.startCreatorDraft?.();
                props.close();
            }, children: [_jsx(IconPlusOutline16, { size: 14 }), t('creatorDraft')] }))
        : null;
    return (_jsxs("div", { className: css.section, children: [_jsx("h2", { className: css.title, children: t('nav') }), _jsx("p", { className: css.intro, children: t('sectionIntro') }), state.error === null ? null : _jsx("p", { className: css.error, role: "alert", children: state.error }), [['system', t('builtInGroup')], ['user', t('customGroup')]].map(([trust, heading]) => {
                const group = state.rows
                    .filter(row => row.trust === trust)
                    .map(row => ({ row, text: presetDisplayText(row, t) }));
                // The custom group is where a preset of one's own will appear, so it
                // stays on screen even while empty: heading plus the creator entry.
                const tail = trust === 'user' ? creatorButton : null;
                if (group.length === 0 && tail === null)
                    return null;
                return (_jsxs("section", { className: css.group, children: [_jsx("h3", { className: css.groupHead, children: heading }), group.length === 0 ? null : (_jsx("ul", { className: css.cards, children: group.map(({ row, text }) => (_jsxs("li", { className: row.broken !== undefined
                                    ? `${css.card} ${css.cardBroken}`
                                    : row.isDefault ? `${css.card} ${css.cardActive}` : css.card, children: [_jsxs("button", { type: "button", className: css.cardMain, "aria-pressed": row.isDefault, disabled: row.isDefault || row.broken !== undefined, "aria-label": `${row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}: ${text.name}`, title: row.broken ?? (row.isDefault ? t('inUse') : t('setDefault')), onClick: () => { void props.makeDefault(row.id); }, children: [_jsxs("span", { className: css.cardHead, children: [_jsx("span", { className: css.cardName, children: text.name }), row.broken !== undefined
                                                        ? _jsx("span", { className: css.brokenBadge, children: t('brokenBadge') })
                                                        : null, _jsx("span", { className: css.badge, children: row.trust === 'user' ? t('userTrust') : t('builtIn') }), row.isDefault ? _jsx("span", { className: css.inUse, children: t('inUse') }) : null] }), _jsx(CardDescription, { text: text.description ?? t('noDescription') }), row.broken === undefined
                                                ? null
                                                : _jsx("span", { className: css.cardBrokenReason, role: "alert", children: row.broken }), _jsx("code", { className: css.cardId, children: row.id })] }), _jsxs("div", { className: css.cardFoot, children: [row.trust === 'system'
                                                ? row.broken === undefined
                                                    ? (_jsx("button", { type: "button", className: css.iconButton, "data-tip": t('view'), "aria-label": `${t('view')}: ${text.name}`, onClick: () => { void props.view(row.id); }, children: _jsx(IconBrowseOutline16, {}) }))
                                                    : null
                                                : (_jsx("button", { type: "button", className: css.iconButton, "data-tip": state.hasDocument ? t('openLocation') : t('showLocation'), "aria-label": `${state.hasDocument ? t('openLocation') : t('showLocation')}: ${text.name}`, onClick: () => { void props.openLocation(row.id); }, children: _jsx(IconFolderOpenOutline16, {}) })), _jsx("button", { type: "button", className: css.iconButton, disabled: !state.authorable || row.broken !== undefined, "data-tip": row.broken !== undefined
                                                    ? t('brokenNoCopy')
                                                    : state.authorable ? t('duplicate') : t('duplicateUnavailable'), "aria-label": `${t('duplicate')}: ${text.name}`, onClick: () => { props.beginCopy(row.id); }, children: _jsx(IconCopyOutline16, {}) }), row.trust === 'user'
                                                ? (_jsx("button", { type: "button", className: `${css.iconButton} ${css.iconDanger}`, "data-tip": t('delete'), "aria-label": `${t('delete')}: ${text.name}`, onClick: () => { props.confirmDelete(row.id); }, children: _jsx(IconTrashOutline16, {}) }))
                                                : null] }), state.revealedPaths[row.id] === undefined
                                        ? null
                                        : (_jsxs("p", { className: css.revealedPath, children: [_jsx("span", { className: css.revealedPathLabel, children: t('revealedPathLabel') }), _jsx("code", { children: state.revealedPaths[row.id] })] }))] }, row.id))) })), tail] }, trust));
            }), _jsx(CopyDialog, { state: state, t: t, actions: {
                    cancelCopy: props.cancelCopy,
                    confirmCopy: props.confirmCopy,
                    setCopyId: props.setCopyId,
                    setCopyName: props.setCopyName,
                } }), _jsx(Modal, { open: state.view !== null, onClose: () => { props.closeView(); }, title: state.view === null ? '' : `${t('view')} · ${viewedTitle}`, closeLabel: t('close'), description: t('composition'), className: css.dialog, footer: (_jsx(Button, { variant: "outline", autoFocus: true, onClick: () => { props.closeView(); }, children: t('close') })), children: state.view === null
                    ? null
                    : _jsx("pre", { className: css.viewerCode, children: state.view.content }) }), _jsx(Modal, { open: state.pendingDelete !== null, onClose: () => { props.confirmDelete(null); }, title: t('deleteTitle'), closeLabel: t('close'), description: t('deleteDescription'), className: css.deleteDialog, footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", autoFocus: true, disabled: state.deleting, onClick: () => { props.confirmDelete(null); }, children: t('cancel') }), _jsx(Button, { variant: "outline", className: css.deleteConfirm, disabled: state.deleting, onClick: () => { void props.remove(); }, children: state.deleting ? t('deleting') : t('deleteConfirm') })] })) })] }));
}
//# sourceMappingURL=AgentPresetSection.js.map