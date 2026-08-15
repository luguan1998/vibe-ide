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
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client';
import { type SessionId, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { AgentPresetOption } from './settings-store.ts';
/** Hero-chip snapshot. */
export interface AgentPresetSeatState {
    /** Presets the deployment supplies; empty means the chip renders nothing. */
    options: readonly AgentPresetOption[];
    /** The staged choice, empty until the roster loads. */
    current: string;
    /** A rejected apply's message, cleared by the next attempt. */
    error: string | null;
    busy: boolean;
    /**
     * One-shot cue that the chip should introduce itself (the creator-draft
     * entry staged the pick from another screen, so the user never touched the
     * chip); the renderer clears it via `introduced()` once played.
     */
    introduce: boolean;
}
/** One session's identity and whether it has started. */
export interface SeatSessionSummary {
    /** The session the chip would apply its staged choice to. */
    id: SessionId;
    /** False once a turn has run — applying is refused from then on. */
    blank: boolean;
    /** The preset the session already runs, when the summary reports one. */
    agentPreset?: string;
}
/** Stages the next session's preset and applies it when one appears. */
export declare class AgentPresetSeatController {
    private readonly api;
    /** The session the hero is about to hand over to, when there is one. */
    private readonly currentSession;
    /**
     * Publish an applied switch into the session list, so the header label
     * moves with the composition instead of waiting for the next full list
     * refresh. Optional: a harness that renders no list omits it.
     */
    private readonly onApplied?;
    /** Chip snapshot the renderer subscribes to. */
    readonly store: SnapshotStore<AgentPresetSeatState>;
    /**
     * The deployment default, so a consumed stage can fall back to it without
     * re-reading the roster.
     */
    private fallback;
    /** Set while a pick is waiting for a session; cleared once applied. */
    private staged;
    constructor(api: Pick<IApiClient, 'agentPresets'>, 
    /** The session the hero is about to hand over to, when there is one. */
    currentSession: () => SeatSessionSummary | undefined, 
    /**
     * Publish an applied switch into the session list, so the header label
     * moves with the composition instead of waiting for the next full list
     * refresh. Optional: a harness that renders no list omits it.
     */
    onApplied?: ((sessionId: string, agentPreset: string) => void) | undefined);
    private set;
    /**
     * Read the roster and open the chip on the deployment default.
     * @returns once the snapshot reflects the host.
     */
    load(): Promise<void>;
    /**
     * Stage one preset for the next session, applying it immediately when a
     * blank session is already current.
     * @param id - the preset to stage.
     * @returns once the stage settled, and the apply too when one happened.
     */
    select(id: string): Promise<void>;
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
    stage(id: string, introduce?: boolean): void;
    /** Acknowledge the introduction cue once the chip has played it. */
    introduced(): void;
    /**
     * Hand the staged choice to the current session, if there is one to take it.
     *
     * Called both by `select()` and by whoever observes the current session
     * changing, because the session may appear either before or after the pick.
     * @returns once the switch settled, or immediately when there is nothing to do.
     */
    apply(): Promise<void>;
}
//# sourceMappingURL=seat-store.d.ts.map