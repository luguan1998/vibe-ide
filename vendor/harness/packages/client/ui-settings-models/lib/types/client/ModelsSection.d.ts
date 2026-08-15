/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */
import type { ReactNode } from 'react';
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react';
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts';
import type { en } from './locales.ts';
/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
    /** The page store (loaded on mount, refreshed on pushed invalidations). */
    controller: ModelsSettingsStore;
    /** uSES subscription hook bound to the store. */
    useSnapshot: SnapshotSelectorHook<ModelsSettingsState>;
    /** Wire faces the editor writes through. */
    api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>;
    /** Section copy. */
    t: (key: keyof typeof en) => string;
}
/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<ModelsSectionInjected>;
/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
    /** Stable provider route id. */
    provider: string;
    /** Human-facing provider name. */
    displayName: string;
}
/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export declare function removeProviderProfile(api: Pick<IApiClient, 'settings' | 'credentials'>, controller: ModelsSettingsStore, target: {
    settingsNs: string;
    settingsPath: readonly string[];
    credentialRef?: string;
}): Promise<string | undefined>;
/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export declare function needsSetup(row: ProviderRow, anyUsable: boolean): boolean;
/** Stable visible and accessible identity for one provider target. */
export declare function providerTargetLabel(target: ProviderIdentity): string;
/** Replace the one provider placeholder in localized destructive-action copy. */
export declare function providerCopy(template: string, target: ProviderIdentity): string;
/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export declare function ModelsSection(props: ModelsSectionProps): ReactNode;
//# sourceMappingURL=ModelsSection.d.ts.map