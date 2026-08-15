/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * The new-session screen has no session, so a pick is staged rather than
 * applied. It reaches a session when one becomes current and is still blank —
 * whether the workspace connect created it or reused an existing blank one,
 * which is why staging cannot simply ride along on `sessions.create`.
 *
 * The stage is forgotten once applied: the next new session starts from the
 * deployment default again, matching the workspace picker beside it.
 */
import { createSnapshotStore, } from '@deepseek-ai/dsh-client-runtime/client';
import { messageOf, presetOptions } from "./settings-store.js";
const INITIAL = {
    options: [], current: '', error: null, busy: false, introduce: false,
};
/** Stages the next session's preset and applies it when one appears. */
export class AgentPresetSeatController {
    api;
    currentSession;
    onApplied;
    /** Chip snapshot the renderer subscribes to. */
    store = createSnapshotStore(INITIAL);
    /**
     * The deployment default, so a consumed stage can fall back to it without
     * re-reading the roster.
     */
    fallback = '';
    /** Set while a pick is waiting for a session; cleared once applied. */
    staged;
    constructor(api, 
    /** The session the hero is about to hand over to, when there is one. */
    currentSession, 
    /**
     * Publish an applied switch into the session list, so the header label
     * moves with the composition instead of waiting for the next full list
     * refresh. Optional: a harness that renders no list omits it.
     */
    onApplied) {
        this.api = api;
        this.currentSession = currentSession;
        this.onApplied = onApplied;
    }
    set(patch) {
        this.store.set({ ...this.store.getSnapshot(), ...patch });
    }
    /**
     * Read the roster and open the chip on the deployment default.
     * @returns once the snapshot reflects the host.
     */
    async load() {
        try {
            const response = await this.api.agentPresets.list({});
            if (!response.result.ok) {
                this.set({ error: response.result.error.message });
                return;
            }
            const { presets } = response.result.value;
            this.fallback = presets.find(preset => preset.isDefault)?.id ?? presets[0]?.id ?? '';
            this.set({
                options: presetOptions(presets),
                // Staged pick first, then the composition the current session
                // already carries, then the deployment default. The middle term is
                // what keeps a late-landing load from regressing the display after
                // an applied stage was consumed — the chip mounts (and loads) only
                // once the flow's session is current, so the reply can arrive after
                // apply() already composed it.
                current: this.staged ?? this.currentSession()?.agentPreset ?? this.fallback,
                error: null,
            });
        }
        catch (error) {
            this.set({ error: messageOf(error) });
        }
    }
    /**
     * Stage one preset for the next session, applying it immediately when a
     * blank session is already current.
     * @param id - the preset to stage.
     * @returns once the stage settled, and the apply too when one happened.
     */
    async select(id) {
        if (this.store.getSnapshot().busy)
            return;
        this.stage(id);
        await this.apply();
    }
    /**
     * Stage a pick WITHOUT the immediate apply, for a flow that starts the
     * receiving session after the pick (the settings section's creator entry).
     * `select()`'s immediate apply would meet the still-current running session
     * and drop the stage as unservable; staging alone leaves it for the
     * list-change applier, which fires when the started session becomes
     * current.
     * @param id - the preset to stage.
     * @param introduce - true when the stage came from another screen and the
     * chip should announce itself on the session it lands on.
     */
    stage(id, introduce = false) {
        this.staged = id;
        this.set({ current: id, error: null, introduce });
    }
    /** Acknowledge the introduction cue once the chip has played it. */
    introduced() {
        if (!this.store.getSnapshot().introduce)
            return;
        this.set({ introduce: false });
    }
    /**
     * Hand the staged choice to the current session, if there is one to take it.
     *
     * Called both by `select()` and by whoever observes the current session
     * changing, because the session may appear either before or after the pick.
     * @returns once the switch settled, or immediately when there is nothing to do.
     */
    async apply() {
        const staged = this.staged;
        const session = this.currentSession();
        if (staged === undefined || session === undefined)
            return;
        // A started session's history was produced under its own composition; the
        // host refuses the swap, so the stage is no longer meaningful.
        if (!session.blank || session.agentPreset === staged) {
            this.staged = undefined;
            return;
        }
        this.set({ busy: true, error: null });
        try {
            const response = await this.api.agentPresets.select({ sessionId: session.id, agentPreset: staged });
            this.staged = undefined;
            if (!response.result.ok) {
                this.set({ busy: false, error: response.result.error.message, current: this.fallback });
                return;
            }
            // Consumed: the next new session opens on the deployment default again.
            this.set({ busy: false, current: response.result.value.agentPreset });
            this.onApplied?.(session.id, response.result.value.agentPreset);
        }
        catch (error) {
            this.staged = undefined;
            this.set({ busy: false, error: messageOf(error), current: this.fallback });
        }
    }
}
//# sourceMappingURL=seat-store.js.map