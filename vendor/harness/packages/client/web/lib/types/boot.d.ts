import { type ClientModuleSystemOptions } from '@deepseek-ai/dsh-client-modules/client';
import './base.css';
/** Module transport hook the shell passes through (jsdom tests replace the <script> path). */
export type BootSeams = Pick<ClientModuleSystemOptions, 'loadBundle'>;
/**
 * The web shell kernel: mounts the loading page into a DOM element and runs
 * the two-stage boot over the host graph. Fields hold only what must exist
 * before cordis does — the parsed manifest, the module system, and the
 * loading-page UI handles; everything else lives in plugins.
 */
export declare class AppWebEntry {
    private readonly el;
    private readonly seams;
    private readonly status;
    private readonly settled;
    private readonly error;
    private ctx;
    private modules;
    private manifest;
    private root;
    /**
     * Hold the mount point; all work happens in {@link run}.
     * @param el - mount point (the app's #root).
     * @param seams - Optional module transport overrides for test environments.
     */
    constructor(el: HTMLElement, seams?: BootSeams);
    /**
     * Run the boot chain to settlement. Boot-chain failures resolve (not
     * reject): the loading page stays up and renders the failure report (the
     * fail-loud surface the kernel owns). Rejects only when the boot manifest
     * is missing or malformed — there is nothing to boot against.
     * @returns resolves once the UI settled or the failure report rendered.
     */
    run(): Promise<void>;
    /** Unmount the shell (loading page or settled UI). */
    dispose(): void;
    /** Prefetch the immediately tier (factory registration only; failures defer to the import path). */
    private prefetchImmediateTier;
    /** Plugin face: mount the Loader, inject the `internal` contract, adopt modules, create the graph entries, settle, sweep. */
    private runPluginBoot;
    /**
     * Sweep every loader entry after the tree quiesced: an entry without a
     * fiber failed its import; a fiber not ACTIVE is FAILED (apply threw) or
     * PENDING (a required service never arrived — cordis inject waiting has no
     * timeout, so this sweep is the fail-loud compensation).
     */
    private assertEntriesActive;
}
//# sourceMappingURL=boot.d.ts.map