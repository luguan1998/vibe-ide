/**
 * Per-message feedback controls: a Like/Dislike pair plus an optional note.
 * Rendered inside the assistant message's IconActions row, so the buttons
 * reuse that row's chrome and sit between copy and branch.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */
import type { MessageFeedbackActionProps } from './slots.ts';
/**
 * One message's feedback controls.
 * @param props - the owner's message identity, the injected verbs, and the
 * shared feedback hook.
 * @returns the rating buttons, plus the note editor while it is open.
 */
export declare function MessageFeedbackActions({ messageId, ensure, rate, toggle, clearNote, useFeedback, t }: MessageFeedbackActionProps): import("react").JSX.Element;
//# sourceMappingURL=MessageFeedbackActions.d.ts.map