/**
 * Immutable launch-time environment snapshot that records which layer
 * supplied each value. Harness consumers resolve through it instead of a flattened
 * `process.env`; launchers may still materialize accepted values for config
 * expressions and third-party libraries.
 * @module @deepseek-ai/dsh-launch-environment
 */
/** Layer order, most trusted first. */
const SOURCE_ORDER = ['process', 'project-env', 'user-env'];
/**
 * The map key one variable name resolves under. Windows treats environment
 * names case-insensitively; every other platform does not.
 * @param name - the variable name as written.
 * @returns the key to store and look up by.
 */
function lookupKey(name) {
    /* v8 ignore next -- native Windows coverage exercises the folding arm; POSIX covers the exact one */
    return process.platform === 'win32' ? name.toUpperCase() : name;
}
/**
 * Build the snapshot from each layer's contents.
 * @param layers - the layers in any order; the result searches them by canonical trust order.
 * @returns the immutable snapshot.
 */
export function createLaunchEnvironmentSnapshot(layers) {
    // Copy every layer so later mutations cannot change the snapshot. Fold names
    // on Windows so case variants cannot split precedence; POSIX remains exact.
    const bySource = new Map();
    for (const layer of layers) {
        bySource.set(layer.source, {
            ...layer.path === undefined ? {} : { path: layer.path },
            values: new Map(Object.entries(layer.values).map(([name, value]) => [lookupKey(name), value])),
        });
    }
    const getFrom = (name, sources) => {
        const key = lookupKey(name);
        for (const source of SOURCE_ORDER) {
            if (!sources.includes(source))
                continue;
            const layer = bySource.get(source);
            const value = layer?.values.get(key);
            if (value === undefined)
                continue;
            return { value, source, ...layer?.path === undefined ? {} : { path: layer.path } };
        }
        return undefined;
    };
    return {
        get: name => getFrom(name, SOURCE_ORDER),
        getFrom,
    };
}
/** Context slot the launcher fills with this run's snapshot before any config entry mounts. */
export const DSH_LAUNCH_ENVIRONMENT_KEY = 'launchEnvironment';
/**
 * Return the launcher's snapshot, or the inherited environment as the sole
 * layer when the host provided none.
 * @param ctx - the consuming plugin's context.
 * @returns the snapshot to resolve user-facing values against.
 */
export function launchEnvironmentOf(ctx) {
    return ctx.get(DSH_LAUNCH_ENVIRONMENT_KEY)
        ?? createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]);
}
//# sourceMappingURL=index.js.map