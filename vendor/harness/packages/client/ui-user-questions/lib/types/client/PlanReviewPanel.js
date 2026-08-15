import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// PlanReviewPanel: the composer takeover for a question carrying the
// `plan-review` presentation intent. A plan under review is one decision over
// one body of markdown, so it takes the waiting-approval card shape — tinted
// strip, content, right-aligned action row — instead of the generic question
// flow's pager, numbered options, skip and custom-answer affordances, which
// read as a quiz the user is being graded on.
//
// The three actions are the whole decision surface: approve and decline answer
// the question with the option labels the asker offered (localised copy on the
// buttons, the asker's descriptions as their tooltips), while "discuss"
// dismisses the request so the composer returns and the user can simply say
// what they want. Dismissal is the generic flow's own cancel verb, promoted to
// a labelled button because in a two-outcome decision it is the third real
// answer, not an escape hatch.
import { useState } from 'react';
import { Button, IconEditOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './PlanReviewPanel.module.css';
/**
 * Optional-prop spread for a decision button's tooltip: `title` is optional on
 * the DOM props, and exactOptionalPropertyTypes rejects an explicit undefined.
 *
 * @param description - the asker's option description, when it carries one.
 * @returns The `title` prop to spread, or nothing.
 */
function tooltip(description) {
    return description === undefined ? {} : { title: description };
}
/**
 * Render a plan review as a decision card.
 *
 * @param props - the question domain face, the narrowed plan review, and `t`.
 * @returns The plan-review takeover for this request.
 */
export function PlanReviewPanel({ pending, review, t }) {
    // One-shot latch shaped like the approval takeover's: the panel leaves only
    // when the host's resolved frame lands, so until then a second click must
    // not re-fire. A failed send (rejected receipt / transport) re-arms it and
    // shows why, since nothing else would tell the user the click was lost.
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const settle = (send) => {
        setBusy(true);
        setError(null);
        void send().catch((cause) => {
            setBusy(false);
            setError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    const decide = (label) => {
        settle(() => pending.answer({ answers: [{ id: review.id, selected: [label] }] }));
    };
    const decline = review.decline;
    return (_jsx("div", { className: css.frame, "data-plan-review-key": pending.key, children: _jsxs("section", { className: css.card, "aria-label": review.question, children: [_jsxs("div", { className: css.strip, children: [_jsx("span", { className: css.dot }), t('plan.header')] }), _jsx("div", { className: css.body, "data-plan-review-scroll": true, children: _jsx(MarkdownText, { text: review.plan }) }), _jsxs("div", { className: css.footer, children: [_jsx("div", { className: css.feedback, role: "status", children: error }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "ghost", className: css.discuss, icon: _jsx(IconEditOutline16, { size: 14 }), disabled: busy, onClick: () => { settle(() => pending.cancel()); }, children: t('plan.discuss') }), decline !== undefined && (_jsx(Button, { variant: "outline", ...tooltip(decline.description), disabled: busy, onClick: () => { decide(decline.label); }, children: t('plan.decline') })), _jsx(Button, { variant: "primary", ...tooltip(review.approve.description), disabled: busy, onClick: () => { decide(review.approve.label); }, children: t('plan.approve') })] })] })] }) }));
}
//# sourceMappingURL=PlanReviewPanel.js.map