/** Replay-stable view models for Cordis lifecycle Tool calls. */
function firstLine(text) {
    const newline = text.indexOf('\n');
    return newline === -1 ? text : text.slice(0, newline);
}
function stringAt(source, key) {
    const value = source[key];
    return typeof value === 'string' && value !== '' ? value : null;
}
function objectAt(source, key) {
    const value = source[key];
    return typeof value === 'object' && value !== null ? value : null;
}
function parseArgs(argsRaw) {
    try {
        const parsed = JSON.parse(argsRaw);
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    }
    catch {
        // Running calls can expose a truncated JSON prefix.
        return null;
    }
}
function resultText(block) {
    const text = block.content
        .map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
        .join('\n');
    if (text !== '')
        return text;
    return block.error === undefined ? null : `${block.error.name}: ${block.error.code}`;
}
function stateOf(block) {
    if (!('kind' in block))
        return 'running';
    if (block.error?.code === 'interrupted')
        return 'stopped';
    return block.isError ? 'error' : 'ok';
}
function metaObject(block) {
    if (!('kind' in block) || block.isError || typeof block.meta !== 'object' || block.meta === null)
        return null;
    return block.meta;
}
/**
 * Derive one Define card from its frozen call/result slice.
 * @param block - active or settled tool-call block.
 * @returns normalized Define card fields.
 */
export function cordisDefineCard(block) {
    const settled = 'kind' in block;
    const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? '';
    const args = parseArgs(argsRaw);
    const code = args === null ? null : objectAt(args, 'code');
    const state = stateOf(block);
    const output = settled ? resultText(block) : null;
    const meta = metaObject(block);
    const rawName = argsRaw === '' ? null : firstLine(argsRaw);
    return {
        pluginId: meta === null ? null : stringAt(meta, 'pluginId'),
        packageId: meta === null ? null : stringAt(meta, 'packageId'),
        name: args === null ? rawName : stringAt(args, 'name') ?? rawName,
        purpose: args === null ? null : stringAt(args, 'purpose'),
        hostCode: code === null ? null : stringAt(code, 'host'),
        clientCode: code === null ? null : stringAt(code, 'client'),
        output,
        errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
        state,
    };
}
/**
 * Derive one Run card and its successful activation metadata.
 * @param block - active or settled tool-call block.
 * @returns normalized Run card fields.
 */
export function cordisRunCard(block) {
    const settled = 'kind' in block;
    const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? '';
    const args = parseArgs(argsRaw);
    const meta = metaObject(block);
    const state = stateOf(block);
    const output = settled ? resultText(block) : null;
    const rawMode = args === null ? null : stringAt(args, 'mode');
    const argsPluginId = args === null ? null : stringAt(args, 'pluginId');
    const argsPackageId = args === null ? null : stringAt(args, 'packageId');
    return {
        pluginId: (meta === null ? argsPluginId : stringAt(meta, 'pluginId') ?? argsPluginId),
        packageId: (meta === null ? argsPackageId : stringAt(meta, 'packageId') ?? argsPackageId),
        pluginRunId: (meta === null ? null : stringAt(meta, 'pluginRunId')),
        mode: rawMode === 'run' || rawMode === 'update' ? rawMode : null,
        seq: settled ? block.seq : null,
        output,
        errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
        state,
    };
}
/**
 * Derive one Stop or Remove card from its frozen call/result slice.
 * @param block - active or settled tool-call block.
 * @returns normalized lifecycle-action card fields.
 */
export function cordisActionCard(block) {
    const settled = 'kind' in block;
    const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? '';
    const args = parseArgs(argsRaw);
    const state = stateOf(block);
    const output = settled ? resultText(block) : null;
    return {
        pluginId: (args === null ? null : stringAt(args, 'pluginId') ?? stringAt(args, 'id')),
        output,
        errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
        state,
    };
}
//# sourceMappingURL=card-model.js.map