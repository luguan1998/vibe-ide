/**
 * Durable pi-ai replay metadata and assistant-history reconstruction.
 *
 * Harness content remains the durable source for text and tool calls. This
 * module stores only the provider-native metadata needed to reconstruct a
 * pi-ai assistant message on a later request.
 *
 * @module dsh-llm-pi-ai/replay
 */
import type { Message } from '@deepseek-ai/dsh-llm';
import type { Api, AssistantMessage } from '@earendil-works/pi-ai';
type PiAiReplayBlock = {
    type: 'text';
    textSignature?: string;
} | {
    type: 'reasoning';
    thinkingSignature?: string;
    redacted?: boolean;
} | {
    type: 'tool-call';
    thoughtSignature?: string;
};
/** Versioned adapter-private projection required to replay a pi-ai response. */
export interface PiAiReplayState {
    kind: 'pi-ai';
    version: 1;
    api: Api;
    provider: string;
    model: string;
    responseModel?: string;
    responseId?: string;
    stopReason: AssistantMessage['stopReason'];
    blocks: PiAiReplayBlock[];
}
/**
 * Project a successful pi-ai response into the minimal durable replay state.
 * @param message - completed native pi-ai assistant response.
 * @returns the versioned lossless-JSON replay projection.
 */
export declare function toPiReplayState(message: AssistantMessage): PiAiReplayState;
/**
 * Convert one durable Harness assistant message into pi-ai history.
 * @param message - assistant content with required source and optional adapter-owned replay metadata.
 * @returns a native pi-ai assistant message reconstructed from durable content.
 */
export declare function toPiAssistant(message: Message): AssistantMessage;
export {};
//# sourceMappingURL=replay.d.ts.map