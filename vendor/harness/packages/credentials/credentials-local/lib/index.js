import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { watch } from "chokidar";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Document, parseDocument } from "yaml";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { canonicalizeWatchPath, resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { CredentialProvider, credentialRef } from "@deepseek-ai/dsh-credentials";
//#region lib/types/index.js
/**
* File-backed credentials provider over `$DSH_HOME/.credentials.yaml`, layered
* against the environment by how much each layer is trusted:
*
* ```text
* inherited process environment      (read-only, wins)
* > $DSH_HOME/.credentials.yaml      (provider-managed, writable)
* > <invocation cwd>/.env            (read-only fallback)
* > $DSH_HOME/.env                   (read-only fallback)
* ```
*
* The inherited environment wins because `DEEPSEEK_API_KEY=… dsh`, a CI
* secret, or a container `-e` is this run's explicit intent; it cannot be
* edited from inside, so it must be *visibly* read-only rather than silently
* shadow writes. Everything below it loses to the managed store, so a key the
* Models page writes takes effect immediately even when an older key sits in
* the user's `.env`.
*
* The invoking project may supply a key, because the product trusts the
* project it is launched in. It ranks below the managed store, so a key stored
* through the Models page is never displaced by one a checkout happens to carry.
*
* The file is the provider-managed writable source: every write re-reads the
* document under a cross-process writer lock before patching only its own key
* — comments and the formatting of every untouched entry survive — external
* edits hot-publish through the seam, and each reload replaces the snapshot
* wholesale so a deleted entry never lingers in memory.
*
* The document holds nothing but credentials, which is why it is a strict
* `CredentialRef`-to-string mapping rather than a dotenv file: a store the
* Harness owns and never materializes into the environment cannot also serve
* as the user's environment layer; a store that doubled as the environment
* layer would shadow non-secret entries behind its precedence, making them
* silently unreachable.
* @module @deepseek-ai/dsh-credentials-local
*/
/** Basename of the credentials document inside the harness home. */
const CREDENTIALS_FILENAME = ".credentials.yaml";
/**
* Resolve the runtime spec from plugin config: an explicit `path` wins,
* otherwise the document lives at `<harness home>/.credentials.yaml`.
* @param config - raw plugin config.
* @returns the resolved file location and watch behavior.
*/
function resolveSpec(config) {
	return {
		filename: resolve(config.path ?? join(resolveDshHome(config.dshHome), ".credentials.yaml")),
		watch: config.watch ?? true,
		debounceMs: config.debounceMs ?? 100
	};
}
/** Permission bits outside the owner; a credentials document must have none of them. */
const GROUP_OTHER_BITS = 63;
/**
* Reject a credentials document other OS users can read, before its contents
* are read at all. The provider creates and replaces the file at `0600`, but a
* hand-written or externally generated one carries whatever umask produced it,
* and silently serving secrets out of a world-readable file would make the
* mode the provider promises meaningless.
*
* POSIX only: Windows has no mode to inspect — its ACLs are not expressible
* here — so the check is skipped rather than faked, and the file's protection
* there is whatever the create and replace APIs express.
* @param filename - absolute path of the document.
* @throws when the path hierarchy is invalid or the file exists with group or other permission bits set.
*/
async function assertOwnerOnly(filename) {
	let mode;
	try {
		mode = (await stat(filename)).mode;
	} catch (error) {
		if (!isENOENT(error)) throw error;
		await canonicalizeWatchPath(filename);
		return;
	}
	/* v8 ignore next -- POSIX coverage cannot take the Windows peer; native Windows coverage does. */
	if (process.platform === "win32") return;
	if ((mode & GROUP_OTHER_BITS) === 0) return;
	throw new Error(`credentials-local: ${filename} is readable beyond its owner (mode ${(mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
	/* v8 ignore stop */
}
/** Whether a filesystem error means absence; every non-ENOENT failure must surface. */
function isENOENT(error) {
	return error?.code === "ENOENT";
}
/**
* Describe one YAML parse failure without quoting the source. The parser's own
* message embeds the offending line, which here holds a secret.
* @param error - the parser's error.
* @returns the error code with its line and column.
*/
function describeYamlError(error) {
	const at = error.linePos?.[0];
	/* v8 ignore next -- `prettyErrors` populates linePos on every error; the guard answers its optional type */
	const where = at === void 0 ? "" : ` at line ${String(at.line)}, column ${String(at.col)}`;
	return `${error.code}${where}`;
}
/**
* Parse one credentials document into its entries. The document is a strict
* mapping of {@link CredentialRef} to non-empty string: a non-mapping root, a
* key that is not a POSIX identifier, a non-string value, and an empty string
* are all rejected rather than skipped, because this file holds nothing but
* credentials and a silently ignored entry reads as "the key I stored has no
* effect". Duplicate keys surface as parser errors. An empty document is an
* empty store.
* @param text - the document's text.
* @param filename - absolute path, quoted in errors.
* @returns the parsed entries, keyed by reference.
*/
function parseCredentialsDocument(text, filename) {
	const document = parseDocument(text, {
		prettyErrors: true,
		uniqueKeys: true
	});
	if (document.errors.length > 0) throw new Error(`credentials-local: invalid document at ${filename}: ${document.errors.map(describeYamlError).join("; ")}`);
	const root = document.toJS() ?? {};
	if (typeof root !== "object" || root === null || Array.isArray(root)) throw new TypeError(`credentials-local: ${filename} must be a mapping of credential reference to value`);
	const entries = /* @__PURE__ */ new Map();
	for (const [key, value] of Object.entries(root)) {
		credentialRef(key);
		if (typeof value !== "string") throw new TypeError(`credentials-local: the value for "${key}" in ${filename} must be a string`);
		if (value.length === 0) throw new Error(`credentials-local: the value for "${key}" in ${filename} is empty; remove the key instead`);
		entries.set(key, value);
	}
	return entries;
}
/**
* Render the next document text with one reference set or deleted. Editing
* the parsed document rather than rebuilding it keeps comments and the
* formatting of every untouched entry; an absent document starts a fresh one.
* @param text - the current document text, `undefined` while the file is absent.
* @param ref - the reference to write.
* @param value - the new value, or `undefined` to delete the key.
* @returns the text to persist.
*/
function renderDocument(text, ref, value) {
	const document = text === void 0 ? new Document({}) : parseDocument(text);
	if (value === void 0) document.deleteIn([ref]);
	else document.setIn([ref], value);
	return document.toString();
}
/** File-backed credentials provider (`$DSH_HOME/.credentials.yaml`). */
var LocalCredentialProvider = class extends CredentialProvider {
	config;
	static Config = z.object({
		path: z.string(),
		dshHome: z.string(),
		watch: z.boolean().default(true),
		debounceMs: z.number().min(0).default(100)
	});
	spec;
	/**
	* Raw text of the last read or persisted document; `undefined` while the
	* file is absent. Watcher events whose content equals this cache are no-ops,
	* which is also the self-write suppression.
	*/
	text;
	/** Parsed document snapshot; replaced wholesale on every reload. */
	values = /* @__PURE__ */ new Map();
	/**
	* Single exclusive operation chain: watcher reloads and line edits run one
	* at a time in queue order (settled tail), so an edit can never render from
	* text a concurrent reload is busy replacing.
	*/
	operations = Promise.resolve();
	/** Set at dispose: refuse new writes and let in-flight work no-op. */
	closed = false;
	/** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
	isClosed() {
		return this.closed;
	}
	constructor(ctx, config) {
		super(ctx);
		this.config = config;
		this.spec = resolveSpec(config);
	}
	/** The inherited-environment value for a reference, or `undefined` when empty or unset. */
	inherited(ref) {
		const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ["process"]);
		return entry !== void 0 && entry.value.length > 0 ? entry.value : void 0;
	}
	/**
	* The `.env` fallback for a reference — below the managed store, never above
	* it. The invoking project ranks over the user's home file, matching the
	* environment layering: the more specific location wins.
	*/
	dotenvFallback(ref) {
		const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ["project-env", "user-env"]);
		return entry !== void 0 && entry.value.length > 0 ? entry : void 0;
	}
	async *[Service.init]() {
		yield async () => {
			this.closed = true;
			await this.operations;
		};
		await this.loadInitial();
		if (!this.spec.watch) return;
		const watcher = watch(await canonicalizeWatchPath(this.spec.filename), {
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: this.spec.debounceMs,
				pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10))
			}
		});
		watcher.on("all", () => {
			if (this.closed) return;
			this.queueRefresh();
		});
		watcher.on("ready", () => {
			if (this.closed) return;
			this.queueRefresh();
		});
		watcher.on("error", (error) => {
			this.ctx.logger.warn("credentials-local: watcher error on %s", this.spec.filename);
			this.ctx.logger.warn(error);
		});
		yield async () => {
			this.closed = true;
			await watcher.close();
			await this.operations;
		};
	}
	resolve(ref) {
		const inherited = this.inherited(ref);
		if (inherited !== void 0) return Promise.resolve({
			value: inherited,
			source: "env"
		});
		const stored = this.values.get(ref);
		if (stored !== void 0) return Promise.resolve({
			value: stored,
			source: "file"
		});
		const fallback = this.dotenvFallback(ref);
		if (fallback !== void 0) return Promise.resolve({
			value: fallback.value,
			source: fallback.source
		});
		return Promise.resolve(void 0);
	}
	describe(ref) {
		if (this.inherited(ref) !== void 0) return Promise.resolve({
			configured: true,
			source: "env",
			writable: false
		});
		if (this.values.get(ref) !== void 0) return Promise.resolve({
			configured: true,
			source: "file",
			writable: true
		});
		const fallback = this.dotenvFallback(ref);
		if (fallback !== void 0) return Promise.resolve({
			configured: true,
			source: fallback.source,
			writable: true
		});
		return Promise.resolve({
			configured: false,
			writable: true
		});
	}
	async set(ref, value) {
		if (value.length === 0) throw new Error(`credentials-local: an empty value cannot be stored for "${ref}"; use unset`);
		await this.write(ref, value);
	}
	async unset(ref) {
		await this.write(ref, void 0);
	}
	/** Queue one exclusive document operation behind every earlier one. */
	enqueue(operation) {
		const task = this.operations.then(operation);
		this.operations = task.then(() => void 0, () => void 0);
		return task;
	}
	/** Queue a reload; only an invariant violation escaping the fan-out can reject it. */
	queueRefresh() {
		this.enqueue(() => this.refresh()).catch((error) => {
			this.ctx.logger.error("credentials-local: reload commit failed at %s", this.spec.filename);
			this.ctx.logger.error(error);
		});
	}
	/** Queue one line edit; entry checks reject early, the queue re-judges them at run time. */
	async write(ref, value) {
		const verb = value === void 0 ? "unset" : "set";
		if (this.isClosed()) throw new Error(`credentials-local is disposed: cannot ${verb} "${ref}"`);
		this.assertUnshadowed(ref, verb);
		return this.enqueue(async () => {
			if (this.isClosed()) throw new Error(`credentials-local was disposed before the queued "${ref}" ${verb} ran`);
			this.assertUnshadowed(ref, verb);
			await mkdir(dirname(this.spec.filename), {
				recursive: true,
				mode: 448
			});
			await withFileLock(this.spec.filename, async () => {
				await this.reconcileFromDisk();
				const existing = this.values.get(ref);
				if (value === void 0 && existing === void 0) return;
				const nextText = renderDocument(this.text, ref, value);
				await writeFileAtomic(this.spec.filename, nextText, {
					mode: 384,
					dirMode: 448
				});
				this.text = nextText;
				if (value === void 0) this.values.delete(ref);
				else this.values.set(ref, value);
				this.notifyUpdated(ref);
			});
		});
	}
	/**
	* Reject a write the inherited environment would shadow into apparent
	* no-effect. Only that layer can shadow a write: everything else this
	* provider resolves ranks below the document being written.
	*/
	assertUnshadowed(ref, verb) {
		if (this.inherited(ref) !== void 0) throw new Error(`credentials-local: "${ref}" is supplied read-only by the launching environment, so ${verb} would be shadowed; unset it in the shell you start dsh from instead`);
	}
	/**
	* Boot read: an absent file is an empty store; an invalid one fails the
	* plugin's activation, because a credentials document that exists but
	* cannot be trusted must never be treated as "no credentials stored".
	*/
	async loadInitial() {
		await assertOwnerOnly(this.spec.filename);
		let text;
		try {
			text = await readFile(this.spec.filename, "utf8");
		} catch (error) {
			if (!isENOENT(error)) throw error;
			return;
		}
		this.values = parseCredentialsDocument(text, this.spec.filename);
		this.text = text;
	}
	/**
	* Re-read the document after a watcher event. Unchanged content (including
	* this provider's own writes) is a no-op; an unreadable document keeps the
	* last good snapshot and warns — a live hot-reload must never take the
	* process down. An invariant violation escaping the fan-out is not a reload
	* failure and propagates to the queue's error surface.
	*/
	async refresh() {
		if (this.closed) return;
		try {
			await this.reconcileFromDisk();
		} catch (error) {
			if (error?.code === "INVARIANT") throw error;
			this.ctx.logger.warn("credentials-local: reload failed at %s; keeping the last good document", this.spec.filename);
			this.ctx.logger.warn(error);
		}
	}
	/**
	* Compare the on-disk text against the cache and publish any difference
	* into the seam. Absence publishes the empty store; an unreadable or
	* invalid document throws, so each caller picks its policy — a reload warns
	* and keeps the last good snapshot, a write fails loud rather than
	* overwriting a document it could not understand.
	*/
	async reconcileFromDisk() {
		await assertOwnerOnly(this.spec.filename);
		let text;
		try {
			text = await readFile(this.spec.filename, "utf8");
		} catch (error) {
			if (!isENOENT(error)) throw error;
			text = void 0;
		}
		if (text === this.text || this.isClosed()) return;
		const next = text === void 0 ? /* @__PURE__ */ new Map() : parseCredentialsDocument(text, this.spec.filename);
		const changed = this.changedRefs(this.values, next);
		this.text = text;
		this.values = next;
		for (const ref of changed) this.notifyUpdated(ref);
	}
	/** Entries whose stored value changed; the parser has already proven every key addressable. */
	changedRefs(prev, next) {
		const changed = [];
		for (const key of new Set([...prev.keys(), ...next.keys()])) {
			if (prev.get(key) === next.get(key)) continue;
			changed.push(credentialRef(key));
		}
		return changed;
	}
};
//#endregion
export { CREDENTIALS_FILENAME, LocalCredentialProvider, LocalCredentialProvider as default, parseCredentialsDocument, resolveSpec };
