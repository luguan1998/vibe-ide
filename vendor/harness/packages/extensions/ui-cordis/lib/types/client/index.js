/** Cordis dynamic-plugin cards, inventory panel, business-view host, and `@pluginId` source. */
import { CordisActionRow } from "./CordisActionRow.js";
import { CordisDefineRow } from "./CordisDefineRow.js";
import { CordisRunRow } from "./CordisRunRow.js";
import { CordisPanel } from "./CordisPanel.js";
import { createCordisInventory } from "./inventory.js";
import { CordisRunCardRegistry } from "./run-card-index.js";
import { en, NS, zh } from "./locales.js";
/** Required services for the two Tool cards, panel, Remote lifecycle, and Slash source. */
export const inject = [
    'slots', 'locale', 'inputTriggers', 'remote', 'remote.dynamicCordisRunner', 'dynamicCordisRunner',
];
/** Mount every Cordis browser surface over the shared Host inventory. */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-cordis: dictionaries');
    const port = {
        stop: async (sessionId, pluginId) => {
            const answered = await ctx.remote.dynamicCordisRunner.stopFromPanel(sessionId, pluginId);
            if (!answered.ok)
                return { ok: false, message: `${answered.error.code}: ${answered.error.message}` };
            if (answered.value.ok || answered.value.reason === 'not-running')
                return { ok: true };
            return { ok: false, message: answered.value.message };
        },
        remove: async (sessionId, pluginId) => {
            const answered = await ctx.remote.dynamicCordisRunner.undefineFromPanel(sessionId, pluginId);
            if (!answered.ok)
                return { ok: false, message: `${answered.error.code}: ${answered.error.message}` };
            return answered.value.ok ? { ok: true } : { ok: false, message: answered.value.message };
        },
        inventory: async () => {
            const answered = await ctx.remote.dynamicCordisRunner.inventory();
            if (!answered.ok)
                throw new Error(`${answered.error.code}: ${answered.error.message}`);
            return answered.value;
        },
    };
    const inventory = createCordisInventory(port, (error) => {
        console.error('[ui-cordis] reading the Cordis inventory failed:', error);
    });
    const runner = ctx.dynamicCordisRunner;
    const loaded = { getSnapshot: () => runner.getSnapshot(), subscribe: (fn) => runner.subscribe(fn) };
    const runCards = new CordisRunCardRegistry();
    ctx.effect(() => inventory.subscribe(() => {
        const snapshot = inventory.getSnapshot();
        if (snapshot.read)
            runner.reconcileApprovals(snapshot.rows);
    }), 'ui-cordis: reconcile pending approvals');
    ctx.remote.$on('cordis/dynamic-package', () => { inventory.refresh(); });
    ctx.remote.$on('cordis/dynamic-retract', () => { inventory.refresh(); });
    ctx.remote.$on('cordis/request-run', (request) => {
        if (!inventory.getSnapshot().rows.some(row => row.pluginId === request.pluginId))
            inventory.refresh();
    });
    ctx.remote.$on('cordis/request-run-resolved', () => { inventory.refresh(); });
    ctx.on('connection/reset', () => {
        inventory.reset();
        inventory.refresh();
    });
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'cordis-panel',
        locale: NS,
        inject: () => ({
            hooks: {
                inventory,
                activeRuns: runner.activeRuns,
                runErrors: runner.lastRunError,
                loaded,
                renderFailures: runner.renderFailures,
            },
            onApprove: (requestId, approveFutureVersions) => runner.approve(requestId, approveFutureVersions),
            onDecline: requestId => runner.decline(requestId),
            onRun: request => runner.startUserRun(request),
            onStop: async (sessionId, pluginId) => {
                const result = await port.stop(sessionId, pluginId);
                inventory.refresh();
                return result;
            },
            onRemove: async (sessionId, pluginId) => {
                const result = await port.remove(sessionId, pluginId);
                if (result.ok)
                    inventory.retire(pluginId);
                inventory.refresh();
                return result;
            },
            onRefresh: () => { inventory.refresh(); },
        }),
    }, CordisPanel));
    const cardFace = () => ({ hooks: { inventory, loaded } });
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'cordis_define',
        locale: NS,
        inject: cardFace,
    }, CordisDefineRow));
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'cordis_run',
        locale: NS,
        children: { 'tool.view.cordis': { kind: 'keyed', scope: 'session' } },
        inject: (sessionId) => {
            const store = runCards.forSession(sessionId);
            return {
                hooks: { inventory, loaded, runCards: store, activeRuns: runner.activeRuns },
                onObserveRunCard: (pointer) => { store.observe(pointer); },
            };
        },
    }, CordisRunRow));
    ctx.slots.inject('tool.call.toolview', function* () {
        yield ctx.slots.register({
            name: 'tool.call.toolview', key: 'cordis_stop', locale: NS,
        }, CordisActionRow);
        yield ctx.slots.register({
            name: 'tool.call.toolview', key: 'cordis_undefine', locale: NS,
        }, CordisActionRow);
    });
    const rowsOf = (sessionId, query) => inventory.getSnapshot().rows
        .filter(row => row.agentId === sessionId && String(row.pluginId).includes(query));
    const source = {
        trigger: '@',
        name: 'cordis',
        order: 1,
        candidates(session, { query }) {
            const rows = rowsOf(session.sessionId, query);
            return Promise.resolve(rows.map((row) => {
                const packageId = row.nextPackageId ?? row.currentPackageId ?? row.packages.at(-1)?.packageId;
                const pkg = packageId === undefined ? undefined : row.packages.find(candidate => candidate.packageId === packageId);
                return {
                    name: String(row.pluginId),
                    ...pkg === undefined ? {} : { description: pkg.purpose },
                };
            }));
        },
        warm() { inventory.refresh(); },
        lexicon(session) { return rowsOf(session.sessionId, '').map(row => String(row.pluginId)); },
        subscribeLexicon(_session, listener) { return inventory.subscribe(listener); },
        onPick({ candidate }) { return { text: `@${candidate.name} ` }; },
    };
    const slash = ctx.get('inputTriggers');
    ctx.effect(() => slash.registerSource(source), 'ui-cordis: @pluginId source');
    inventory.refresh();
}
//# sourceMappingURL=index.js.map