import { AppearanceRow } from "./AppearanceRow.js";
import { createAppearanceRowStore } from "./settings-store.js";
import { en, zh } from "./locales.js";
import { DEFAULT_PREFERENCE, isThemePreference, THEME_PREFERENCE_FIELD, THEME_SETTINGS_NAMESPACE, } from "../theme-settings.js";
/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.theme';
const BUILTIN_THEMES = Object.freeze([
    Object.freeze({ id: 'light', colorScheme: 'light', tokens: Object.freeze({}) }),
    Object.freeze({ id: 'dark', colorScheme: 'dark', tokens: Object.freeze({}) }),
]);
const BUILTIN_INSPECT_TOKENS = Object.freeze([
    { name: '--dsw-alias-bg-base', description: 'Application base background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-base' },
    { name: '--dsw-alias-bg-layer-1', description: 'Primary raised surface background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-layer-1' },
    { name: '--dsw-alias-bg-layer-2', description: 'Secondary nested surface background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-layer-2' },
    { name: '--dsw-alias-bg-overlay', description: 'Overlay and popover background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-overlay' },
    { name: '--dsw-alias-border-l1', description: 'Primary subtle border.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-border-l1' },
    { name: '--dsw-alias-border-l2', description: 'Secondary stronger border.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-border-l2' },
    { name: '--dsw-alias-brand-primary', description: 'Primary brand accent.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-brand-primary' },
    { name: '--dsw-alias-label-primary', description: 'Primary text color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-label-primary' },
    { name: '--dsw-alias-label-secondary', description: 'Secondary text color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-label-secondary' },
    { name: '--dsw-alias-state-error-primary', description: 'Primary error state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-error-primary' },
    { name: '--dsw-alias-state-success-primary', description: 'Primary success state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-success-primary' },
    { name: '--dsw-alias-state-warn-primary', description: 'Primary warning state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-warn-primary' },
    { name: '--dsw-specific-sidebar-fill', description: 'Sidebar column and title-row background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-specific-sidebar-fill' },
]);
/**
 * Theme registry and preference owner. `light`/`dark` are built in (the base
 * stylesheets carry both palettes); third-party themes register alias-layer
 * overrides. Reads go through {@link getTheme}; preference writes only
 * through {@link setTheme}; continuous sync only through the `theme/change`
 * event. {@link overrideTokens} stacks partial token layers over the active
 * theme without touching the registry.
 * The service holds the `prefers-color-scheme` media query (environment
 * sensing, not presentation) and re-emits when the OS scheme flips while the
 * preference is `system`.
 */
export class ThemeRuntime {
    ctx;
    host;
    themes = [...BUILTIN_THEMES];
    preference;
    revision = 0;
    snapshot;
    media;
    /** Override layers by source; seq (monotonic) is the stacking order. */
    overrides = new Map();
    overrideSeq = 0;
    /**
     * @param ctx - owning context (change events are emitted on it; the
     * media-query and scope listeners are released through ctx.effect on dispose).
     * @param host - durable preference scope owned by the same plugin.
     */
    constructor(ctx, host) {
        this.ctx = ctx;
        this.host = host;
        this.preference = DEFAULT_PREFERENCE;
        // Non-browser runs (node e2e booting the client tree) have no matchMedia.
        this.media = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)');
        this.snapshot = this.buildSnapshot();
        if (this.media !== undefined) {
            const media = this.media;
            const onChange = () => {
                if (this.preference !== 'system')
                    return;
                this.publish();
            };
            ctx.effect(() => {
                media.addEventListener('change', onChange);
                return () => { media.removeEventListener('change', onChange); };
            }, 'ui-theme: prefers-color-scheme listener');
        }
        ctx.effect(() => host.subscribe(() => { this.adopt(); }), 'ui-theme: settings scope adoption');
        this.adopt();
    }
    /**
     * Read the current immutable theme snapshot.
     * @returns the current snapshot (stable reference until the next change).
     */
    getTheme() {
        return this.snapshot;
    }
    /**
     * Export the current token directory without reading DOM or computed styles.
     * @returns stable JSON-safe token descriptions, including registered and override-only names.
     */
    exportInspectTokens() {
        const tokens = new Map(BUILTIN_INSPECT_TOKENS.map(token => [token.name, token]));
        for (const theme of this.themes) {
            for (const name of Object.keys(theme.tokens)) {
                if (!tokens.has(name))
                    tokens.set(name, dynamicToken(name));
            }
        }
        for (const layer of this.overrides.values()) {
            for (const name of Object.keys(layer.tokens)) {
                if (!tokens.has(name))
                    tokens.set(name, dynamicToken(name));
            }
        }
        return [...tokens.values()].map(token => ({ ...token })).sort((left, right) => left.name.localeCompare(right.name));
    }
    /**
     * Switch the theme preference — the only user preference write entry.
     * Built-in preferences are written through the settings scope and every
     * accepted value emits `theme/change`.
     * @param id - a registered theme id or `system`; unknown ids throw.
     */
    setTheme(id) {
        if (id !== 'system' && !this.themes.some(t => t.id === id)) {
            throw new Error(`theme "${id}" is not registered`);
        }
        if (this.preference === id)
            return;
        this.preference = id;
        if (isThemePreference(id))
            void this.host.set(THEME_PREFERENCE_FIELD, id);
        this.publish();
    }
    /** Adopt the scope's accepted durable preference without writing it back. */
    adopt() {
        const section = this.host.getSnapshot().value;
        if (section === undefined || this.preference === section.preference)
            return;
        this.preference = section.preference;
        this.publish();
    }
    /**
     * Register a theme. Duplicate id throws (single occupant per id; the
     * built-in pair counts; `system` is a preference, not a registrable id).
     * @param definition - theme id, colorScheme, and alias-token overrides.
     * @returns disposer. Disposing the theme backing the active preference
     * resets the preference to the default so the UI never keeps tokens of an
     * unregistered theme.
     */
    register(definition) {
        if (definition.id === 'system')
            throw new Error('"system" is a preference, not a registrable theme id');
        if (this.themes.some(t => t.id === definition.id)) {
            throw new Error(`theme "${definition.id}" is already registered`);
        }
        this.themes = [...this.themes, definition];
        this.publish();
        return () => {
            if (!this.themes.some(t => t.id === definition.id))
                return;
            this.themes = this.themes.filter(t => t.id !== definition.id);
            if (this.preference === definition.id) {
                this.preference = DEFAULT_PREFERENCE;
            }
            this.publish();
        };
    }
    /**
     * Stack a token override layer on top of the active theme — the token-level
     * analogue of slot shading: the base theme stays untouched, layers compose
     * in seq order with later layers winning per-token, and removing a layer
     * restores whatever it covered. Calling again with the same source replaces
     * that source's whole layer and restacks it on top (effect re-registration
     * semantics). Emits `theme/change` with the recomposed snapshot.
     * @param source - layer identity; one layer per source (dynamic packages
     * pass their package id — the façade pins it, so it also names the layer's
     * origin for inspection).
     * @param tokens - token-name → `{ light, dark }` value pairs. Validated at
     * runtime (model-authored callers reach this boundary with untyped JS);
     * a bare string value throws a teaching error.
     * @returns disposer removing exactly the layer this call created; a no-op
     * once the source has re-overridden (the newer layer is not torn down).
     */
    overrideTokens(source, tokens) {
        const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) };
        this.overrides.set(source, layer);
        this.publish();
        return () => {
            if (this.overrides.get(source) !== layer)
                return;
            this.overrides.delete(source);
            this.publish();
        };
    }
    buildSnapshot() {
        const resolvedId = this.preference === 'system'
            ? (this.media?.matches === true ? 'dark' : 'light')
            : this.preference;
        // Both built-ins always exist; a registered preference id resolves or has
        // been reset by its disposer, so the lookup cannot miss.
        const active = this.themes.find(t => t.id === resolvedId);
        /* v8 ignore next 2 -- needs a registry without light/dark, which register()/dispose() cannot produce */
        if (active === undefined)
            throw new Error(`theme registry lost "${resolvedId}"`);
        return Object.freeze({
            preference: this.preference,
            active: this.composeActive(active),
            themes: Object.freeze([...this.themes]),
            revision: this.revision,
        });
    }
    /**
     * Fold the override layers into the active definition: seq order, later
     * layers win per-token, each value picked for the active color scheme (the
     * presenter consumes the composed snapshot and needs no override awareness).
     * Without layers the registered definition passes through by identity.
     */
    composeActive(active) {
        if (this.overrides.size === 0)
            return active;
        const tokens = { ...active.tokens };
        for (const layer of [...this.overrides.values()].sort((a, b) => a.seq - b.seq)) {
            for (const [name, modes] of Object.entries(layer.tokens)) {
                tokens[name] = modes[active.colorScheme];
            }
        }
        return Object.freeze({ ...active, tokens: Object.freeze(tokens) });
    }
    publish() {
        this.revision += 1;
        this.snapshot = this.buildSnapshot();
        this.ctx.emit('theme/change', this.snapshot);
    }
}
/**
 * Runtime shape check for one override layer (model-authored callers pass
 * untyped JS through the dynamic-package façade, so the static type cannot
 * enforce the pair shape there). Returns a defensive per-token copy so later
 * caller mutation cannot reach the stored layer.
 */
function validateOverrides(source, tokens) {
    const validated = {};
    for (const [name, value] of Object.entries(tokens)) {
        if (typeof value === 'string') {
            throw new TypeError(`theme override "${name}" from "${source}" is a bare string — pass { light: ${JSON.stringify(value)}, dark: ${JSON.stringify(value)} } `
                + '(repeat the value when it is the same in both palettes); a single value goes illegible when the user switches color scheme');
        }
        if (typeof value !== 'object' || value === null
            || typeof value.light !== 'string'
            || typeof value.dark !== 'string') {
            throw new TypeError(`theme override "${name}" from "${source}" must map to a { light, dark } pair of strings — one value per color scheme`);
        }
        const modes = value;
        validated[name] = { light: modes.light, dark: modes.dark };
    }
    return validated;
}
function dynamicToken(name) {
    return {
        name,
        description: 'Theme token registered by the current Client composition.',
        valueType: 'CSS value',
        requiresLightAndDark: true,
        ...(name.startsWith('--') ? { cssVariable: name } : {}),
    };
}
/**
 * Required services: settings transport plus slots/locale for the Appearance
 * row. `remote` carries the forwarded settings invalidation that
 * `bindSettingsScope` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'];
/**
 * Client plugin body: provide the theme service and register the
 * feature-owned Appearance preference row into the General section's item
 * slot (a feature owns its settings surface).
 * @param ctx - client cordis context.
 */
export function apply(ctx) {
    const host = ctx.settingsScope.bind({ namespace: THEME_SETTINGS_NAMESPACE });
    const theme = new ThemeRuntime(ctx, host);
    ctx.provide('theme', theme);
    ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: settings row dictionaries');
    const store = createAppearanceRowStore();
    let bound;
    const sync = (snapshot) => {
        bound?.sync(snapshot.preference, snapshot.revision);
    };
    ctx.on('theme/change', sync);
    const injected = (actions) => {
        bound = actions;
        // Re-sync from the getter so no event is lost between registration and
        // first render (the store's revision guard drops stale duplicates).
        sync(theme.getTheme());
        return {
            setTheme: (id) => { theme.setTheme(id); },
        };
    };
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'appearance',
        order: 10,
        store,
        locale: SETTINGS_NS,
        inject: injected,
    }, AppearanceRow));
}
//# sourceMappingURL=index.js.map