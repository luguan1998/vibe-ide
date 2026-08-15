import type { ReactNode } from 'react';
import type { KernelSignal, LoaderStatus } from './loader-status.ts';
/** AppRoot props: settled signal, fiber-state projection feed, boot failure report, deferred real-UI factory. */
export interface AppRootProps {
    /** True once the boot chain settled (loader quiesced + all entries ACTIVE); the boot closure flips it. */
    settled: KernelSignal<boolean>;
    /** Per-entry fiber-state projection store (drives loading/failed rendering). */
    status: KernelSignal<LoaderStatus>;
    /** Boot failure report (the settle rejection message); undefined while loading or after success. */
    error: KernelSignal<string | undefined>;
    /** Builds the real UI; called only after settled. */
    renderApp: () => ReactNode;
}
/** Boot gate: loading page until the boot settles; failures stay here. */
export declare function AppRoot(props: AppRootProps): import("react").JSX.Element;
//# sourceMappingURL=AppRoot.d.ts.map