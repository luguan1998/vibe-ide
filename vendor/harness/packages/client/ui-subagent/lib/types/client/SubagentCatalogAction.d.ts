import { type SessionId, type SubagentAddress } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
/** Business actions supplied by the slot registration. */
export interface SubagentCatalogInjected {
    openChild: (address: SubagentAddress) => void;
    refresh: (parentSessionId: SessionId) => void;
    setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void;
}
/** Full props for the session-header catalog action. */
export type SubagentCatalogActionProps = PropsRuntime<'conversation.session.header.actions'> & SubagentCatalogInjected & PropsLocale<typeof NS>;
/**
 * Render the current session's direct catalog and lazily expanded descendants.
 * @param props - session standard props plus catalog navigation actions.
 * @returns The action while the catalog is pending or summaries establish descendants.
 */
export declare function SubagentCatalogAction({ sessionId, useSessions, openChild, refresh, setCatalogOpen, t, }: SubagentCatalogActionProps): import("react").JSX.Element | null;
//# sourceMappingURL=SubagentCatalogAction.d.ts.map