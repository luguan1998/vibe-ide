/** Host registry and HTTP adapter for generic Connection RPC channels. */
import { Service } from '@deepseek-ai/cordis';
import { clientRequestSchema, RpcId, } from '@deepseek-ai/dsh-host-apiproxy/api';
import { bridge } from "./http-bridge.js";
import { isTrustedApiRequest } from "./api-request-trust.js";
import { API_PATH } from "./api-path.js";
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request');
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service {
    trustedHosts;
    interceptors = new Map();
    /**
     * Provide the Host half over the active HTTP server.
     * @param ctx - owning Connection plugin context.
     * @param trustedHosts - deployment authorities accepted by trusted-host channels.
     */
    constructor(ctx, trustedHosts) {
        super(ctx, 'connection');
        this.trustedHosts = trustedHosts;
    }
    /** Generic channel registry scoped to the Context reading this service. */
    get rpc() {
        const owner = this.ctx;
        return {
            handle: (channel, handler, options) => this.register(owner, channel, handler, options),
            intercept: (channel, matches, handler, options) => this.registerInterceptor(owner, channel, matches, handler, options),
        };
    }
    /**
     * Compose one shared-channel Fetch handler from its interceptor and fallback.
     * @param channel - shared channel mounted by Connection.
     * @param fallback - handler for endpoints not claimed by the interceptor.
     * @returns Fetch handler that selects exactly one target for each request.
     */
    createSharedFetchHandler(channel, fallback) {
        return {
            fetch: (request) => {
                const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
                const interceptor = this.interceptors.get(channel);
                if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
                    return fallback.fetch(request);
                }
                if (interceptor.options.authority === 'loopback' && !isTrustedApiRequest(request, [])) {
                    return Promise.resolve(new Response('forbidden', { status: 403 }));
                }
                return interceptor.fetchHandler.fetch(request);
            },
        };
    }
    register(owner, channel, handler, options) {
        assertChannel(channel);
        const trustedHosts = options.authority === 'loopback' ? [] : this.trustedHosts;
        const fetchHandler = rpcFetchHandler(channel, handler);
        const route = {
            kind: 'prefix',
            path: channel,
            handler: async (req, res) => {
                if (!isTrustedApiRequest(req, trustedHosts)) {
                    res.writeHead(403);
                    res.end('forbidden');
                    return;
                }
                await bridge(req, res, fetchHandler);
            },
        };
        return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`);
    }
    registerInterceptor(owner, channel, matches, handler, options) {
        if (channel !== API_PATH) {
            throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`);
        }
        const interceptor = {
            matches,
            fetchHandler: rpcFetchHandler(channel, handler),
            options,
        };
        return owner.effect(() => {
            if (this.interceptors.has(channel)) {
                throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`);
            }
            this.interceptors.set(channel, interceptor);
            return () => {
                this.interceptors.delete(channel);
            };
        }, `client-connection: ${channel} rpc interceptor`);
    }
}
function rpcFetchHandler(channel, handler) {
    return {
        async fetch(request) {
            const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
            if (request.method !== 'POST' || endpoint === undefined) {
                return new Response('not found', { status: 404 });
            }
            const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
            if (mediaType !== 'application/json') {
                return new Response('content type must be application/json', { status: 415 });
            }
            let body;
            try {
                body = await request.json();
            }
            catch {
                return new Response('body is not JSON', { status: 400 });
            }
            const envelope = clientRequestSchema.safeParse(body);
            if (!envelope.success) {
                return invalidEnvelopeResponse(body, envelope.error.issues);
            }
            const message = envelope.data;
            if (message.method !== endpoint) {
                return errorResponse(message.rpcId, {
                    code: 'bad-request',
                    message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
                    details: { issues: [] },
                });
            }
            try {
                const result = await handler(endpoint, message.payload, request.signal);
                return fullResponse(message.rpcId, result);
            }
            catch (error) {
                return new Response(`handler failure: ${String(error)}`, { status: 500 });
            }
        },
    };
}
function invalidEnvelopeResponse(body, issues) {
    const rawId = body?.rpcId;
    const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID;
    return errorResponse(rpcId, {
        code: 'bad-request',
        message: 'invalid client-request message',
        details: { issues },
    });
}
function endpointFromPath(channel, pathname) {
    if (!pathname.startsWith(`${channel}/`))
        return undefined;
    const endpoint = pathname.slice(channel.length + 1);
    const segments = endpoint.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
        return undefined;
    }
    return endpoint;
}
function errorResponse(rpcId, error) {
    return fullResponse(rpcId, { ok: false, error });
}
function fullResponse(rpcId, result) {
    const body = { type: 'server-response', rpcId, result };
    return Response.json(body);
}
function assertChannel(channel) {
    if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
        throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`);
    }
}
//# sourceMappingURL=rpc-host.js.map