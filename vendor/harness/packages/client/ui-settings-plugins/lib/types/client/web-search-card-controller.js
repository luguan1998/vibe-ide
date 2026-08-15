/**
 * The web-search card's staged form over the `web-search-deepseek` settings
 * namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the card shows.
 */
import { CardForm, numberField, textField, } from "./card-form.js";
/**
 * Namespace of the DeepSeek search provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_NS = 'web-search-deepseek';
/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY';
/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey';
/** Bridges the `web-search-deepseek` scope and the credentials domain onto the card. */
export class WebSearchCardController {
    scope;
    api;
    form;
    store;
    credential = { ref: '', configured: false, writable: true };
    /**
     * @param scope - the bound settings scope for the `web-search-deepseek` namespace.
     * @param api - wire face used for the credential the section references.
     */
    constructor(scope, api) {
        this.scope = scope;
        this.api = api;
        this.form = new CardForm(scope, [textField('baseURL'), numberField('maxUses')], [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }]);
        this.store = this.form.bind(() => this.projection());
        scope.subscribe(() => { void this.readCredential(); });
        void this.readCredential();
    }
    projection() {
        return {
            ...this.form.shell(),
            baseURL: this.form.field('baseURL'),
            maxUses: this.form.field('maxUses'),
            apiKey: this.form.field(API_KEY_FIELD),
            apiKeyConfigured: this.credential.configured,
            apiKeyWritable: this.credential.writable,
        };
    }
    /**
     * Ask the credentials domain about the reference the section currently names.
     *
     * The answer is stored with the reference it describes: `apiKeyEnv` can
     * change between the request and its response, and two reads can settle out
     * of order, so a response is published only while it still answers for the
     * reference in force.
     */
    async readCredential() {
        const ref = refOf(this.scope.getSnapshot());
        if (ref !== this.credential.ref) {
            // A new reference knows nothing yet; keeping the old answer would claim
            // the key is configured under a name nobody has checked.
            this.credential = { ref, configured: false, writable: true };
            this.store.set(this.projection());
        }
        let response;
        try {
            response = await this.api.credentials.describe({ refs: [ref] });
        }
        catch (_credentialReadFailure) {
            // The card stays usable without this: the key control simply reports the
            // last state it knew, and a write still reaches the Host.
            return;
        }
        if (!response.result.ok || ref !== refOf(this.scope.getSnapshot()))
            return;
        const view = response.result.value.credentials[ref];
        const next = {
            ref,
            configured: view?.configured ?? false,
            // An unknown reference is treated as writable: the control stays usable
            // and the Host is what refuses, rather than the card guessing a refusal.
            writable: view?.writable ?? true,
        };
        if (next.configured === this.credential.configured && next.writable === this.credential.writable)
            return;
        this.credential = next;
        this.store.set(this.projection());
    }
    /**
     * Re-read after the Host reports a change to the reference this card watches.
     *
     * A key can be written from somewhere else — the Models page addresses the
     * same reference — and the settings section does not change when it is, so
     * without this the badge keeps reporting a state the Host already replaced.
     * @param ref - the reference the Host reports as changed.
     */
    refreshCredential(ref) {
        if (ref !== this.credential.ref)
            return;
        void this.readCredential();
    }
    /**
     * Build the face the card's slot registration injects.
     * @returns the card's snapshot and its form actions.
     */
    inject() {
        return { hooks: { webSearchCard: this.store }, ...this.form.actions() };
    }
    /**
     * Write the staged key, then re-read whether the Host now holds one.
     * @param value - the staged credential literal.
     * @returns whether the Host reports a configured credential afterwards.
     */
    async writeKey(value) {
        try {
            await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value });
        }
        catch (_credentialWriteFailure) {
            // Refusals surface through the re-read below: the Host is the only
            // authority on whether the key now exists.
        }
        await this.readCredential();
        return this.credential.configured;
    }
}
/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot) {
    const declared = snapshot.value?.apiKeyEnv;
    return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
}
//# sourceMappingURL=web-search-card-controller.js.map