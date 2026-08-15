/**
 * Session-visible workspace instruction state and dynamic reconciliation.
 *
 * @module @deepseek-ai/dsh-agent-instructions/state
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { instructionContentSha1, trimmedInstructionDigest } from "./digest.js";
import { ancestorChain, descendantDirsBetween, findProjectRoot, probeScopeInstruction, readScopeInstruction, relativeDisplay, } from "./files.js";
import { candidateScopeKey, decodeScopeKey, instructionScopeKey, renderInstructionChanges, USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE, } from "./render.js";
export const name = 'agent-instructions';
function workspaceContextHook(text, changes) {
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'agent-instructions', form: 'instructions', changes },
    });
}
/**
 * Build the user-role message for a rendered baseline.
 * @param text - complete plugin-owned system-reminder text.
 * @returns a user-role prefix message.
 */
export function workspaceContextMessage(text) {
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: name },
    });
}
function isWorkspaceContextSource(source) {
    return typeof source === 'object' && source !== null
        && 'kind' in source && source.kind === 'agent-instructions'
        && 'changes' in source && Array.isArray(source.changes);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function workspaceInstructionChanges(source) {
    const changes = [];
    for (const value of source.changes) {
        if (!isRecord(value))
            continue;
        if (value.action !== 'set' && value.action !== 'replace' && value.action !== 'remove')
            continue;
        if (typeof value.scope !== 'string' || typeof value.path !== 'string')
            continue;
        if (value.digest !== undefined && typeof value.digest !== 'string')
            continue;
        changes.push({
            action: value.action,
            scope: value.scope,
            path: value.path,
            ...value.digest !== undefined ? { digest: value.digest } : {},
        });
    }
    return changes;
}
function sameInstructionChange(a, b) {
    return a.action === b.action
        && a.scope === b.scope
        && a.path === b.path
        && a.digest === b.digest;
}
function visibleInstructionChanges(agent, authorityMessages) {
    const visibleSeqs = new Set(agent.session.surface.nodes);
    const visible = new Map();
    for (const [seq, event] of agent.session.events.entries()) {
        if (event.type !== 'user/message' || !isWorkspaceContextSource(event.data.source))
            continue;
        const changes = workspaceInstructionChanges(event.data.source);
        for (const change of changes) {
            if (visibleSeqs.has(seq))
                visible.set(change.scope, change);
        }
    }
    for (const message of authorityMessages) {
        if (!isWorkspaceContextSource(message.source))
            continue;
        for (const change of workspaceInstructionChanges(message.source)) {
            visible.set(change.scope, change);
        }
    }
    return visible;
}
/**
 * Convert retained baseline files into comparison and metadata-cache state.
 * @param files - baseline files that survived rendering.
 * @returns latest baseline changes and provider versions keyed by logical scope.
 */
export function baselineInstructionState(files) {
    const changes = new Map();
    const versions = new Map();
    for (const file of files) {
        const digest = instructionContentSha1(file.content);
        const change = {
            action: 'set',
            scope: instructionScopeKey(file.displayPath),
            path: file.displayPath,
            digest,
        };
        changes.set(change.scope, change);
        if (file.version !== undefined) {
            versions.set(change.scope, {
                path: file.displayPath,
                version: file.version,
                digest,
                trimmedDigest: trimmedInstructionDigest(file.content),
            });
        }
    }
    return { changes, versions };
}
function versionStatesFor(session, cache) {
    let states = cache.get(session);
    if (states === undefined) {
        states = new Map();
        cache.set(session, states);
    }
    return states;
}
/**
 * Keep only cache updates represented by rendered changes.
 * @param updates - proposed updates from one or more reconciliations.
 * @param renderedChanges - transitions retained by the renderer.
 * @returns updates represented by an exact retained transition.
 */
export function retainedInstructionVersionUpdates(updates, renderedChanges) {
    return updates.filter(update => renderedChanges.some(change => sameInstructionChange(update.change, change)));
}
/**
 * Apply metadata-cache transitions without retaining instruction prose.
 * @param session - owning session.
 * @param updates - ordered set/delete transitions.
 * @param cache - session-isolated metadata cache.
 */
export function applyInstructionVersionUpdates(session, updates, cache) {
    if (updates.length === 0)
        return;
    const states = versionStatesFor(session, cache);
    for (const update of updates) {
        if (update.state === undefined)
            states.delete(update.change.scope);
        else
            states.set(update.change.scope, update.state);
    }
    if (states.size === 0)
        cache.delete(session);
}
function relativeScope(projectRoot, dir) {
    const scope = relativeDisplay(projectRoot, dir);
    return scope.length === 0 ? '.' : scope;
}
/**
 * Compare visible state with provider-visible files and render transitions.
 * @param agent - session owner whose visible surface supplies durable state.
 * @param resolved - normalized plugin configuration.
 * @param versionCache - per-session scope metadata used to skip unchanged reads.
 * @param fileSystem - provider used for current file probes.
 * @param options - authoritative claimed context, pending scope hints, touched paths, and baseline participation.
 * @returns rendered context plus deferred cache updates, or undefined when unchanged/unavailable.
 */
export async function reconcileInstructionContext(agent, resolved, versionCache, fileSystem, options) {
    const session = agent.session;
    const effective = visibleInstructionChanges(agent, options.authorityMessages);
    /* v8 ignore next -- normal agents carry an absolute session cwd. */
    const cwd = session.header.cwd ?? process.cwd();
    // TODO(frozen-project-root): retain the baseline root for the loop instance;
    // recomputing it after marker edits reinterprets the existing relative scope keys.
    const projectRoot = options.projectRoot
        ?? await findProjectRoot(cwd, resolved.projectRootMarkers, fileSystem, options.signal);
    const scopes = new Set();
    const baselineScopes = new Set();
    const addDirScopes = (target, directory) => {
        for (const candidate of resolved.instructionFileCandidates)
            target.add(candidateScopeKey(directory, candidate));
        for (const candidate of resolved.localInstructionFileCandidates)
            target.add(candidateScopeKey(directory, candidate));
    };
    const addProjectScopes = (target, dir) => {
        addDirScopes(target, relativeScope(projectRoot, dir));
    };
    baselineScopes.add(candidateScopeKey(USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE));
    for (const dir of ancestorChain(projectRoot, cwd))
        addProjectScopes(baselineScopes, dir);
    if (options.includeBaselineScopes) {
        for (const scope of baselineScopes)
            scopes.add(scope);
    }
    for (const message of options.scopeMessages) {
        /* v8 ignore next -- the plugin passes its workspace-only pending projection. */
        if (!isWorkspaceContextSource(message.source))
            continue;
        for (const change of workspaceInstructionChanges(message.source)) {
            if (!options.includeBaselineScopes && baselineScopes.has(change.scope))
                continue;
            scopes.add(change.scope);
        }
    }
    for (const scope of effective.keys()) {
        if (!options.includeBaselineScopes && baselineScopes.has(scope))
            continue;
        const { directory } = decodeScopeKey(scope);
        if (directory === USER_GLOBAL_DIRECTORY)
            scopes.add(candidateScopeKey(USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE));
        else
            addDirScopes(scopes, directory);
    }
    for (const touchedPath of options.touchedPaths) {
        for (const dir of descendantDirsBetween(cwd, touchedPath))
            addProjectScopes(scopes, dir);
    }
    const versions = versionStatesFor(session, versionCache);
    const seenAbsolutePaths = new Set();
    // Per-directory trimmed-content identities kept so far this pass, iterated in
    // candidate order (base before local); a later sibling matching an earlier one
    // is a duplicate and is dropped or removed rather than rendered twice.
    const keptTrimmedByDir = new Map();
    const registerKeptTrimmed = (directory, digest) => {
        let digests = keptTrimmedByDir.get(directory);
        if (digests === undefined) {
            digests = new Set();
            keptTrimmedByDir.set(directory, digests);
        }
        if (digests.has(digest))
            return true;
        digests.add(digest);
        return false;
    };
    const items = [];
    const versionUpdates = [];
    const pushRemoval = (scope, path) => {
        const change = { action: 'remove', scope, path };
        items.push({ change, file: { absolutePath: `removed:${scope}`, displayPath: path, content: '' } });
        versionUpdates.push({ change });
    };
    const scopesByDirectory = new Map();
    for (const scope of scopes) {
        const { directory } = decodeScopeKey(scope);
        const directoryScopes = scopesByDirectory.get(directory);
        if (directoryScopes === undefined)
            scopesByDirectory.set(directory, [scope]);
        else
            directoryScopes.push(scope);
    }
    for (const [directory, directoryScopes] of scopesByDirectory) {
        const probedScopes = [];
        for (const scope of directoryScopes) {
            if (options.excludedBaselineScopes !== undefined
                && baselineScopes.has(scope)
                && options.excludedBaselineScopes.has(scope)) {
                const previous = effective.get(scope);
                if (previous === undefined || previous.action === 'remove')
                    versions.delete(scope);
                else
                    pushRemoval(scope, previous.path);
            }
            else {
                probedScopes.push(scope);
            }
        }
        const itemStart = items.length;
        const versionUpdateStart = versionUpdates.length;
        const addedAbsolutePaths = [];
        const priorVersions = new Map(probedScopes.map(scope => [scope, versions.get(scope)]));
        for (const scope of probedScopes) {
            const previous = effective.get(scope);
            const probe = await probeScopeInstruction(scope, projectRoot, resolved, fileSystem, options.signal);
            if (probe.kind === 'unavailable') {
                if (previous === undefined || previous.action === 'remove')
                    continue;
                // Same-directory candidates form one deduplicated authority group. If an
                // active member cannot be observed, preserve the entire last-good group;
                // cache warmth must never decide whether a sibling transition is emitted.
                items.splice(itemStart);
                versionUpdates.splice(versionUpdateStart);
                for (const [candidateScope, prior] of priorVersions) {
                    if (prior === undefined)
                        versions.delete(candidateScope);
                    else
                        versions.set(candidateScope, prior);
                }
                for (const absolutePath of addedAbsolutePaths)
                    seenAbsolutePaths.delete(absolutePath);
                keptTrimmedByDir.delete(directory);
                break;
            }
            if (probe.kind === 'absent') {
                if (previous === undefined || previous.action === 'remove')
                    versions.delete(scope);
                else
                    pushRemoval(scope, previous.path);
                continue;
            }
            const { file: probedFile } = probe;
            if (seenAbsolutePaths.has(probedFile.absolutePath))
                continue;
            seenAbsolutePaths.add(probedFile.absolutePath);
            addedAbsolutePaths.push(probedFile.absolutePath);
            const cached = versions.get(scope);
            if (cached !== undefined
                && cached.path === probedFile.displayPath
                && cached.version === probedFile.version
                && previous !== undefined
                && previous.action !== 'remove'
                && previous.path === cached.path
                && previous.digest === cached.digest) {
                // Unchanged and previously rendered: keep it, but an earlier sibling that
                // now matches its trimmed content makes this the duplicate to remove.
                if (registerKeptTrimmed(directory, cached.trimmedDigest))
                    pushRemoval(scope, previous.path);
                continue;
            }
            const file = await readScopeInstruction(probedFile, resolved.maxSourceBytes, fileSystem, options.signal);
            if (file === undefined)
                continue;
            const currentDigest = instructionContentSha1(file.content);
            const trimmedDigest = trimmedInstructionDigest(file.content);
            if (registerKeptTrimmed(directory, trimmedDigest)) {
                // A distinct file whose trimmed content already appeared earlier in this
                // directory: drop it, removing any copy that was previously rendered.
                if (previous !== undefined && previous.action !== 'remove')
                    pushRemoval(scope, previous.path);
                else
                    versions.delete(scope);
                continue;
            }
            const nextVersion = {
                path: file.displayPath,
                version: probedFile.version,
                digest: currentDigest,
                trimmedDigest,
            };
            if (previous !== undefined && previous.action !== 'remove' && previous.path === file.displayPath && previous.digest === currentDigest) {
                versions.set(scope, nextVersion);
                continue;
            }
            const action = previous === undefined || previous.action === 'remove' ? 'set' : 'replace';
            const change = {
                action,
                scope,
                path: file.displayPath,
                digest: currentDigest,
            };
            items.push({ change, file });
            versionUpdates.push({ change, state: nextVersion });
        }
    }
    if (items.length === 0)
        return undefined;
    const rendered = renderInstructionChanges(items, resolved.maxBytes);
    // When no transition survived rendering (tiny budgets render notice-only
    // text), emit nothing and commit nothing — the uncommitted versions make the
    // next pass retry instead of spamming notice-only contexts.
    if (rendered.text.length === 0 || rendered.changes.length === 0)
        return undefined;
    return {
        context: workspaceContextHook(rendered.text, rendered.changes),
        versionUpdates: retainedInstructionVersionUpdates(versionUpdates, rendered.changes),
    };
}
//# sourceMappingURL=state.js.map