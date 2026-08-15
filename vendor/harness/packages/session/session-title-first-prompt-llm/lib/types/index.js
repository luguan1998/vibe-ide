/** First-human-message model provider for `ctx.sessionTitle`. */
import z from '@deepseek-ai/schemastery';
import { registerSessionTitleLlmProvider, SessionTitleLlmConfigFields, } from '@deepseek-ai/dsh-session-title-llm';
export const name = 'session-title-first-prompt-llm';
export const inject = ['sessionTitle', 'llm', 'sessions'];
/** Loader schema shared with the all-messages provider. */
/* jscpd:ignore-start -- Loader requires each plugin to export its own statically walkable schema; the field validators remain shared. */
export const Config = z.object({
    targetWords: SessionTitleLlmConfigFields.targetWords,
    targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
    maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
    maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
    timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
    provider: SessionTitleLlmConfigFields.provider,
    model: SessionTitleLlmConfigFields.model,
});
/* jscpd:ignore-end */
/**
 * Register the first-prompt model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx, config) {
    registerSessionTitleLlmProvider(ctx, config, name, 'first-prompt', (messages) => {
        const first = messages[0];
        if (first === undefined)
            throw new Error('first-prompt title provider requires one human message');
        return [first];
    });
}
//# sourceMappingURL=index.js.map