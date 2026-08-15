/**
 * Subagent reference plugin, browser half: registers the '@' source —
 * candidates filtered from the session list snapshot's running children
 * (zero RPC; the list rides the plugin's root-context sessions service, the
 * scoped session comes from the per-call projection), pick inserts the
 * literal `@label ` text (plain-text-reference decision, see
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md:
 * the draft carries plain text, chip
 * visuals are derived by scanning against the source lexicon, and the
 * prompt ships the same literal). Consumption semantics stay with future
 * business work. No adjudication hooks: subagent
 * references never enter command adjudication.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type SubagentKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Subagent catalog and read-only composer copy. */
        'subagent': SubagentKey;
    }
}
export type { SubagentCatalogActionProps, SubagentCatalogInjected, } from './SubagentCatalogAction.tsx';
export type { SubagentReadOnlyComposerProps, SubagentReadOnlyMatch, } from './SubagentReadOnlyComposer.tsx';
/** Required services for references, conversation slots, and session navigation. */
export declare const inject: string[];
/**
 * Client plugin body: register the '@' subagent source over the root session list.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map