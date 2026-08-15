import { PermissionRow } from "./PermissionRow.js";
import { accessEn, accessZh, en, zh, } from "./locales.js";
import { displayPermissionPreset, FULL_ACCESS_PRESET, } from "./presentation.js";
import { PERMISSION_SETTINGS_NS, PermissionPresetSettingsController, refreshPermissionIfLoaded, } from "./settings-store.js";
/** Required services (cordis fiber inject). */
export const inject = ['commandUi', 'sessions', 'slots', 'locale', 'connection', 'remote'];
const ACCESS_NS = 'permission.access';
/** Read one session's current permissions projection value (undefined = capability absent). */
function selectOf(session) {
    return session?.projections.faceOf('permissions').getSnapshot();
}
/** Flatten the projection select into popup rows; `custom` is display state, never a target. */
function optionsOf(value, t) {
    return value.options
        .filter(option => option.value !== 'custom')
        .map(option => ({
        id: option.value,
        label: displayPermissionPreset(option.value, option.name),
        ...(option.description !== undefined ? { detail: option.description } : {}),
        ...(option.value === value.currentValue ? { active: true } : {}),
        ...(option.value === FULL_ACCESS_PRESET
            ? {
                confirmation: {
                    title: t('confirm.title'),
                    description: t('confirm.description'),
                    acknowledgeLabel: t('confirm.acknowledge'),
                    cancelLabel: t('confirm.cancel'),
                    confirmLabel: t('confirm.enable'),
                },
            }
            : {}),
    }));
}
/**
 * Client plugin body: register the /permission popup picker over the
 * permissions projection.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const command = ctx.get('commandUi');
    const sessions = ctx.sessions;
    // This optional bundle and ui-conversation can load independently, so each
    // owns the same safety copy under its own locale namespace.
    /* jscpd:ignore-start */
    ctx.effect(() => {
        const disposers = [
            ctx.locale.register(ACCESS_NS, 'zh', {
                'confirm.title': accessZh['confirm.title'],
                'confirm.description': accessZh['confirm.description'],
                'confirm.acknowledge': accessZh['confirm.acknowledge'],
                'confirm.cancel': accessZh['confirm.cancel'],
                'confirm.enable': accessZh['confirm.enable'],
            }),
            ctx.locale.register(ACCESS_NS, 'en', {
                'confirm.title': accessEn['confirm.title'],
                'confirm.description': accessEn['confirm.description'],
                'confirm.acknowledge': accessEn['confirm.acknowledge'],
                'confirm.cancel': accessEn['confirm.cancel'],
                'confirm.enable': accessEn['confirm.enable'],
            }),
        ];
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'ui-permission: Full access confirmation dictionaries');
    /* jscpd:ignore-end */
    const t = ctx.locale.bind(ACCESS_NS);
    const sessionFor = (session) => sessions.binding(session.sessionId)?.session;
    ctx.effect(() => ctx.locale.register('settings.permission', { zh, en }), 'ui-permission: settings row dictionaries');
    const connection = ctx.get('connection');
    const controller = new PermissionPresetSettingsController(connection.api);
    const load = () => controller.load();
    const select = (preset) => controller.select(preset);
    const injected = () => ({
        hooks: { permission: controller.store },
        load,
        select,
    });
    ctx.effect(() => {
        const refresh = () => { refreshPermissionIfLoaded(controller); };
        const disposers = [
            ctx.remote.$on('settings/document-updated', (ns) => {
                if (ns !== PERMISSION_SETTINGS_NS)
                    return;
                refresh();
            }),
            ctx.on('connection/reset', () => { refresh(); }),
        ];
        return () => {
            controller.dispose();
            for (const dispose of disposers)
                dispose();
        };
    }, 'ui-permission: settings invalidations');
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'permission',
        order: -20,
        locale: 'settings.permission',
        inject: injected,
    }, PermissionRow));
    ctx.effect(() => command.decorate({
        name: 'permission',
        // The picker exists exactly while the projection does: a permission-less
        // host serves no key and the bare invocation falls through to the host
        // command (which is absent too — the line simply misses).
        available: session => selectOf(sessionFor(session)) !== undefined,
        ui: {
            kind: 'popupSelect',
            options: (session) => {
                const value = selectOf(sessionFor(session));
                if (value === undefined)
                    throw new Error('permission presets are not available on this host');
                return Promise.resolve(optionsOf(value, t));
            },
            onSelect: async (option, session) => {
                const live = sessionFor(session);
                if (live === undefined)
                    throw new Error('this session is not materialized yet');
                const result = await live.command(`/permission ${option.id}`);
                if (!result.ok)
                    throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`);
                if (!result.value.matched)
                    throw new Error('the host offers no /permission command');
            },
        },
    }), 'ui-permission: /permission decoration');
}
//# sourceMappingURL=index.js.map