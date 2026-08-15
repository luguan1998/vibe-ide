import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Button, IconCheckOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16, IconEditOutline16, MarkdownText, } from '@deepseek-ai/dsh-client-ui-primitives';
import { PendingQuestion, planReviewOf, } from "./contract/slots.js";
import { PlanReviewPanel } from "./PlanReviewPanel.js";
import css from './QuestionComposer.module.css';
/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label) {
    const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
    return suffix.test(label)
        ? { label: label.replace(suffix, ''), recommended: true }
        : { label, recommended: false };
}
/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event) {
    // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
    // oxlint-disable-next-line typescript/no-deprecated
    return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}
/**
 * Composer takeover boundary; the carrier key keys local drafts, so a
 * same-request replay (same key, new carrier object) preserves them.
 *
 * One takeover, two shapes: a request that declares a presentation intent this
 * package renders takes that shape (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither shape can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
export function QuestionComposer(props) {
    // Domain-face mint rides the carrier's stable identity (never minted in a
    // select/render dispatch — per-dispatch minting would churn memo identity).
    const question = useMemo(() => new PendingQuestion(props.matched), [props.matched]);
    const review = useMemo(() => planReviewOf(question.questions), [question]);
    return review === undefined
        ? _jsx(QuestionFlow, { pending: question, t: props.t }, question.key)
        : _jsx(PlanReviewPanel, { pending: question, review: review, t: props.t }, question.key);
}
function QuestionFlow({ pending, t }) {
    const questions = pending.questions;
    const [index, setIndex] = useState(0);
    const [drafts, setDrafts] = useState(() => questions.map(() => ({
        selected: [], custom: '', skipped: false,
    })));
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    // index stays in bounds (every setIndex site clamps) and drafts mirrors questions 1:1.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const question = questions[index];
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const draft = drafts[index];
    const hasOptions = (question.options?.length ?? 0) > 0;
    const cancelFlow = () => {
        setBusy('cancel');
        setError(null);
        void pending.cancel().catch((cause) => {
            setBusy(null);
            setError({ text: cause instanceof Error ? cause.message : String(cause) });
        });
    };
    const updateDraft = (update) => {
        setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? update(item) : item));
        setError(null);
    };
    const choose = (label) => {
        updateDraft((current) => {
            if (question.multiSelect === true) {
                const selected = current.selected.includes(label)
                    ? current.selected.filter(item => item !== label)
                    : [...current.selected, label];
                return { ...current, selected, skipped: false };
            }
            return { selected: [label], custom: '', skipped: false };
        });
        if (question.multiSelect !== true && index < questions.length - 1) {
            setIndex(current => current + 1);
        }
    };
    const answered = (item) => item.selected.length > 0 || item.custom.trim() !== '';
    const completed = (item) => answered(item) || item.skipped;
    const submitDrafts = (values) => {
        const missing = values.findIndex(item => !completed(item));
        if (missing >= 0) {
            setIndex(missing);
            setError({ key: 'error.incomplete' });
            return;
        }
        const answer = {
            answers: questions.map((item, itemIndex) => {
                const value = values[itemIndex];
                if (value.skipped)
                    return { id: item.id, selected: [] };
                const custom = value.custom.trim();
                return {
                    id: item.id,
                    selected: custom === '' || item.multiSelect === true ? value.selected : [],
                    ...(custom === '' ? {} : { custom }),
                };
            }),
        };
        setBusy('answer');
        setError(null);
        void pending.answer(answer).catch((cause) => {
            setBusy(null);
            setError({ text: cause instanceof Error ? cause.message : String(cause) });
        });
    };
    const continueFlow = () => {
        if (!answered(draft)) {
            setError({ key: 'error.unanswered' });
            return;
        }
        if (index < questions.length - 1) {
            setIndex(current => current + 1);
            setError(null);
            return;
        }
        submitDrafts(drafts);
    };
    // Shared by the inline custom input and the optionless textarea: a
    // multi-select draft retains checked labels, while a single-select custom
    // answer replaces its selection. Enter continues the flow (Shift+Enter
    // stays a newline in the textarea; on the single-line input it is inert).
    const draftCustom = (event) => {
        const value = event.target.value;
        updateDraft(current => ({
            ...current,
            selected: question.multiSelect === true ? current.selected : [],
            custom: value,
            skipped: false,
        }));
    };
    const continueFromCustom = (event) => {
        if (event.key !== 'Enter' || event.shiftKey || isComposing(event))
            return;
        event.preventDefault();
        continueFlow();
    };
    const skipQuestion = () => {
        const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
            ? { selected: [], custom: '', skipped: true }
            : item);
        setDrafts(nextDrafts);
        setError(null);
        if (index < questions.length - 1) {
            setIndex(current => current + 1);
            return;
        }
        submitDrafts(nextDrafts);
    };
    return (_jsx("div", { className: css.frame, "data-question-key": pending.key, children: _jsxs("section", { className: css.card, "aria-labelledby": `question-${pending.key}-${String(index)}`, children: [_jsxs("header", { className: css.header, children: [_jsxs("div", { className: css.headingBlock, children: [question.header !== undefined && _jsx("div", { className: css.eyebrow, children: question.header }), _jsx("h2", { className: css.title, id: `question-${pending.key}-${String(index)}`, children: question.question })] }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('nav.cancel'), title: t('nav.cancel'), disabled: busy !== null, onClick: cancelFlow, children: _jsx(IconCloseOutline16, {}) })] }), _jsxs("div", { className: css.body, "data-question-scroll": true, children: [question.detail !== undefined && (_jsx("div", { className: css.detail, children: _jsx(MarkdownText, { text: question.detail }) })), _jsxs("div", { className: css.options, role: question.multiSelect === true ? 'group' : 'radiogroup', children: [(question.options ?? []).map((option, optionIndex) => {
                                    const selected = draft.selected.includes(option.label);
                                    const display = parseRecommendedLabel(option.label);
                                    return (_jsxs("button", { type: "button", className: clsx(css.option, selected && question.multiSelect !== true && css.optionSelected), role: question.multiSelect === true ? 'checkbox' : 'radio', "aria-checked": selected, "aria-label": display.label, disabled: busy !== null, onClick: () => { choose(option.label); }, onKeyDown: (event) => {
                                            if (event.key !== 'Enter' || !drafts.every(completed))
                                                return;
                                            event.preventDefault();
                                            submitDrafts(drafts);
                                        }, children: [question.multiSelect === true
                                                ? (_jsx("span", { className: clsx(css.checkbox, selected && css.checkboxChecked), "aria-hidden": "true", children: selected && _jsx(IconCheckOutline14, { size: 12 }) }))
                                                : _jsx("span", { className: css.number, children: optionIndex + 1 }), _jsx("span", { className: css.optionCopy, children: _jsxs("span", { className: css.optionLine, children: [_jsx("span", { className: css.optionLabel, children: display.label }), display.recommended && (_jsx("span", { className: css.badge, children: t('option.recommended') })), option.description !== undefined && (_jsx("span", { className: css.description, children: option.description }))] }) })] }, `${option.label}-${String(optionIndex)}`));
                                }), hasOptions
                                    ? (_jsxs("div", { className: clsx(css.customRow, draft.custom !== '' && css.customRowActive), children: [question.multiSelect === true
                                                ? (_jsx("span", { className: clsx(css.checkbox, draft.custom !== '' && css.checkboxChecked), "aria-hidden": "true", children: draft.custom !== '' && _jsx(IconCheckOutline14, { size: 12 }) }))
                                                : (_jsx("span", { className: css.number, "aria-hidden": "true", children: _jsx(IconEditOutline16, { size: 12 }) })), _jsx("input", { type: "text", className: css.customInput, value: draft.custom, disabled: busy !== null, placeholder: t('custom.placeholder'), onChange: draftCustom, onKeyDown: continueFromCustom })] }))
                                    : (_jsx("textarea", { autoFocus: true, className: css.customTextarea, value: draft.custom, disabled: busy !== null, rows: 2, placeholder: t('custom.placeholder'), onChange: draftCustom, onKeyDown: continueFromCustom }))] })] }), _jsxs("footer", { className: css.footer, children: [_jsxs("div", { className: css.pager, children: [_jsx("button", { type: "button", className: css.iconButton, "aria-label": t('nav.prev'), disabled: index === 0 || busy !== null, onClick: () => { setIndex(index - 1); setError(null); }, children: _jsx(IconChevronLeftOutline14, {}) }), _jsxs("span", { className: css.progress, children: [index + 1, " / ", questions.length] }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('nav.next'), disabled: index === questions.length - 1 || busy !== null, onClick: () => { setIndex(index + 1); setError(null); }, children: _jsx(IconChevronRightOutline14, {}) })] }), _jsx("div", { className: css.feedback, role: "status", children: error === null ? null : 'key' in error ? t(error.key) : error.text }), _jsxs("div", { className: css.footerActions, children: [_jsx(Button, { variant: "outline", disabled: busy !== null, onClick: skipQuestion, children: t('action.skip') }), _jsx(Button, { variant: "primary", disabled: busy !== null || !answered(draft), onClick: continueFlow, children: busy === 'answer'
                                        ? t('submitting')
                                        : index === questions.length - 1 ? t('submit') : t('action.next') })] })] })] }) }));
}
//# sourceMappingURL=QuestionComposer.js.map