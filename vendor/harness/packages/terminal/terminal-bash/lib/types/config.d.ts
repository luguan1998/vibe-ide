/** Validated configuration for the local PTY backend. */
import z from '@deepseek-ai/schemastery';
/** Public plugin configuration. */
export interface Config {
    /** Backend registry type (default: `shell`). */
    backendType?: string;
    /** Interactive shell executable (default: `/bin/bash`). */
    shellPath?: string;
    /** Shell arguments (default: `--noprofile --norc -i`). */
    shellArgs?: string[];
    /** Terminal rows. */
    rows?: number;
    /** Terminal columns. */
    cols?: number;
    /** Maximum retained logical lines. */
    scrollbackLines?: number;
    /** Maximum retained UTF-8 bytes. */
    scrollbackMaxBytes?: number;
    /** Maximum bytes returned by one read or settled viewport. */
    maxReadBytes?: number;
    /** Readiness polling interval. */
    pollIntervalMs?: number;
    /** Delay before Linux exact syscall probes. */
    exactProbeAfterMs?: number;
    /** Silence duration that yields `inferred_idle`. */
    idleSilenceMs?: number;
    /**
     * Extra wait beyond `idleSilenceMs`, once a prompt marker was seen, for the shell to
     * regain the foreground before `inferred_idle` settles; at least one `pollIntervalMs`.
     */
    handoffGraceMs?: number;
    /** Absolute send wait bound. */
    timeoutMs?: number;
    /** Grace before teardown escalates to `SIGKILL`. */
    disposeGraceMs?: number;
}
/** Configuration after Schemastery defaults. */
export type ResolvedConfig = Required<Config>;
/** Schemastery config exposed by the plugin. */
export declare const Config: z<Config>;
/**
 * Assert every numeric config field is a positive safe integer and bounds compose.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
export declare function validateConfig(config: Config): asserts config is ResolvedConfig;
//# sourceMappingURL=config.d.ts.map