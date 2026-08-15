/**
 * `LocalSpillStore`: the host-filesystem implementation of the
 * `@deepseek-ai/dsh-spill` storage seam. Persists a tool's oversized text to a
 * private, session-scoped file (see `./store.ts` for the traversal-safe naming
 * and exclusive owner-only write) and returns a path locator plus local
 * read/grep retrieval guidance.
 *
 * @module @deepseek-ai/dsh-spill-local
 */
import { resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill';
import { privateRoot, saveTextFile } from "./store.js";
export { encodeSegment, privateRoot, saveTextFile, sessionDir } from "./store.js";
/**
 * Local-filesystem spill backend. Files land under `<root>/session-<hash>/…`
 * with unpredictable names, an exclusive owner-only (0600) write, and a private
 * (0700) root — a spilled tool result must not be readable by other local users
 * or redirectable via a planted symlink.
 */
export class LocalSpillStore extends SpillStore {
    static Config = z.object({
        root: z.string(),
    });
    /** Resolved absolute spill root (config `root`, else the private default), fixed at construction. */
    root;
    constructor(ctx, config) {
        super(ctx);
        this.root = config.root !== undefined ? resolve(config.root) : privateRoot();
    }
    async saveText(input) {
        const saved = await saveTextFile({
            root: this.root,
            sessionId: input.owner.sessionId,
            suggestedName: input.suggestedName,
            content: input.content,
        });
        return {
            locator: SpillLocator(saved.path),
            bytes: saved.bytes,
            retrievalHint: 'Use read with offset/limit, or grep this path to search within it.',
        };
    }
}
export default LocalSpillStore;
//# sourceMappingURL=index.js.map