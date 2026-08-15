/**
 * Profile discovery, initialization, and patch-layer composition for the
 * `dsh --profile` launcher family.
 *
 * A profile is a directory under `$DSH_HOME/profiles/<name>` holding a
 * `package.json` (out-of-tree plugin dependencies plus the profile manifest
 * `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml`
 * (the user's own patch layer, applied after every bundle layer). Bundles are
 * npm packages whose manifest declares
 * `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the tree is
 * composed by applying each bundle's patch list in `dsh.profile.bundles` order over
 * an empty entry list, then the profile's own patches, then any launcher
 * layers (`--patch` files and flag-derived patches).
 *
 * Module resolution is two-anchor by construction: a bundle name resolves
 * first from the dsh installation (the launcher's own package), then from the
 * profile directory. The Loader's `baseUrl` is the profile directory, whose
 * `node_modules` pnpm manages for out-of-tree plugins, while the maintained
 * flat fallback directory `$DSH_HOME/profiles/node_modules` (one symlink per
 * package the installation's app and bundles depend on) makes every in-box
 * plugin Node-resolvable from any profile through the ordinary parent-walk.
 * @module @deepseek-ai/dsh-app-boot/profile
 */
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader';
import { type PatchOptions } from '@deepseek-ai/cordis-plugin-include';
/** Directory under the Harness home holding every profile. */
export declare const PROFILES_DIR = "profiles";
/** The user patch layer inside a profile directory (hot-reloaded on long-lived surfaces). */
export declare const PROFILE_PATCH_FILENAME = "cordis.patch.yml";
/** The bundle half of the `dsh` manifest section: what a bundle package exports. */
export interface DshBundleManifest {
    /** The patch layer this bundle exports, relative to its package root. */
    patch: string;
}
/** The profile half of the `dsh` manifest section: what a profile directory composes. */
export interface DshProfileManifest {
    /** Ordered bundle layer list (package names). */
    bundles?: string[];
}
/**
 * The profile-launcher slice of the `dsh`-owned package.json section. A
 * manifest may declare both roles; other consumers own additional keys.
 */
export interface DshManifestSection {
    /** Bundle metadata consumed by the profile launcher. */
    bundle?: DshBundleManifest;
    /** Profile metadata consumed by the profile launcher. */
    profile?: DshProfileManifest;
}
/** The slice of package.json both profiles and bundles use. */
export interface ProfileManifest {
    name?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    dsh?: DshManifestSection;
}
/** One resolved bundle layer of a profile. */
export interface ProfileLayer {
    /** The bundle's package name, as listed in `dsh.profile.bundles`. */
    packageName: string;
    /** Absolute directory of the resolved bundle package. */
    packageDir: string;
    /** Absolute path of the bundle's patch file. */
    patchPath: string;
    /** The parsed patch list. */
    patches: PatchOptions[];
}
/** A loaded profile: resolved bundle layers plus the user's own patch layer. */
export interface Profile {
    /** The profile name (its directory basename). */
    name: string;
    /** Absolute profile directory. */
    dir: string;
    /** Bundle layers in `dsh.profile.bundles` order. */
    layers: ProfileLayer[];
    /** Absolute path of the profile's own patch file. */
    patchPath: string;
    /** The profile's own patches; empty when the file is absent. */
    patches: PatchOptions[];
}
/**
 * Resolve a profile's directory under the Harness home.
 * @param name - the profile name (`dsh --profile <name>`).
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @returns the absolute profile directory (which may not exist yet).
 */
export declare function resolveProfileDir(name: string, home?: string): string;
/** The shipped profile templates auto-initialized on first use, by name. */
export declare const PROFILE_TEMPLATES: Record<string, readonly string[]>;
/** The bundle list a `dsh plugin` init uses for a name with no shipped template. */
export declare const DEFAULT_PROFILE_BUNDLES: readonly string[];
/**
 * Initialize a profile directory: manifest, empty user patch layer, and the
 * pnpm settings out-of-tree plugins need. Existing files are never touched,
 * so re-running is a no-op on an initialized profile.
 * @param dir - the profile directory from {@link resolveProfileDir}.
 * @param bundles - the initial `dsh.profile.bundles` layer list.
 */
export declare function initProfile(dir: string, bundles: readonly string[]): void;
/**
 * Maintain the flat module fallback `$DSH_HOME/profiles/node_modules`: one
 * symlink per package in the dsh app's resolvable dependency CLOSURE (BFS
 * over `dependencies` from the app manifest), each resolved from its own
 * real location. Node's parent-directory walk from any profile finds this
 * directory after the profile's own `node_modules`, so every in-box plugin
 * resolves without pnpm ever managing it — the exact "bundles come from the
 * installation" contract. The closure (not just direct dependencies) is
 * required for out-of-tree plugins: their peer dependencies name Service
 * Definition packages (`dsh-compaction`, `dsh-invariants`, ...) that the app
 * reaches only through its Service Provider packages. Symlinked packages
 * resolve their own dependencies from their real directories (Node's default
 * symlink-following), so each package needs only its one flat link.
 * Idempotent: correct links are kept and moved installations are
 * re-pointed; a stale link to a vanished package stays until its name is
 * reused (dangling links are invisible to resolution).
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 */
export declare function healProfilesModuleFallback(installAnchor: string, home?: string): void;
/**
 * Read a profile's manifest.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param dir - the profile directory.
 * @returns the parsed manifest.
 */
export declare function readProfileManifest(binName: string, dir: string): ProfileManifest;
/**
 * Write a profile's manifest back (2-space JSON, trailing newline).
 * @param dir - the profile directory.
 * @param manifest - the manifest value to persist.
 */
export declare function writeProfileManifest(dir: string, manifest: ProfileManifest): void;
/**
 * Resolve one bundle package's directory: installation anchor first, then the
 * profile directory. The installation-first order is the contract that
 * `@deepseek-ai/dsh-base` (and every other in-box bundle) always comes from
 * the same installation as the running dsh, never from a profile-local copy.
 * Resolution does not require the package to export `./package.json`.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param packageName - the bundle's package name from `dsh.profile.bundles`.
 * @param installAnchor - absolute path of a file inside the dsh app package (its package.json).
 * @param profileDir - the profile directory (second anchor).
 * @returns the bundle package's absolute directory.
 */
export declare function resolveBundleDir(binName: string, packageName: string, installAnchor: string, profileDir: string): string;
/**
 * Load a profile: resolve every `dsh.profile.bundles` entry to its patch
 * layer and parse the profile's own patch file. A listed bundle without a
 * `dsh.bundle` manifest fails loud — naming a bundle-less package as a layer
 * is a misconfiguration, not "no patches".
 * @param binName - the diagnostic prefix on thrown errors.
 * @param name - the profile name.
 * @param installAnchor - absolute path of the dsh app's package.json (first resolution anchor).
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @param options - `userLayer: false` skips reading `cordis.patch.yml`, so a
 * bundles-only consumer (`--dump-default-config`, a recovery diagnostic)
 * cannot fail on a broken user layer.
 * @returns the loaded profile (empty `patches` when the user layer is skipped).
 */
export declare function loadProfile(binName: string, name: string, installAnchor: string, home?: string, options?: {
    userLayer?: boolean;
}): Profile;
/**
 * Compose patch layers into the effective entry list over an empty root —
 * the same single `applyEntryPatches` call the boot include makes, so flag
 * derivation and config dumps see exactly what mounts.
 * @param layers - patch lists in application order.
 * @param warn - sink for skipped-patch diagnostics; defaults to silent (boot repeats them).
 * @returns the composed entry list.
 */
export declare function composeEntries(layers: readonly PatchOptions[][], warn?: (message: string) => void): EntryOptions[];
//# sourceMappingURL=profile.d.ts.map