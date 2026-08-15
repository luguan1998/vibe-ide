/**
 * Replay-safe, model-free tool-result pruning service.
 *
 * @module @deepseek-ai/dsh-compaction-tool-result-pruner
 */
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { freezeMessage } from '@deepseek-ai/dsh-llm';
import { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from "./config.js";
export { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from "./config.js";
/** Deterministic head/middle/tail pruning for current tool-result surface nodes. */
export class ToolResultPruner extends Service {
    // The token meter prices each shadowed node for its logged shadow-price
    // event, so pruning genuinely requires the pricing capability.
    static inject = ['tokenMeter'];
    static Config = z.object({
        thresholdChars: z.number().step(1).min(1).default(DEFAULTS.thresholdChars),
        headChars: z.number().step(1).min(0).default(DEFAULTS.headChars),
        tailChars: z.number().step(1).min(0).default(DEFAULTS.tailChars),
    });
    /** Resolved and immutable character budgets. */
    config;
    constructor(ctx, config = {}) {
        super(ctx, 'toolResultPruner');
        this.config = resolveConfig(config);
    }
    /**
     * Measure text content in Unicode code points; non-text blocks cost zero.
     * @param blocks - tool-result content to measure.
     * @returns total Unicode code points across text blocks.
     */
    measureContent(blocks) {
        let chars = 0;
        for (const block of blocks) {
            if (block.type === 'text')
                chars += codePointLength(block.text);
        }
        return chars;
    }
    /**
     * Replace an over-budget text middle while retaining rich-block order.
     * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
     * boundary cannot split a surrogate pair. Grapheme clusters may still split.
     * @param blocks - original tool-result content.
     * @returns pruned content, or `null` when the text is within budget.
     */
    pruneContent(blocks) {
        const totalChars = this.measureContent(blocks);
        if (totalChars <= this.config.thresholdChars)
            return null;
        const removedStart = this.config.headChars;
        const removedEnd = totalChars - this.config.tailChars;
        const pruned = [];
        let consumed = 0;
        let markerInserted = false;
        for (const block of blocks) {
            if (block.type !== 'text') {
                pruned.push(block);
                continue;
            }
            const points = Array.from(block.text);
            const blockStart = consumed;
            const blockEnd = blockStart + points.length;
            const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart));
            const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
            const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart;
            const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : '';
            if (marker.length > 0)
                markerInserted = true;
            const text = points.slice(0, headEnd).join('')
                + marker
                + points.slice(tailStart).join('');
            if (text.length > 0)
                pruned.push({ ...block, text });
            consumed = blockEnd;
        }
        /* v8 ignore next -- totalChars > threshold and valid budgets guarantee a removed text span. */
        if (!markerInserted)
            throw new Error('tool-result prune: failed to locate the removed text span');
        const charsAfter = this.measureContent(pruned);
        /* v8 ignore next -- config validation fixes the emitted head + marker + tail budget. */
        if (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) {
            throw new Error('tool-result prune: replacement must be smaller and within threshold');
        }
        return pruned;
    }
    /**
     * Prune every over-budget tool result from one stable current-surface snapshot.
     * Each replacement preserves the complete event data except for `content`,
     * cites the shadowed node so replay can recover the replacement input, and is
     * immediately preceded by a `compaction/prune` shadow-price event pricing the
     * shadowed node through the injected token meter, so pure consumers can
     * subtract it without per-node state.
     * @param session - session whose current surface is rewritten.
     * @returns landed replacements and aggregate Unicode-code-point savings.
     * @throws when the session rejects a replacement; replacements committed
     * earlier in the pass remain durable.
     */
    pruneSession(session) {
        const candidates = [];
        for (const seq of [...session.surface.nodes]) {
            const event = session.events[seq];
            /* v8 ignore next -- surface seqs are validated contiguous log references. */
            if (event?.type === 'tool/result')
                candidates.push({ seq, event });
        }
        const pruned = [];
        let charsRemoved = 0;
        for (const { seq, event } of candidates) {
            const result = event.data.message.content[0];
            const content = this.pruneContent(result.content);
            if (content === null)
                continue;
            const charsBefore = this.measureContent(result.content);
            const charsAfter = this.measureContent(content);
            const message = freezeMessage({
                ...event.data.message,
                content: [{
                        ...result,
                        content,
                    }],
            });
            // Shadow-price protocol: the metering event and its replacement are
            // appended synchronously adjacent, so pure consumers subtract the
            // shadowed node's heuristic price without retaining per-node state.
            session.append('compaction/prune', {
                shadowedRange: { start: seq, end: seq },
                shadowedSeqs: [seq],
                shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(event.data.message),
            });
            const replacement = session.append('tool/result', {
                ...event.data,
                message,
            }, {
                surfaceOp: { op: 'replace', start: seq, end: seq },
                sourceEventSeqs: [seq],
            });
            pruned.push({
                originalSeq: seq,
                replacementSeq: replacement.seq,
                callId: event.data.message.source.callId,
                charsBefore,
                charsAfter,
            });
            charsRemoved += charsBefore - charsAfter;
        }
        return { pruned, charsRemoved };
    }
}
export default ToolResultPruner;
//# sourceMappingURL=index.js.map