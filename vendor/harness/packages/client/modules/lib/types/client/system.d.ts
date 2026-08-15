/**
 * ClientModuleSystem — the implementation behind the {@link ClientModuleLoader}
 * contract. The conceptual contract (lazy CJS model, resolution branch order) is
 * documented on the public interfaces in `./manifest.ts`; this file owns the
 * state tables and the load/materialize machinery.
 */
import type { ClientModuleLoader, ClientModuleRecord, ClientModuleSystemOptions } from './manifest.ts';
/**
 * The client module system: state tables plus the arrival/materialization
 * machinery implementing {@link ClientModuleLoader} (whose members carry the
 * contract documentation). Construction indexes the boot rows and installs the
 * `window.__ModuleLoader__` registration sink — once per page.
 */
export declare class ClientModuleSystem implements ClientModuleLoader {
    readonly version = "client";
    readonly loadCache: Map<string, ClientModuleRecord>;
    private readonly seed;
    private readonly statics;
    private readonly factories;
    /** In-flight prefetch (script load) per id; concurrent callers share it. */
    private readonly pendingArrival;
    /** Materialization re-entrancy guard: factory-form CJS cannot deliver partial exports, so a cycle is fatal. */
    private readonly materializing;
    private readonly graphRows;
    private readonly loadBundle;
    /**
     * Build the module system over the parsed boot rows.
     * @param options - Module rows, module-table staticModules, and bundle-load hook.
     */
    constructor(options: ClientModuleSystemOptions);
    /** Load one graph row so its factory is registered (idempotent per in-flight arrival). */
    private arrive;
    /** Materialize a registered factory (synchronous; memoized in loadCache). */
    private materialize;
    /**
     * The synchronous require answered to factories: seed → static → memoized
     * record → registered factory (recursive materialization — this is what
     * makes load order self-resolving). Fetching is async and therefore
     * unreachable from here; an unregistered plugin specifier is loud (and a
     * cross-plugin value import is already a build error upstream).
     */
    private makeRequire;
    import(specifier: string): Promise<unknown>;
    registerStatic(id: string, module: unknown): void;
    prefetch(id: string): Promise<void>;
    invalidate(id: string): void;
}
//# sourceMappingURL=system.d.ts.map