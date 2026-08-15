import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Untrusted assistant-Markdown renderer over the direct mdast pipeline:
 * `parse.ts` grammars, the incremental streaming parser, and `render.tsx`.
 * While a message streams, all but the trailing two blocks freeze as cached
 * React elements and only the source tail behind them re-parses per chunk,
 * so per-chunk work tracks the tail size instead of the whole reply. Frozen
 * blocks keep their source-offset keys when they cross the freeze boundary,
 * so React reconciles instead of remounting. Known deviation while
 * streaming: a reference-style link or footnote whose definition sits on the
 * other side of the freeze boundary renders literally until the settled
 * full parse self-heals it.
 */
import { memo, useMemo, useRef } from 'react';
import { IncrementalMarkdownParser } from "./incremental.js";
import { parseGfm, parseGfmWithMath } from "./parse.js";
import { collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection, wrapBlockChildren, } from "./render.js";
import 'katex/dist/katex.min.css';
import css from './MarkdownText.module.css';
/** One settled full render: parse with math, resolve references, append the footnote section. */
function renderSettled(text, codeLabels, fileMentions) {
    const root = parseGfmWithMath(text);
    const targets = createReferenceTargets();
    collectReferenceTargets(root.children, targets);
    const context = {
        streaming: false,
        codeLabels,
        fileMentions,
        targets,
        footnoteOrder: [],
        footnoteCounts: new Map(),
    };
    const blocks = wrapBlockChildren(renderBlocks(root.children.map((node, index) => ({ node, key: index })), context), false);
    const section = renderFootnoteSection(context);
    return section === null ? blocks : [...blocks, '\n', section];
}
/**
 * Streaming render state for one growing message: the incremental parser,
 * the frozen blocks' cached elements, and the reference/footnote state their
 * rendering consumed (footnote numbering assigned to frozen references is
 * final, so the tail continues from a copy of it each frame).
 */
class StreamingRenderer {
    codeLabels;
    parser = new IncrementalMarkdownParser(parseGfm);
    generation = -1;
    frozenCount = 0;
    frozenElements = [];
    frozenTargets = createReferenceTargets();
    frozenFootnoteOrder = [];
    frozenFootnoteCounts = new Map();
    lastText = null;
    lastRendered = [];
    /** @param codeLabels - Fence copy labels baked into cached elements; the owner replaces the renderer when they change. */
    constructor(codeLabels) {
        this.codeLabels = codeLabels;
    }
    /**
     * Render the current accumulated text. Idempotent per text value, so React
     * may re-execute the calling render freely.
     * @param text - The full accumulated markdown source.
     * @returns Frozen elements, re-rendered tail, and the footnote section.
     */
    render(text) {
        if (text === this.lastText)
            return this.lastRendered;
        const { frozen, tail, generation } = this.parser.update(text);
        if (generation !== this.generation) {
            this.generation = generation;
            this.frozenCount = 0;
            this.frozenElements = [];
            this.frozenTargets = createReferenceTargets();
            this.frozenFootnoteOrder = [];
            this.frozenFootnoteCounts = new Map();
        }
        const newlyFrozen = frozen.slice(this.frozenCount);
        collectReferenceTargets(newlyFrozen.map(block => block.node), this.frozenTargets);
        // Targets visible this frame: everything frozen so far plus the current
        // tail parse — a newly frozen block's references resolved against the
        // same parse tree its definitions came from.
        const frameTargets = {
            definitions: new Map(this.frozenTargets.definitions),
            footnotes: new Map(this.frozenTargets.footnotes),
        };
        collectReferenceTargets(tail.map(block => block.node), frameTargets);
        if (newlyFrozen.length > 0) {
            const frozenContext = {
                streaming: true,
                codeLabels: this.codeLabels,
                fileMentions: undefined,
                targets: frameTargets,
                footnoteOrder: this.frozenFootnoteOrder,
                footnoteCounts: this.frozenFootnoteCounts,
            };
            // Separator newlines are cached alongside the elements so the
            // assembled children match the settled pipeline's block wrapping.
            const batch = [...this.frozenElements];
            for (const element of renderBlocks(newlyFrozen, frozenContext)) {
                if (batch.length > 0)
                    batch.push('\n');
                batch.push(element);
            }
            this.frozenElements = batch;
            this.frozenCount = frozen.length;
        }
        const tailContext = {
            streaming: true,
            codeLabels: this.codeLabels,
            fileMentions: undefined,
            targets: frameTargets,
            footnoteOrder: [...this.frozenFootnoteOrder],
            footnoteCounts: new Map(this.frozenFootnoteCounts),
        };
        const children = [...this.frozenElements];
        for (const element of renderBlocks(tail, tailContext)) {
            if (children.length > 0)
                children.push('\n');
            children.push(element);
        }
        const section = renderFootnoteSection(tailContext);
        if (section !== null)
            children.push('\n', section);
        this.lastText = text;
        this.lastRendered = children;
        return this.lastRendered;
    }
}
/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` renders fences and TeX plain (highlighting and KaTeX land on
 * the finalize swap) and parses incrementally across chunks; `codeLabels`
 * forwards localized copy-button labels to fence CodeBlocks — pass a
 * reference-stable object (memoized per locale revision), because a new
 * identity discards the streaming render cache mid-message. `fileMentions`
 * links inline-code tokens its resolver recognizes as real files; this is
 * the single streaming gate — it applies to settled renders only, because a
 * streaming message's vocabulary is not final and frozen cached elements
 * must not bake in handlers that could go stale.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML,
 * relative links, and unsafe protocols are disabled, while absolute HTTP(S)
 * images render directly.
 */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, codeLabels, fileMentions }) {
    const streamRef = useRef(null);
    const streamLabelsRef = useRef(codeLabels);
    const children = useMemo(() => {
        if (!streaming) {
            streamRef.current = null;
            return renderSettled(text, codeLabels, fileMentions);
        }
        if (streamRef.current === null || streamLabelsRef.current !== codeLabels) {
            streamRef.current = new StreamingRenderer(codeLabels);
            streamLabelsRef.current = codeLabels;
        }
        return streamRef.current.render(text);
    }, [text, streaming, codeLabels, fileMentions]);
    return _jsx("div", { className: css.markdown, children: children });
});
//# sourceMappingURL=MarkdownText.js.map