import type { ExactMatch, MenuReduce, MenuState } from './contract.ts';
/** Closed rest state with generation 0; store initializer and test seed. */
export declare const MENU_CLOSED: MenuState;
/**
 * Replace the group roster with pending groups for `sources`, in order.
 * Shell-side step before dispatching `hit` on a fresh menu open.
 *
 * @param state - Current menu state.
 * @param sources - Source names registered for the hit trigger, menu order.
 * @returns State carrying the new pending roster; highlight cleared.
 */
export declare function seedGroups(state: MenuState, sources: readonly string[]): MenuState;
/**
 * Pure menu reducer. `hit` opens a new generation over the seeded roster
 * (null hit closes); `source-settled` outside the current generation, the
 * open menu, or the roster is dropped; a settlement or failure leaving every
 * group ready-and-empty (or no groups) auto-closes; `source-failed` silently
 * removes the group (the shell logs); `move` cycles the highlight across
 * ready items.
 *
 * @param state - Current menu state.
 * @param ev - Menu event.
 * @returns Next state; the same reference when stale or a no-op.
 */
export declare const menuReduce: MenuReduce;
/**
 * Exact-name lookup in one source's ready group.
 *
 * @param groups - Menu groups.
 * @param source - Source (group) name.
 * @param name - Candidate name to match exactly.
 * @returns The candidate, or null when the group is absent, not ready, or
 * has no candidate of that name.
 */
export declare const exactMatch: ExactMatch;
//# sourceMappingURL=menu.d.ts.map