/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays), mount the
 * tree over the profile's empty root config, keep the profile patch layer
 * live, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */
import { type Context } from '@deepseek-ai/cordis';
import { type Profile } from '@deepseek-ai/dsh-app-boot';
import { type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment';
import { type ProcessShutdown } from './process-shutdown.ts';
/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export declare function homePatchPath(): string;
/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export declare const INSTALL_ANCHOR: string;
/** Root config filename inside a profile directory. */
export declare const PROFILE_ROOT_FILENAME = "cordis.yml";
/**
 * Load a resolved profile for `name`: heal the shared module fallback, then
 * (re)write the empty root config. The root is always rewritten: the whole
 * composition is patch layers, and the vendored Loader's tree write-back (a
 * plugin self-disposing persists the current tree) can bake composed rows
 * into this file — which would duplicate every bundle insert on the next
 * boot. The file exists on disk only because the Loader needs a real include
 * root to anchor `baseUrl` at the profile directory (the config dump anchors
 * on the same file, so both compose over the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export declare function prepareProfile(name: string, userLayer?: boolean): Profile;
/** Options for {@link runProfile}. */
export interface RunProfileOptions {
    /** This run's frozen environment snapshot, provided before any entry mounts. */
    environment: LaunchEnvironmentSnapshot;
    /** The profile name to boot. */
    profile: string;
    /** `--patch` overlay paths, in argv order. */
    patchFiles: readonly string[];
    /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
    args: readonly string[];
}
/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
export declare function runProfile(options: RunProfileOptions): Promise<{
    ctx: Context;
    shutdown: ProcessShutdown;
}>;
//# sourceMappingURL=profile-boot.d.ts.map