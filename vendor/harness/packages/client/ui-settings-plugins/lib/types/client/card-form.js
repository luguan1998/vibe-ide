/**
 * Shared form model behind every plugin card.
 *
 * A card stages what the user types and writes it only when they save. Each
 * settings write is a durable, revision-fenced document mutation, so a control
 * that committed as it settled turned one edit into a write the user never
 * asked for and could not preview; staged text makes what is on screen exactly
 * what a save would store.
 *
 * A field shows its effective value — the user layer over the composition
 * layer over the schema default — and whether the user layer carries it. That
 * presence, not a value comparison, is what marks a field overridden: an
 * override equal to the composition default is still an override.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * A whole-number field. An empty draft clears the field; any other draft that
 * is not a finite number blocks the save.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function numberField(field) {
    return {
        field,
        // A section that carries no number for this field renders empty rather
        // than as a value nobody chose.
        format: value => typeof value === 'number' ? String(value) : '',
        parse: (text) => {
            const trimmed = text.trim();
            if (trimmed === '')
                return { kind: 'clear' };
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined;
        },
    };
}
/**
 * A free-text field. An empty draft clears the field, so emptying the control
 * and saving is the same gesture as resetting it.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function textField(field) {
    return {
        field,
        format: value => typeof value === 'string' ? value : '',
        parse: (text) => {
            const trimmed = text.trim();
            return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed };
        },
    };
}
/**
 * Stages one card's edits over one settings namespace and writes them on save.
 *
 * The form publishes through a snapshot store because slot components read
 * through a snapshot selector, while both the scope and the local drafts
 * change underneath; every projection is rebuilt from the two together.
 */
export class CardForm {
    scope;
    specs;
    secretSpecs;
    staged = new Map();
    listeners = new Set();
    saving = false;
    failed = false;
    /**
     * @param scope - the bound settings scope for this card's namespace.
     * @param specs - the section fields this card edits.
     * @param secrets - the card's write-only controls, written outside the section.
     */
    constructor(scope, specs, secrets = []) {
        this.scope = scope;
        this.specs = new Map(specs.map(spec => [spec.field, spec]));
        this.secretSpecs = new Map(secrets.map(spec => [spec.field, spec]));
        scope.subscribe(() => { this.publish(); });
    }
    /**
     * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
     * @param project - build the card's state from the form's current reads.
     * @returns the store the card's component reads through its bound selector.
     */
    bind(project) {
        const store = createSnapshotStore(project());
        this.listeners.add(() => { store.set(project()); });
        return store;
    }
    /**
     * Read the card-level state: what the Host serves, and what a save would do.
     * @returns the form state every card shares.
     */
    shell() {
        const snapshot = this.scope.getSnapshot();
        const plan = this.plan();
        return {
            available: snapshot.status === 'ready',
            writable: snapshot.writable,
            dirty: plan.length > 0,
            invalid: plan.some(item => item.run === undefined),
            saving: this.saving,
            failed: this.failed,
        };
    }
    /**
     * Read one control's state.
     * @param field - field name of a section field or of a write-only control.
     * @returns the draft text, whether a save would leave an override, and whether it is invalid.
     */
    field(field) {
        const staged = this.staged.get(field);
        if (this.secretSpecs.has(field)) {
            return { text: staged?.text ?? '', overridden: false, invalid: false };
        }
        const spec = this.spec(field);
        if (staged === undefined) {
            return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
        }
        const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text);
        return {
            text: staged.text,
            overridden: write?.kind === 'set',
            invalid: write === undefined,
        };
    }
    /**
     * Build the edit, reset, save, and discard actions bound to this form.
     * @returns the actions a card's slot entry injects.
     */
    actions() {
        return {
            edit: (field, text) => { this.stage(field, { text, clear: false }); },
            resetField: (field) => {
                this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true });
            },
            save: () => { void this.save(); },
            discard: () => {
                if (this.staged.size === 0 && !this.failed)
                    return;
                this.staged.clear();
                this.failed = false;
                this.publish();
            },
        };
    }
    /**
     * Write every staged edit, then re-seed from what the Host accepted.
     *
     * The Host is the only authority on whether a value was accepted — its
     * validators own the constraints no schema can express — so the outcome is
     * read back from the section rather than predicted here. A save that did not
     * land keeps its drafts, so the user can correct them instead of retyping.
     * @returns settlement after every write and the read-back.
     */
    async save() {
        const plan = this.plan();
        const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run]);
        if (plan.length === 0 || this.saving || writes.length !== plan.length)
            return;
        this.saving = true;
        this.failed = false;
        this.publish();
        let landed = true;
        for (const write of writes) {
            landed = await write() && landed;
        }
        if (landed)
            this.staged.clear();
        this.saving = false;
        this.failed = !landed;
        this.publish();
    }
    /**
     * Every staged edit a save would write. An entry whose draft is not a value
     * its field accepts carries no write: the form is still dirty, and the save
     * refuses rather than dropping the edit.
     * @returns the planned writes, in the order the fields were staged.
     */
    plan() {
        const plan = [];
        for (const [field, staged] of this.staged) {
            const secret = this.secretSpecs.get(field);
            if (secret !== undefined) {
                const value = staged.text.trim();
                if (value !== '')
                    plan.push({ field, run: () => secret.write(value) });
                continue;
            }
            const spec = this.spec(field);
            if (staged.clear) {
                if (this.stored(field))
                    plan.push({ field, run: () => this.clear(field) });
                continue;
            }
            if (staged.text === spec.format(this.sectionValue(field)))
                continue;
            const write = spec.parse(staged.text);
            if (write === undefined)
                plan.push({ field, run: undefined });
            else if (write.kind === 'clear')
                plan.push({ field, run: () => this.clear(field) });
            else
                plan.push({ field, run: () => this.store(field, write.value) });
        }
        return plan;
    }
    async clear(field) {
        await this.scope.unset(field);
        return !this.stored(field);
    }
    async store(field, value) {
        await this.scope.set(field, value);
        return this.userLayer()?.[field] === value;
    }
    stage(field, edit) {
        this.staged.set(field, edit);
        this.failed = false;
        this.publish();
    }
    spec(field) {
        const spec = this.specs.get(field);
        // Every call site names a field this card declared; a missing one is a
        // wiring mistake that must not degrade into a silently inert control.
        if (spec === undefined)
            throw new Error(`plugin card has no field ${field}`);
        return spec;
    }
    snapshotOf() {
        return this.scope.getSnapshot();
    }
    sectionValue(field) {
        return this.snapshotOf().value?.[field];
    }
    baseValue(field) {
        return this.snapshotOf().base?.[field];
    }
    userLayer() {
        return this.snapshotOf().user;
    }
    stored(field) {
        const user = this.userLayer();
        return user !== undefined && Object.hasOwn(user, field);
    }
    publish() {
        for (const listener of this.listeners)
            listener();
    }
}
//# sourceMappingURL=card-form.js.map