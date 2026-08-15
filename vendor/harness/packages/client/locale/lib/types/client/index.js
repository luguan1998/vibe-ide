import { LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE, } from "../locale-settings.js";
import { en, zh } from "../locales/index.js";
import { en as settingsEn, zh as settingsZh, } from "../locales/settings.js";
import { LanguageRow } from "./LanguageRow.js";
import { createLanguageRowStore } from "./settings-store.js";
/** Fallback locale consulted after the active locale misses (also the last-resort initial locale). */
export const FALLBACK_LOCALE = 'zh';
/** Shared namespace for shell-level texts. */
export const COMMON_NS = 'common';
/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.locale';
/** The two shipped locales. */
const LOCALES = Object.freeze([
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
]);
/**
 * Dictionary registry plus locale preference. Lookup chain per key: the
 * entry's namespace in the active locale -> that namespace's zh fallback ->
 * the shared common namespace (active, then zh) -> the key itself (missing
 * text stays visible, fail loud in the UI rather than blank). Reads go
 * through {@link getLocale}; writes only through {@link setLocale};
 * continuous sync through the `locale/change` event, or through the
 * LocaleFace getSnapshot/subscribe pair the render machinery consumes
 * (installed via `ctx.slots.installLocale`).
 */
export class LocaleRuntime {
    dicts = new Map();
    bound = new Map();
    snapshot;
    listeners = new Set();
    ctx;
    host;
    /** Browser-derived locale standing wherever no explicit Host selection does. */
    provisional;
    /**
     * @param ctx - owning context (change events are emitted on it; the scope
     * listener is released through ctx.effect on dispose).
     * @param host - durable preference scope owned by the providing plugin;
     * absent compositions (standalone dictionary registries) stay process-local.
     */
    constructor(ctx, host) {
        this.ctx = ctx;
        this.host = host;
        this.provisional = resolveInitialLocale();
        this.snapshot = Object.freeze({ active: this.provisional, locales: LOCALES, revision: 0 });
        if (host !== undefined) {
            ctx.effect(() => host.subscribe(() => { this.adopt(host); }), 'locale: settings scope adoption');
            this.adopt(host);
        }
    }
    /**
     * Read the current immutable locale snapshot.
     * @returns the current snapshot (stable reference until the next change).
     */
    getLocale() {
        return this.snapshot;
    }
    /**
     * LocaleFace getSnapshot: the current snapshot (carries `revision`; stable
     * reference between changes, uSES-safe).
     * @returns the current snapshot.
     */
    getSnapshot() {
        return this.snapshot;
    }
    /**
     * LocaleFace subscribe: notified on every snapshot change (locale switch
     * or dictionary registration — registrations bump the revision so already
     * rendered outlets pick up late-arriving dictionaries).
     * @param fn - change callback.
     * @returns unsubscribe.
     */
    subscribe(fn) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }
    /**
     * Switch the active locale — the only user preference write entry.
     * @param id - a registered locale id; unknown ids throw.
     */
    setLocale(id) {
        const match = this.snapshot.locales.find(l => l.id === id);
        if (match === undefined)
            throw new Error(`locale "${id}" is not registered`);
        if (this.snapshot.active === match.id)
            return;
        this.publish(match.id, true);
        void this.host?.set(LOCALE_PREFERENCE_FIELD, match.id);
    }
    /**
     * Adopt the scope's accepted durable selection without writing it back; an
     * absent selection returns to the browser-derived locale.
     * @param host - the constructor-narrowed scope driving this adoption.
     */
    adopt(host) {
        const section = host.getSnapshot().value;
        if (section === undefined)
            return;
        const target = section.preference ?? this.provisional;
        if (this.snapshot.active === target)
            return;
        this.publish(target, true);
    }
    register(ns, localeOrDicts, dict) {
        const pairs = typeof localeOrDicts === 'string'
            // Overload guarantees dict on the single-locale arm.
            ? [[localeOrDicts, dict]]
            : Object.entries(localeOrDicts);
        let locales = this.dicts.get(ns);
        if (!locales) {
            locales = new Map();
            this.dicts.set(ns, locales);
        }
        for (const [locale] of pairs) {
            if (locales.has(locale))
                throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
        }
        for (const [locale, entries] of pairs)
            locales.set(locale, entries);
        this.publish(this.snapshot.active, false);
        return () => {
            const owner = this.dicts.get(ns);
            /* v8 ignore next -- defensive: a namespace's locales map is created on
             * first register and never removed, so the disposer always finds it. */
            if (!owner)
                return;
            let removed = false;
            for (const [locale, entries] of pairs) {
                if (owner.get(locale) === entries) {
                    owner.delete(locale);
                    removed = true;
                }
            }
            if (removed)
                this.publish(this.snapshot.active, false);
        };
    }
    bind(ns) {
        let t = this.bound.get(ns);
        if (!t) {
            t = (key, params) => this.translate(ns, key, params);
            this.bound.set(ns, t);
            return t;
        }
        return t;
    }
    translate(ns, key, params) {
        const template = this.lookup(ns, key)
            ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key) : undefined)
            ?? key;
        if (!params)
            return template;
        return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
    }
    lookup(ns, key) {
        const locales = this.dicts.get(ns);
        return locales?.get(this.snapshot.active)?.[key] ?? locales?.get(FALLBACK_LOCALE)?.[key];
    }
    /**
     * Advance the snapshot revision and notify LocaleFace subscribers (render
     * refresh). Only an active-locale switch additionally emits
     * `locale/change` — dictionary registrations stay off the event so
     * registration-heavy boot cannot storm event listeners (which may
     * re-register slots in response).
     */
    publish(active, localeChanged) {
        this.snapshot = Object.freeze({
            active,
            locales: this.snapshot.locales,
            revision: this.snapshot.revision + 1,
        });
        if (localeChanged)
            this.ctx.emit('locale/change', this.snapshot);
        for (const fn of [...this.listeners]) {
            try {
                fn();
            }
            catch (error) {
                // One throwing subscriber must not strand the rest on a stale
                // revision (outlets would keep the previous language).
                console.error('locale subscriber crashed:', error);
            }
        }
    }
}
/**
 * The browser's own language wins over {@link FALLBACK_LOCALE}; an explicit
 * Host preference may replace this provisional value after plugin activation.
 */
function resolveInitialLocale() {
    return detectBrowserLocale() ?? FALLBACK_LOCALE;
}
/**
 * The first shipped locale the browser asks for, matched on the primary
 * subtag so every regional variant lands on its language (`zh-Hans-CN` -> zh,
 * `en-GB` -> en). `window` is the browser test, not `navigator`: Node exposes
 * a global `navigator` reporting the machine's own language, which would
 * otherwise decide the locale for non-browser runs (node e2e booting the
 * client tree). `navigator.language` trails the ordered `languages` list and
 * covers its absence on hosts that expose only the single tag.
 */
function detectBrowserLocale() {
    if (typeof window === 'undefined')
        return undefined;
    /* oxlint-disable-next-line typescript/no-unnecessary-condition --
     * The DOM lib types `languages` as always present; embedders and older
     * WebViews ship a Navigator without it, and spreading undefined would
     * throw at boot. */
    for (const tag of [...(navigator.languages ?? []), navigator.language]) {
        const primary = tag.toLowerCase().split('-')[0];
        const match = LOCALES.find(locale => locale.id === primary);
        if (match)
            return match.id;
    }
    return undefined;
}
/** Required services: slot registration plus the settings transport. */
export const inject = ['slots', 'connection', 'remote', 'settingsScope'];
/**
 * Client plugin body: provide the locale service with base dictionaries and
 * register the feature-owned Language preference row into the General
 * section's item slot (a feature owns its settings surface).
 * @param ctx - client cordis context.
 */
export function apply(ctx) {
    const host = ctx.settingsScope.bind({ namespace: LOCALE_SETTINGS_NAMESPACE });
    const locale = new LocaleRuntime(ctx, host);
    locale.register(COMMON_NS, { zh, en });
    locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn });
    ctx.provide('locale', locale);
    // The service IS the LocaleFace (bind + getSnapshot/subscribe): install it
    // so the render machinery can synthesize the `t` standard seat.
    ctx.slots.installLocale(locale);
    const store = createLanguageRowStore();
    let bound;
    const sync = (snapshot) => {
        bound?.sync(snapshot.active, snapshot.locales.map(l => ({ id: l.id, label: l.label })), snapshot.revision);
    };
    ctx.on('locale/change', sync);
    const injected = (actions) => {
        bound = actions;
        // Re-sync from the getter so no event is lost between registration and
        // first render (the store's revision guard drops stale duplicates).
        sync(locale.getLocale());
        return {
            setLocale: (id) => { locale.setLocale(id); },
        };
    };
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'language',
        order: 0,
        store,
        locale: SETTINGS_NS,
        inject: injected,
    }, LanguageRow));
}
//# sourceMappingURL=index.js.map