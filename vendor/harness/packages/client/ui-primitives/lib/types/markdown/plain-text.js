/**
 * Markdown-to-plain-text projection for compact summaries and labels.
 * Parsing shares the renderer's streaming GFM grammar ({@link parseGfm}), so
 * the projection strips exactly the markup the renderer would draw; raw HTML
 * stays literal, links keep their labels, images keep alt text, and code
 * keeps its source text.
 */
import { parseGfm } from "./parse.js";
function inlineText(node) {
    switch (node.type) {
        case 'text':
        case 'inlineCode':
        case 'code':
            return node.value ?? '';
        case 'image':
        case 'imageReference':
            return node.alt ?? '';
        case 'break':
            return '\n';
        case 'html':
            return node.value ?? '';
        default:
            return node.children?.map(inlineText).join('') ?? '';
    }
}
function compactInline(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function blockText(node) {
    switch (node.type) {
        case 'root':
        case 'blockquote':
            return node.children?.map(blockText).filter(Boolean).join('\n\n') ?? '';
        case 'paragraph':
        case 'heading':
            return compactInline(inlineText(node));
        case 'code':
            return node.value?.trim() ?? '';
        case 'list':
            return node.children?.map(blockText).filter(Boolean).join('\n') ?? '';
        case 'listItem':
            return node.children?.map(blockText).filter(Boolean).join(' ') ?? '';
        case 'table':
            return node.children?.map(blockText).filter(Boolean).join('\n') ?? '';
        case 'tableRow':
            return node.children?.map(blockText).join('\t') ?? '';
        case 'tableCell':
            return compactInline(inlineText(node));
        case 'html':
            return node.value ?? '';
        case 'thematicBreak':
        case 'definition':
            return '';
        default:
            return compactInline(inlineText(node));
    }
}
function findFirstParagraph(node) {
    if (node.type === 'paragraph') {
        const text = compactInline(inlineText(node));
        if (text !== '')
            return text;
    }
    for (const child of node.children ?? []) {
        const text = findFirstParagraph(child);
        if (text !== undefined)
            return text;
    }
    return undefined;
}
function fullText(root) {
    return blockText(root)
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/**
 * Parse GFM Markdown, remove its presentation markup, and preserve raw HTML literally.
 * @param markdown - Markdown source.
 * @param options - Optional extraction boundary.
 * @returns Plain text for the whole document, first visible line, or first semantic paragraph.
 */
export function extractMarkdownPlainText(markdown, options = {}) {
    const { mode = 'all' } = options;
    const root = parseGfm(markdown);
    const all = fullText(root);
    switch (mode) {
        case 'all':
            return all;
        case 'first-line':
            return all.split('\n').find(line => line !== '') ?? '';
        case 'first-paragraph':
            return findFirstParagraph(root) ?? all.split('\n').find(line => line !== '') ?? '';
    }
}
//# sourceMappingURL=plain-text.js.map