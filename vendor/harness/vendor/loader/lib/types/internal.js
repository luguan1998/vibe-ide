import { createRequire } from 'node:module';
/** Helpers for locating the current Node internal module loader. */
export var ModuleLoader;
(function (ModuleLoader) {
    let _cachedLoader;
    function requireInternal(id) {
        const require = createRequire(import.meta.url);
        if (process.execArgv.includes('--expose-internals')) {
            try {
                return require(id);
            }
            catch { }
        }
        try {
            return require('node-addon-require-builtin').requireBuiltin(id);
        }
        catch { }
    }
    function fromInternal() {
        if (_cachedLoader)
            return _cachedLoader;
        const [major] = process.versions.node.split('.').map(Number);
        if (major >= 24) {
            const raw = requireInternal('internal/modules/esm/loader')?.getOrInitializeCascadedLoader();
            if (raw)
                return _cachedLoader = Object.assign(raw, { version: 'v2' });
        }
        else if (major >= 22) {
            const raw = requireInternal('internal/modules/esm/loader')?.getOrInitializeCascadedLoader();
            if (raw)
                return _cachedLoader = Object.assign(raw, { version: 'v1' });
        }
    }
    ModuleLoader.fromInternal = fromInternal;
})(ModuleLoader || (ModuleLoader = {}));
//# sourceMappingURL=internal.js.map