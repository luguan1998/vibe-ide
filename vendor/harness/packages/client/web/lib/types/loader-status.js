/**
 * Value mirror of cordis's `FiberState` const enum: a const enum has no
 * runtime object to import (and esbuild-based pipelines cannot inline it
 * across modules), so these values mirror the pinned vendored definition
 * while retaining its type (same rationale as dsh-tool-cordis's mirror).
 */
export const FIBER_STATE = {
    PENDING: 0,
    LOADING: 1,
    ACTIVE: 2,
    FAILED: 3,
    DISPOSED: 4,
    UNLOADING: 5,
};
/** Label for each fiber state, keyed by member (inlining-safe — no reverse mapping). */
export const STATE_LABELS = {
    [FIBER_STATE.PENDING]: 'pending',
    [FIBER_STATE.LOADING]: 'loading',
    [FIBER_STATE.ACTIVE]: 'active',
    [FIBER_STATE.FAILED]: 'failed',
    [FIBER_STATE.DISPOSED]: 'disposed',
    [FIBER_STATE.UNLOADING]: 'unloading',
};
/**
 * Create a writable kernel signal.
 * @param init - initial value.
 * @returns the signal.
 */
export function createSignal(init) {
    let value = init;
    const listeners = new Set();
    return {
        getSnapshot: () => value,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        set: (next) => {
            value = next;
            for (const fn of [...listeners])
                fn();
        },
    };
}
/**
 * Create the boot status store.
 * @returns the store (empty until the boot chain projects rows).
 */
export function createLoaderStatusStore() {
    let value = {};
    const listeners = new Set();
    return {
        getSnapshot: () => value,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        set: (id, state) => {
            value = { ...value, [id]: state };
            for (const fn of [...listeners])
                fn();
        },
    };
}
//# sourceMappingURL=loader-status.js.map