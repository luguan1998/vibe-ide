/** The agent-loop card's staged form over the `agent-loop` settings namespace. */
import { CardForm, numberField } from "./card-form.js";
/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop';
/** Bridges the `agent-loop` scope onto the card's staged form. */
export class AgentLoopCardController {
    form;
    store;
    /** @param scope - the bound settings scope for the `agent-loop` namespace. */
    constructor(scope) {
        this.form = new CardForm(scope, [numberField('maxParallelToolCalls')]);
        this.store = this.form.bind(() => this.projection());
    }
    projection() {
        return { ...this.form.shell(), maxParallelToolCalls: this.form.field('maxParallelToolCalls') };
    }
    /**
     * Build the face the card's slot registration injects.
     * @returns the card's snapshot and its form actions.
     */
    inject() {
        return { hooks: { agentLoopCard: this.store }, ...this.form.actions() };
    }
}
//# sourceMappingURL=agent-loop-card-controller.js.map