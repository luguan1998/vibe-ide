/** The shell card's staged form over the `bash` settings namespace. */
import { CardForm, numberField } from "./card-form.js";
/**
 * Namespace of the shell capability. Spelled here rather than imported: a
 * client package must not depend on a Host package, and the executor families
 * that own it spell the same value.
 */
export const SHELL_NS = 'shell';
/** Bridges the `bash` scope onto the shell card's staged form. */
export class BashCardController {
    form;
    store;
    /** @param scope - the bound settings scope for the `bash` namespace. */
    constructor(scope) {
        this.form = new CardForm(scope, [numberField('timeoutMs'), numberField('maxOutputBytes')]);
        this.store = this.form.bind(() => this.projection());
    }
    projection() {
        return {
            ...this.form.shell(),
            timeoutMs: this.form.field('timeoutMs'),
            maxOutputBytes: this.form.field('maxOutputBytes'),
        };
    }
    /**
     * Build the face the card's slot registration injects.
     * @returns the card's snapshot and its form actions.
     */
    inject() {
        return { hooks: { bashCard: this.store }, ...this.form.actions() };
    }
}
//# sourceMappingURL=bash-card-controller.js.map