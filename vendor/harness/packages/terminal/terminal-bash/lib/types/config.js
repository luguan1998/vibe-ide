/** Validated configuration for the local PTY backend. */
import z from '@deepseek-ai/schemastery';
/** Schemastery config exposed by the plugin. */
export const Config = z.object({
    backendType: z.string().default('shell'),
    shellPath: z.string().default('/bin/bash'),
    shellArgs: z.array(z.string()).default(['--noprofile', '--norc', '-i']),
    rows: z.number().default(40),
    cols: z.number().default(160),
    scrollbackLines: z.number().default(10_000),
    scrollbackMaxBytes: z.number().default(4 * 1024 * 1024),
    maxReadBytes: z.number().default(256 * 1024),
    pollIntervalMs: z.number().default(50),
    exactProbeAfterMs: z.number().default(150),
    idleSilenceMs: z.number().default(3_000),
    handoffGraceMs: z.number().default(500),
    timeoutMs: z.number().default(30_000),
    disposeGraceMs: z.number().default(3_000),
});
/**
 * Assert every numeric config field is a positive safe integer and bounds compose.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
export function validateConfig(config) {
    const resolved = config;
    if (resolved.backendType.length === 0)
        throw new Error('terminal-bash: backendType must be non-empty');
    if (resolved.shellPath.length === 0)
        throw new Error('terminal-bash: shellPath must be non-empty');
    for (const [name, value] of Object.entries(resolved)) {
        if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
            throw new Error(`terminal-bash: ${name} must be a positive safe integer`);
        }
    }
    if (resolved.maxReadBytes > resolved.scrollbackMaxBytes) {
        throw new Error('terminal-bash: maxReadBytes must not exceed scrollbackMaxBytes');
    }
    if (resolved.handoffGraceMs < resolved.pollIntervalMs) {
        throw new Error('terminal-bash: handoffGraceMs must be at least pollIntervalMs so one readiness poll runs inside the grace window');
    }
}
//# sourceMappingURL=config.js.map