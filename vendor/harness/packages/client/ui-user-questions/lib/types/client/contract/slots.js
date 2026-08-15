/**
 * Narrow a request to a renderable plan review, or return undefined to leave it
 * to the generic question flow.
 *
 * The card is one decision over one plan, and it claims a request only when it
 * can send every answer that request allows — an intent changes the layout,
 * never which answers are reachable. So the batch must be a single question
 * that declares the intent, carries the plan as its detail, offers the approve
 * label the intent names, and is a binary single choice: at most one option
 * besides approve, and not multi-select. A third option or a multi-select batch
 * has answers two buttons cannot express, so the generic flow keeps it — as it
 * keeps any request whose intent the asker's own service would have rejected,
 * because the client sits downstream of a wire boundary and every request must
 * stay answerable.
 *
 * @param questions - the request's whole question batch.
 * @returns The narrowed review, or undefined when the generic flow owns it.
 */
export function planReviewOf(questions) {
    if (questions.length !== 1)
        return undefined;
    // Length-checked above; the index read is the narrowing tax, not a guess.
    const question = questions[0];
    const intent = question.intent;
    if (intent?.kind !== 'plan-review' || question.detail === undefined)
        return undefined;
    if (question.multiSelect === true)
        return undefined;
    const options = question.options ?? [];
    if (options.length > 2)
        return undefined;
    const approve = options.find(option => option.label === intent.approve);
    if (approve === undefined)
        return undefined;
    const decline = options.find(option => option.label !== intent.approve);
    return {
        id: question.id,
        question: question.question,
        plan: question.detail,
        approve,
        ...(decline === undefined ? {} : { decline }),
    };
}
/**
 * Question domain face over the carrier: render identity and questions
 * transparently forwarded; answer/cancel own the wire encoding (the success
 * fields and the cancelled error) and turn a rejected carrier receipt into a
 * thrown error. Components mint one per carrier via useMemo (never inside a
 * select — a per-dispatch mint would churn identity and break memoization).
 */
export class PendingQuestion {
    wait;
    /**
     * @param wait - the runtime carrier for one pending question request.
     */
    constructor(wait) {
        this.wait = wait;
    }
    /** Opaque render identity (React key / draft remount axis), forwarded from the carrier. */
    get key() {
        return this.wait.key;
    }
    /** The request's question list, forwarded from the carrier payload. */
    get questions() {
        return this.wait.payload.questions;
    }
    /**
     * Deliver the whole answer batch; a rejected carrier receipt throws.
     * @param answer - complete structured answer batch.
     */
    async answer(answer) {
        const receipt = await this.wait.respond({
            ok: true, value: { sessionId: this.wait.sessionId, answer },
        });
        if (!receipt.accepted) {
            throw new Error(`question response rejected: ${receipt.reason}`);
        }
    }
    /** Reject the whole wait (the host resolves the tool call as cancelled); a rejected receipt throws. */
    async cancel() {
        const receipt = await this.wait.respond({
            ok: false,
            error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
        });
        if (!receipt.accepted) {
            throw new Error(`question cancellation rejected: ${receipt.reason}`);
        }
    }
}
//# sourceMappingURL=slots.js.map