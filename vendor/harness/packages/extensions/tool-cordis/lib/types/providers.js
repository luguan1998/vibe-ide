/** First-party Host inspect providers registered by the Cordis tool package. */
import { HOST_BUILTIN_INSPECTION } from '@deepseek-ai/dsh-cordis-host-runner';
import { EVENT_API, queryEventApi, queryServiceApi } from "./api-catalog.js";
const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false };
const ANY_OUTPUT = { description: 'JSON data owned by this inspect provider.' };
const SERVICE_INPUT = exactInput('service', 'Exact Service key. Omit it for the compact Service and method-signature directory.');
const EVENT_INPUT = exactInput('event', 'Exact Event name. Omit it for the compact Event and listener-signature directory.');
const SERVICE_OUTPUT = {
    description: 'Compact Service directory, or one exact Service contract with only its referenced type declarations.',
};
const EVENT_OUTPUT = {
    description: 'Compact Event directory, or one exact Event contract with only its referenced type declarations.',
};
const HOST_EVENTS = EVENT_API.filter(event => !event.name.startsWith('cordis/'));
/**
 * Construct Host providers over generated Catalogs, evaluator declarations, and live Tool scope.
 * @param ctx - Host context used for Agent-scoped live Tool queries.
 * @returns registrations for static catalogs and live Host capabilities.
 */
export function hostInspectProviders(ctx) {
    return [
        registration('Service', 'Progressive Host Service discovery: compact capability/signature directory, then one exact coding contract.', 'listService', input => queryServiceApi(readExact(input, 'service')), SERVICE_INPUT, SERVICE_OUTPUT),
        registration('Event', 'Progressive Host Event discovery: compact listener directory, then one exact event contract.', 'listEvents', input => queryEventApi(readExact(input, 'event'), HOST_EVENTS), EVENT_INPUT, EVENT_OUTPUT),
        registration('Builtin', 'Plain-JavaScript symbols available to a dynamic Host half.', 'listBuiltins', () => ({
            builtins: HOST_BUILTIN_INSPECTION,
            referencedTypes: [],
        })),
        {
            manifest: {
                id: 'Tool',
                description: 'Tools visible to the requesting Agent, including scoped and dynamic registrations.',
                methods: [{
                        name: 'listTools',
                        description: 'Return every Tool schema currently callable by this Agent.',
                        inputSchema: EMPTY_INPUT,
                        outputSchema: ANY_OUTPUT,
                    }],
            },
            query(method, _input, context) {
                if (method !== 'listTools')
                    throw new Error(`unknown Tool inspect method "${method}"`);
                return Promise.resolve({ tools: ctx.tools.schemas(context.agent) });
            },
        },
    ];
}
function registration(id, description, method, query, inputSchema = EMPTY_INPUT, outputSchema = ANY_OUTPUT) {
    return {
        manifest: {
            id,
            description,
            methods: [{
                    name: method,
                    description,
                    inputSchema,
                    outputSchema,
                }],
        },
        async query(requested, input) {
            if (requested !== method)
                throw new Error(`unknown ${id} inspect method "${requested}"`);
            return await query(input);
        },
    };
}
function exactInput(field, description) {
    return { type: 'object', properties: { [field]: { type: 'string', description } }, additionalProperties: false };
}
function readExact(input, field) {
    if (input === undefined || input === null || Array.isArray(input) || typeof input !== 'object')
        return undefined;
    const value = input[field];
    return typeof value === 'string' ? value : undefined;
}
//# sourceMappingURL=providers.js.map