/**
 * `LocalSpillStore`: the host-filesystem implementation of the
 * `@deepseek-ai/dsh-spill` storage seam. Persists a tool's oversized text to a
 * private, session-scoped file (see `./store.ts` for the traversal-safe naming
 * and exclusive owner-only write) and returns a path locator plus local
 * read/grep retrieval guidance.
 *
 * @module @deepseek-ai/dsh-spill-local
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { SpillStore } from '@deepseek-ai/dsh-spill';
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill';
export { encodeSegment, privateRoot, saveTextFile, sessionDir } from './store.ts';
export type { SavedText, SaveTextOptions } from './store.ts';
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
    /**
     * Root directory for spill files. Omitted uses a lazily-created private
     * (0700) per-process directory under the OS temp dir — the safe default for
     * a local deployment. Set it to keep spill files under a known location.
     */
    root?: string;
}
/**
 * Local-filesystem spill backend. Files land under `<root>/session-<hash>/…`
 * with unpredictable names, an exclusive owner-only (0600) write, and a private
 * (0700) root — a spilled tool result must not be readable by other local users
 * or redirectable via a planted symlink.
 */
export declare class LocalSpillStore extends SpillStore {
    static Config: z<Config>;
    /** Resolved absolute spill root (config `root`, else the private default), fixed at construction. */
    readonly root: string;
    constructor(ctx: Context, config: Config);
    saveText(input: SaveTextSpill): Promise<SpillRef>;
}
export default LocalSpillStore;
//# sourceMappingURL=index.d.ts.map