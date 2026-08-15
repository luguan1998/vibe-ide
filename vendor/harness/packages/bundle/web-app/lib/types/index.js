/**
 * @deepseek-ai/dsh-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns the browser-surface glue: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * harness-source and web-surface prompt sections, the bash-visible web runtime
 * variable, and the URL line. App command-line values arrive through the
 * `webStartup` service expressions in the bundle patch.
 * @module @deepseek-ai/dsh-web-app
 */
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot';
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static';
/** Stable Cordis plugin name. */
export const name = 'web-app';
/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = 'webRuntime';
/** Services required before the web runtime can mount. */
export const inject = ['webServer'];
export const Config = z.object({
    printUrl: z.boolean().default(true),
    surfaceContext: z.boolean().default(true),
    trustedHosts: z.array(String).default([]),
});
/** Environment variable naming the canonical local URL of this Web GUI. */
const DSH_WEB_URL = 'DSH_WEB_URL';
// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1';
/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = '0.0.0.0';
/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and
 * an OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost, extra) {
    const lanAddresses = bindHost === ALL_INTERFACES_HOST
        ? Object.values(networkInterfaces()).flat()
            .filter((iface) => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
            .map(iface => iface.address)
        : [];
    return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] };
}
/** Model-visible orientation and acceptance boundary for sessions created through `dsh web`. */
function webSurfacePrompt(webUrl) {
    const updateContract = 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while '
        + '`pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
        + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. ';
    return `You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}. `
        + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
        + 'The browser provides no implicit DOM, route, or screenshot context. '
        + updateContract
        + 'Starting another server does not update this GUI. '
        + 'The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. '
        + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.';
}
/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx) {
    const port = ctx.get('webServer')?.port;
    if (port === undefined)
        throw new Error('web-app: webServer service missing while resolving Web runtime');
    return `http://${LOOPBACK_HOST}:${String(port)}`;
}
/** Dist location is workspace knowledge of this bundle: resolved through the frontend package exports, not configured. */
function resolveDistIndex() {
    const require = createRequire(import.meta.url);
    try {
        return require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html');
    }
    catch {
        /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
        throw new Error('web-app: frontend dist not built; run pnpm run build from the repository root first');
    }
}
/** Test hook: hosts with no built frontend dist substitute the resolver; production never touches this. */
export const internals = { resolveDistIndex };
/**
 * Mount the Web runtime: dist serving, surface prompt, the bash runtime
 * variable, and the URL line.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
    const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts);
    // Release dependent rows only after bind-dependent trust has been sampled once.
    ctx.provide(WEB_RUNTIME_SERVICE, runtime);
    ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() });
    if (config.surfaceContext) {
        ctx.inject(['systemPrompt'], (promptCtx) => {
            addHarnessSourceSection(promptCtx, SOURCE_ROOT);
            promptCtx.systemPrompt.section({
                name: 'app:web-surface',
                order: -98,
                text: () => webSurfacePrompt(localWebUrl(promptCtx)),
            });
        });
        ctx.inject(['shellEnv'], (runtimeCtx) => {
            runtimeCtx.shellEnv.register({
                name: 'web-runtime',
                variables: {
                    [DSH_WEB_URL]: { description: 'Canonical local URL of the DeepSeek Harness Web GUI serving this session.' },
                },
                resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx) }),
            });
        });
    }
    if (config.printUrl) {
        // The URL line is a readiness signal: supervisors (and the keyless CLI
        // smoke) RPC as soon as they observe it, so it must not print while
        // sibling rows (the /api route owner) are still mounting. Await Loader
        // settlement first; a hand-built tree without a Loader prints at once.
        const printUrl = () => {
            // Reuse the exact LAN snapshot provided to the /api trust fence.
            const lanCandidate = runtime.lanAddresses[0];
            const port = ctx.webServer.port;
            console.log(`dsh web: ${localWebUrl(ctx)}${lanCandidate === undefined ? '' : ` (LAN: http://${lanCandidate}:${String(port)})`}`);
        };
        // This row's own activation can precede a sibling failure. The app owns
        // readiness by waiting for its Loader tree, or prints at once in a
        // hand-built context without Loader.
        const settled = ctx.get('loader')?.await();
        if (settled === undefined)
            printUrl();
        else {
            void settled.then(() => {
                // The tree can be disposed while the boot was in flight (early
                // SIGTERM); a URL line for a dead server would only mislead, and
                // reading the torn-down port would turn a clean shutdown into a crash.
                if (ctx.get('webServer') !== undefined)
                    printUrl();
                // Loader reports a failed boot; this row only stays quiet.
            }, () => { });
        }
    }
}
//# sourceMappingURL=index.js.map