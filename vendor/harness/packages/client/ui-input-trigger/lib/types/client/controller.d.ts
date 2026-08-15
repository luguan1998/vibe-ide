/**
 * InputTriggerController: the per-session half of the trigger pipeline. Owns every
 * piece of mutable interaction state — the authoritative trigger hit (span
 * included; it outlives menu close for space adjudication), the menu store,
 * and the candidate-fetch lifecycle — and executes pick outcomes by
 * dispatching the scoped input-mutation events. The root InputTriggerService keeps
 * only the source roster. One controller per session scope; the service
 * disposes it with the scope fiber.
 */
import type { ClientContext, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { MenuState, TriggerHit } from '../core/contract.ts';
import type { ArbitrateKey, ArbitrateOutcome, PickOutcome, InputTriggerSource, TriggerChar, TriggerGuard } from '../types.ts';
/** Roster access the controller borrows from the root service (registration order preserved). */
export interface SourceRoster {
    sources(trigger: string): readonly InputTriggerSource[];
    all(): readonly InputTriggerSource[];
}
/** Construction hooks for one controller. */
export interface InputTriggerControllerDeps {
    /** The owning session scope (event dispatch + teardown registration site). */
    actx: ClientContext;
    /** The session's stable host identity (the projection handed to sources). */
    sessionId: SessionId;
    /** Root-service roster view. */
    roster: SourceRoster;
}
/**
 * Per-session trigger pipeline state and orchestration. All mutation stays
 * inside; MenuView renders from {@link InputTriggerController.menu} and routes
 * pointer picks back through {@link InputTriggerController.pick}.
 */
export declare class InputTriggerController {
    private readonly deps;
    /** Menu state store (per-session; survives session switches, dies with the scope). */
    readonly menu: SnapshotStore<MenuState>;
    /**
     * Name of the source opened through the programmatic launcher, or null for
     * trigger-detected/closed menus. Composer chrome subscribes to this store
     * for the launcher's expanded state without owning a second menu model.
     */
    readonly launcher: SnapshotStore<string | null>;
    /**
     * Aggregated hot reference lexicon, grouped by trigger (plain-text-reference decision;
     * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
     * sources implementing the lexicon hook are polled with the session
     * projection; undefined answers (roll not hot yet) are skipped; multiple
     * sources on one trigger concatenate in registration order. A snapshot
     * store because rolls change asynchronously (catalog settles, children
     * spawn/exit) — render-side consumers subscribe instead of re-reading a
     * mutable answer.
     */
    readonly lexicon: SnapshotStore<ReadonlyMap<TriggerChar, readonly string[]>>;
    /** The authoritative hit: single truth for span CAS material (menu snapshot never carries it alone). */
    private hit;
    private fetch;
    private disposed;
    /** Per-source lexicon unsubscribers (sources without the hook never enter). */
    private readonly lexiconOffs;
    constructor(deps: InputTriggerControllerDeps);
    /**
     * Feed a draft/caret change through trigger detection and drive the menu.
     * @param draft - full draft text.
     * @param caret - caret offset into `draft`.
     * @param guard - availability tier derived from the input phase.
     * @param draftRev - the input machine's current draft revision, stamped
     * into the hit span for pick-time CAS.
     */
    track(draft: string, caret: number, guard: TriggerGuard, draftRev: number): void;
    /**
     * Toggle a menu containing exactly one registered source. The supplied hit
     * is a synthetic selection span rather than a typed trigger token, but
     * picks deliberately reuse the ordinary source callback and scoped input
     * mutation pipeline.
     * @param source - registered source name under `hit.trigger`.
     * @param hit - synthetic hit carrying position and pick-time draft CAS.
     */
    toggleSource(source: string, hit: TriggerHit): void;
    /**
     * Pointer pick from MenuView: route the clicked candidate through onPick
     * and execute claim/insert outcomes via the scoped input events.
     * @param source - source (group) name.
     * @param index - candidate index within the group.
     */
    pick(source: string, index: number): void;
    /**
     * Keyboard arbitration while the menu is open.
     * @param key - intercepted key.
     * @param composing - inside IME composition: everything passes.
     * @returns consumed / pick-highlighted / pass.
     */
    arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome;
    /**
     * Space adjudication over the just-completed leading token: polls sources'
     * matchSpace (hot state, synchronous) and dispatches the outcome itself.
     * @returns true when a claim/insert was actually applied by the input —
     * the caller preventDefaults exactly then.
     */
    onSpace(): boolean;
    /**
     * Serialize one reference occurrence to its model form via the owning
     * source's codec (prompt serialization: registry → explicit
     * call → await). Owner missing or codec-less rejects — the submit attempt
     * blocks instead of silently downgrading to the clipboard text.
     * @param source - owning source name.
     * @param ref - owner-scoped reference id.
     * @param signal - the submit attempt's abort signal.
     * @returns the model representation (e.g. `<skill>name</skill>`).
     */
    serializeReference(source: string, ref: string, signal: AbortSignal): Promise<string>;
    /**
     * Enter last adjudication: polls sources' matchEnter in registration
     * order, first non-undefined wins. The outcome returns to the caller (the
     * input machine applies it inside the same submit attempt — no event).
     * @param line - trimmed draft; the leading char selects the trigger roster.
     * @param signal - attempt-scoped abort from the input machine.
     * @returns the winning outcome or undefined (default sink). Rejects when a
     * polled source's warmup fails — the caller must not silently downgrade.
     */
    adjudicate(line: string, signal: AbortSignal): Promise<PickOutcome>;
    /**
     * Drop the menu group of a disposed source (root registry change notification).
     * @param source - the source whose registration was disposed.
     */
    sourceRemoved(source: InputTriggerSource): void;
    /**
     * Admit a source registered after this controller's birth (root registry
     * change notification): warm it and fold its roll into the live lexicon —
     * the constructor-time prewarm covers only the roster present at scope
     * birth.
     * @param source - the newly registered source.
     */
    sourceAdded(source: InputTriggerSource): void;
    /** External dismiss (e.g. pointer outside the composer area). */
    dismiss(): void;
    /** Scope teardown: close and abort (the service deletes the map entry). */
    dispose(): void;
    /** The session projection handed to sources (agent-backed identity; constant per scope). */
    private project;
    /** Execute a claim/insert/text outcome via the scoped input events (actx as dispatch subject); true = the input applied it. */
    private execute;
    /** Re-poll every lexicon-bearing source and publish the aggregated rolls (see the store doc). */
    private refreshLexicon;
    /** Wire one source's lexicon invalidation channel into refresh (hookless or roll-less sources never notify). */
    private watchLexicon;
    /** Launch the candidate fetch for one hit generation, superseding the previous one. */
    private fetchCandidates;
    private stopFetch;
    private clearLauncher;
    private reduce;
}
//# sourceMappingURL=controller.d.ts.map