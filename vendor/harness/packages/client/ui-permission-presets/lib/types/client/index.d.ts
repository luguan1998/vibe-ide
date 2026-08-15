import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export type { PermissionRowInjected, PermissionRowProps } from './PermissionRow.tsx';
export type { PermissionDefaultOption, PermissionSettingsState, } from './settings-store.ts';
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Client plugin body: register the /permission popup picker over the
 * permissions projection.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map