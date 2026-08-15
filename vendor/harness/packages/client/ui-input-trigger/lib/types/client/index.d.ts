import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type MenuKey } from './locales.ts';
export { InputTriggerService } from './service.ts';
export { InputTriggerController } from './controller.ts';
export type { InputTriggerControllerDeps, SourceRoster } from './controller.ts';
export type { MenuViewInjected } from './slots.ts';
export type { MenuViewProps } from './MenuView.tsx';
export type { MenuKey } from './locales.ts';
export type { ArbitrateKey, ArbitrateOutcome, BeginCommandRequest, CandidateRequest, ClientSessionContext, CommandClaim, ConsumeTokenRequest, InsertReferenceRequest, PickOutcome, PickVia, ReferenceCodec, ReferenceInsert, InputTriggerCandidate, InputTriggerPick, InputTriggerSource, SubmitOutcome, TokenSpan, TriggerChar, TriggerGuard, TriggerPosition, } from '../types.ts';
export type { DetectTrigger, ExactMatch, MenuEvent, MenuReduce, MenuState, TriggerHit } from '../core/contract.ts';
export type { InputTriggerServiceContract } from './contract.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** The outward face only; the concrete service stays inside this plugin. */
        inputTriggers: import('./contract.ts').InputTriggerServiceContract;
    }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The candidate menu's copy: group titles keyed by source name, the pending row, and the listbox aria. */
        'slash.menu': MenuKey;
    }
}
/** Required services: controller resolution reads the session scope tree; the menu copy is localized. */
export declare const inject: string[];
/**
 * Client plugin body: mount the service, then register MenuView into the
 * input overlay once its declarer is up.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map