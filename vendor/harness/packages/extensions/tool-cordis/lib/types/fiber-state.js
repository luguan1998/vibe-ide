/**
 * Runtime mirror and labels for Cordis's `FiberState` const enum. A const enum has no runtime
 * object to import, so these values mirror the pinned vendored definition while retaining its
 * type.
 * @module @deepseek-ai/dsh-tool-cordis/fiber-state
 */
/** Value mirror of the cordis `FiberState` const enum (see the module doc for why a mirror exists). */
export const FiberState = {
    PENDING: 0,
    LOADING: 1,
    ACTIVE: 2,
    FAILED: 3,
    DISPOSED: 4,
    UNLOADING: 5,
};
/** Human-readable label for each {@link FiberState}, keyed by member (inlining-safe — no reverse mapping). */
export const STATE_LABELS = {
    [FiberState.PENDING]: 'pending',
    [FiberState.LOADING]: 'loading',
    [FiberState.ACTIVE]: 'active',
    [FiberState.FAILED]: 'failed',
    [FiberState.DISPOSED]: 'disposed',
    [FiberState.UNLOADING]: 'unloading',
};
//# sourceMappingURL=fiber-state.js.map