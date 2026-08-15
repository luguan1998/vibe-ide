import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Per-message feedback controls: a Like/Dislike pair plus an optional note.
 * Rendered inside the assistant message's IconActions row, so the buttons
 * reuse that row's chrome and sit between copy and branch.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconDislikeOutline16, IconLikeOutline16, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './MessageFeedbackActions.module.css';
/**
 * One message's feedback controls.
 * @param props - the owner's message identity, the injected verbs, and the
 * shared feedback hook.
 * @returns the rating buttons, plus the note editor while it is open.
 */
export function MessageFeedbackActions({ messageId, ensure, rate, toggle, clearNote, useFeedback, t }) {
    const item = useFeedback(view => view.items.get(messageId));
    const loadFailed = useFeedback(view => view.status === 'error');
    const rating = item?.rating;
    const [noteOpen, setNoteOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState(null);
    // The controls mount for every settled message in the transcript, so the
    // Session's feedback is read once on first hover/focus rather than on mount.
    const seeded = useRef(false);
    const seed = useCallback(() => {
        if (seeded.current)
            return;
        seeded.current = true;
        void ensure();
    }, [ensure]);
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);
    const settle = useCallback((result) => {
        if (!alive.current)
            return;
        setPending(false);
        if (result.ok) {
            setFailure(null);
            return;
        }
        setFailure(result.error?.code === 'version-conflict' ? t('error.conflict') : t('error.generic'));
    }, [t]);
    const onRate = useCallback((next) => {
        setPending(true);
        setFailure(null);
        // The controller decides retract-vs-replace from the committed item, so a
        // click that lands before the first list read still toggles the stored
        // value instead of this render's empty view.
        setNoteOpen(false);
        void toggle(messageId, next).then(settle);
    }, [messageId, settle, toggle]);
    // The rating is a parameter because only the note editor's render site can
    // prove one is recorded; that removes an unreachable undefined guard here.
    const onSaveNote = useCallback((current) => {
        const trimmed = draft.trim();
        setPending(true);
        setFailure(null);
        // An emptied editor removes the note explicitly; `rate` alone preserves a
        // stored note, so it cannot express deletion.
        const settled = trimmed.length === 0
            ? clearNote(messageId)
            : rate(messageId, current, trimmed);
        void settled.then((result) => {
            settle(result);
            if (result.ok && alive.current)
                setNoteOpen(false);
        });
    }, [clearNote, draft, messageId, rate, settle]);
    const openNote = useCallback(() => {
        setDraft(item?.note ?? '');
        setNoteOpen(true);
    }, [item?.note]);
    const likeLabel = rating === 'positive' ? t('action.likeActive') : t('action.like');
    const dislikeLabel = rating === 'negative' ? t('action.dislikeActive') : t('action.dislike');
    return (_jsxs(_Fragment, { children: [_jsx(Tooltip, { label: likeLabel, side: "bottom", children: _jsx("button", { type: "button", className: css.action, "aria-label": likeLabel, "aria-pressed": rating === 'positive', "data-active": rating === 'positive' || undefined, disabled: pending, onFocus: seed, onPointerEnter: seed, onClick: () => { onRate('positive'); }, children: _jsx(IconLikeOutline16, {}) }) }), _jsx(Tooltip, { label: dislikeLabel, side: "bottom", children: _jsx("button", { type: "button", className: css.action, "aria-label": dislikeLabel, "aria-pressed": rating === 'negative', "data-active": rating === 'negative' || undefined, disabled: pending, onFocus: seed, onPointerEnter: seed, onClick: () => { onRate('negative'); }, children: _jsx(IconDislikeOutline16, {}) }) }), rating !== undefined && !noteOpen && (_jsx("button", { type: "button", className: css.noteOpen, onClick: openNote, children: item?.note === undefined ? t('note.open') : item.note })), rating !== undefined && noteOpen && (_jsxs("span", { className: css.noteEditor, children: [_jsx("textarea", { className: css.noteInput, "aria-label": t('note.aria'), placeholder: t('note.placeholder'), value: draft, rows: 2, onChange: (event) => { setDraft(event.target.value); } }), _jsx("button", { type: "button", className: css.noteSave, disabled: pending, onClick: () => { onSaveNote(rating); }, children: t('note.save') }), _jsx("button", { type: "button", className: css.noteCancel, onClick: () => { setNoteOpen(false); }, children: t('note.cancel') })] })), failure === null && loadFailed && (_jsx("span", { className: css.failure, role: "status", children: t('error.load') })), failure !== null && _jsx("span", { className: css.failure, role: "status", children: failure })] }));
}
//# sourceMappingURL=MessageFeedbackActions.js.map