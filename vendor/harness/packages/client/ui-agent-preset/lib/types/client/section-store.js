/**
 * Agent-preset management controller: the roster as a list, a copy dialog as
 * the only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text. A new preset is a host-side copy of
 * an existing one (`{ from, id, name? }` is all that crosses the wire), and
 * everything after creation happens in the preset's own files — which is why
 * the page's other job is getting the user TO those files: open the directory
 * where the host has a desktop, show its path where it does not.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because a copy changes
 * more than the row it targeted.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import { beginRosterRead, messageOf, writeDefaultPreset } from "./settings-store.js";
/** Ids a preset directory may be named, mirroring the host's own rule. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const INITIAL = {
    status: 'idle',
    error: null,
    authorable: false,
    hasDocument: false,
    rows: [],
    copy: null,
    view: null,
    pendingDelete: null,
    deleting: false,
    revealedPaths: {},
};
/**
 * Why this copy cannot be submitted yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id and its answer is what
 * the dialog reports on failure.
 * @param draft - the open copy dialog.
 * @param rows - the roster, for the collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
export function draftBlocker(draft, rows) {
    if (draft.id === '')
        return 'idRequired';
    if (!PRESET_ID.test(draft.id))
        return 'idInvalid';
    // A copy never overwrites: landing on a name already in use would replace
    // something the user did not open.
    if (rows.some(row => row.id === draft.id))
        return 'idTaken';
    return undefined;
}
/** Reads the roster and drives the copy dialog, viewer, and location reveals. */
export class AgentPresetSectionController {
    api;
    rosterChanged;
    /** Page snapshot the renderer subscribes to. */
    store = createSnapshotStore(INITIAL);
    constructor(api, 
    /**
     * Called after this page changes the roster DIRECTORY, so the other
     * surfaces reading the same roster re-read it. A settings field moving is
     * already announced by the host through the forwarded
     * `settings/document-updated`; a directory copied or deleted here is not,
     * and the new-session chip has no other way to learn a preset it should
     * offer now exists.
     */
    rosterChanged = () => { }) {
        this.api = api;
        this.rosterChanged = rosterChanged;
    }
    set(patch) {
        this.store.set({ ...this.store.getSnapshot(), ...patch });
    }
    patchCopy(patch) {
        const { copy } = this.store.getSnapshot();
        if (copy === null)
            return;
        this.set({ copy: { ...copy, ...patch } });
    }
    /**
     * Load the roster. An empty roster means the deployment composes no
     * presets, which is a valid deployment rather than a failure — the section
     * reports `unavailable` and renders nothing.
     * @returns once the snapshot reflects the host.
     */
    async load() {
        const roster = await beginRosterRead(this.api, this.store);
        if (roster === undefined)
            return;
        const { presets, authorable, hasDocument } = roster;
        if (presets.length === 0) {
            // Nothing to manage leaves nothing to keep a dialog open over.
            this.set({ status: 'unavailable', rows: [], authorable, hasDocument, copy: null, view: null });
            return;
        }
        // A reveal outlives a reload but not its preset: a path for a row the
        // roster no longer lists would be a claim about a directory that is gone.
        const revealed = this.store.getSnapshot().revealedPaths;
        const kept = Object.fromEntries(Object.entries(revealed).filter(([id]) => presets.some(preset => preset.id === id)));
        this.set({
            status: 'ready',
            error: null,
            authorable,
            hasDocument,
            rows: presets.map(preset => ({ ...preset })),
            revealedPaths: kept,
        });
    }
    /**
     * Open one shipped preset's composition in the read-only viewer.
     * @param id - the preset to view.
     * @returns once the composition loaded or the failure is on the page.
     */
    async view(id) {
        this.set({ error: null });
        try {
            const response = await this.api.agentPresets.read({ agentPreset: id });
            if (!response.result.ok) {
                this.set({ error: response.result.error.message });
                return;
            }
            const { name, content } = response.result.value;
            this.set({ view: { id, title: name ?? id, content } });
        }
        catch (error) {
            this.set({ error: messageOf(error) });
        }
    }
    /** Close the read-only viewer. */
    closeView() {
        this.set({ view: null });
    }
    /**
     * Open the copy dialog over one preset.
     * @param from - the preset the copy will start from.
     */
    beginCopy(from) {
        const row = this.store.getSnapshot().rows.find(candidate => candidate.id === from);
        this.set({
            error: null,
            copy: { from, fromTitle: row?.name ?? from, id: '', name: '', saving: false, error: null },
        });
    }
    /** Close the copy dialog, discarding whatever was typed. */
    cancelCopy() {
        this.set({ copy: null });
    }
    /**
     * Name the preset the copy creates.
     * @param id - the id typed into the dialog.
     */
    setCopyId(id) {
        this.patchCopy({ id, error: null });
    }
    /**
     * Name the copy's display name.
     * @param name - the display name typed into the dialog.
     */
    setCopyName(name) {
        this.patchCopy({ name, error: null });
    }
    /**
     * Submit the copy, re-read the roster, then take the user to the new
     * preset's files — the directory opens where the host has a desktop, and
     * its path appears on the new row where it does not.
     * @returns once the copy settled and the page reflects it.
     */
    async confirmCopy() {
        const draft = this.store.getSnapshot().copy;
        if (draft === null || draft.saving)
            return;
        if (draftBlocker(draft, this.store.getSnapshot().rows) !== undefined)
            return;
        this.patchCopy({ saving: true, error: null });
        try {
            const name = draft.name.trim();
            const response = await this.api.agentPresets.copy({
                from: draft.from,
                agentPreset: draft.id,
                ...name === '' ? {} : { name },
            });
            if (!response.result.ok) {
                this.patchCopy({ saving: false, error: response.result.error.message });
                return;
            }
            this.set({ copy: null });
            await this.load();
            this.rosterChanged();
            // A preset is its files from here on (the dialog collected nothing
            // else), so landing in them is the completion, not a follow-up.
            await this.openLocation(draft.id);
        }
        catch (error) {
            this.patchCopy({ saving: false, error: messageOf(error) });
        }
    }
    /**
     * Open one preset's directory on the host desktop, or reveal its path on
     * the row where the deployment has no opener to hand it to.
     * @param id - the preset whose files the user wants.
     * @returns once the host answered and the page reflects it.
     */
    async openLocation(id) {
        try {
            const response = await this.api.agentPresets.openDocument({ agentPreset: id });
            if (!response.result.ok) {
                this.set({ error: response.result.error.message });
                return;
            }
            if (response.result.value.opened)
                return;
            const { path } = response.result.value;
            this.set({ revealedPaths: { ...this.store.getSnapshot().revealedPaths, [id]: path } });
        }
        catch (error) {
            this.set({ error: messageOf(error) });
        }
    }
    /**
     * Ask for confirmation before deleting one preset.
     * @param id - the preset to delete, or null to dismiss the confirmation.
     */
    confirmDelete(id) {
        if (this.store.getSnapshot().deleting)
            return;
        this.set({ pendingDelete: id });
    }
    /**
     * Delete the preset awaiting confirmation, then re-read the roster.
     *
     * A session already composed from it keeps running: its composition was
     * mounted at creation and nothing re-reads the file.
     * @returns once the delete settled and the page reflects it.
     */
    async remove() {
        const { pendingDelete, deleting } = this.store.getSnapshot();
        if (pendingDelete === null || deleting)
            return;
        this.set({ deleting: true, error: null });
        try {
            const response = await this.api.agentPresets.remove({ agentPreset: pendingDelete });
            if (!response.result.ok) {
                this.set({ deleting: false, pendingDelete: null, error: response.result.error.message });
                return;
            }
            this.set({ deleting: false, pendingDelete: null });
            await this.load();
            this.rosterChanged();
        }
        catch (error) {
            this.set({ deleting: false, pendingDelete: null, error: messageOf(error) });
        }
    }
    /**
     * Make one preset the default for sessions created later. Running sessions
     * keep the composition they began with, so this never disturbs work.
     * @param id - the preset to make default.
     * @returns once the write settled and the roster was re-read.
     */
    async makeDefault(id) {
        const failure = await writeDefaultPreset(this.api, id);
        if (failure !== undefined) {
            this.set({ error: failure });
            return;
        }
        await this.load();
    }
}
//# sourceMappingURL=section-store.js.map