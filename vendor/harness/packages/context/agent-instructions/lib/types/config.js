/**
 * Configuration normalization for workspace instruction discovery and rendering.
 *
 * @module @deepseek-ai/dsh-agent-instructions/config
 */
import { relative } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'];
const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'];
const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'];
const DEFAULT_MAX_SOURCE_BYTES = 1_048_576;
const RESERVED_PATH_SEGMENTS = new Set(['', '.', '..']);
export const Config = z.object({
    dshHome: z.string(),
    projectRootMarkers: z.array(z.string()).default([...DEFAULT_PROJECT_ROOT_MARKERS]),
    maxBytes: z.number().required(),
    maxSourceBytes: z.number().step(1).min(1).default(DEFAULT_MAX_SOURCE_BYTES),
    instructionFileCandidates: z.array(z.string()).default([...DEFAULT_INSTRUCTION_FILE_CANDIDATES]),
    localInstructionFileCandidates: z.array(z.string()).default([...DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES]),
});
/**
 * Identify the discovery, precedence, and budget semantics of one baseline.
 * @param config - normalized plugin configuration.
 * @param cwd - absolute session working directory.
 * @param projectRoot - project root selected for the current baseline.
 * @returns stable serialized identity for compatibility checks on resume.
 */
export function workspaceBaselineIdentity(config, cwd, projectRoot) {
    return JSON.stringify({
        projectRoot: relative(cwd, projectRoot),
        projectRootMarkers: config.projectRootMarkers,
        maxBytes: config.maxBytes,
        maxSourceBytes: config.maxSourceBytes,
        instructionFileCandidates: config.instructionFileCandidates,
        localInstructionFileCandidates: config.localInstructionFileCandidates,
    });
}
/**
 * Resolve defaults, the harness home, and valid same-directory candidates.
 * @param config - user-facing plugin configuration.
 * @returns normalized runtime configuration.
 */
export function resolveConfig(config) {
    return {
        ...resolveDiscoveryConfig(config),
        maxBytes: config.maxBytes,
        maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    };
}
/**
 * Resolve the subset of configuration used before instruction content is rendered.
 * @param config - optional discovery controls.
 * @returns normalized home, root markers, and instruction candidates.
 */
export function resolveDiscoveryConfig(config) {
    return {
        dshHome: resolveDshHome(config.dshHome),
        projectRootMarkers: config.projectRootMarkers ?? [...DEFAULT_PROJECT_ROOT_MARKERS],
        instructionFileCandidates: resolveInstructionFileCandidates(config.instructionFileCandidates, DEFAULT_INSTRUCTION_FILE_CANDIDATES),
        localInstructionFileCandidates: resolveInstructionFileCandidates(config.localInstructionFileCandidates, DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES),
    };
}
function resolveInstructionFileCandidates(candidates, fallback) {
    return (candidates ?? [...fallback]).filter(candidate => (!RESERVED_PATH_SEGMENTS.has(candidate) && !/[\\/]/.test(candidate)));
}
//# sourceMappingURL=config.js.map