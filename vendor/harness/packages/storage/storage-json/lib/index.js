import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from "@deepseek-ai/dsh-storage";
import { randomUUID } from "node:crypto";
//#region lib/types/atomic.js
/**
* Atomic whole-file replacement for the JSON backend.
*
* Publish protocol: write a same-directory temp file, fsync it, then
* `rename()` over the target. Rename is an atomic replace on POSIX and on
* Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
* and replacement is the intended semantic here — unlike the session-log
* backend's link()+unlink() no-clobber protocol, a unit file has exactly one
* writer per process and last-write-wins is correct. After the rename the
* parent directory is fsynced on POSIX so the new entry is crash-durable.
* @module @deepseek-ai/dsh-storage-json/src/atomic
*/
/**
* Durably replace `path` with `data`.
* @param path - Absolute target file path.
* @param data - Full new file content.
* @returns resolution after the replacement is crash-durable.
*/
async function writeAtomic(path, data) {
	const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		const handle = await open(tmp, "wx", 384);
		try {
			await handle.writeFile(data, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(tmp, path);
		await fsyncDirectory(dirname(path));
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}
/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path) {
	if (process.platform === "win32") return;
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
/* v8 ignore stop */
//#endregion
//#region lib/types/format.js
/**
* On-disk JSON unit format: the file is always the current net state, kept
* human-readable (pretty-printed, stable key order from insertion) — that
* legibility is this backend's reason to exist.
* @module @deepseek-ai/dsh-storage-json/src/format
*/
/**
* Serialize a unit state to file content.
* @param name - Unit name, stamped into the header.
* @param state - Authoritative in-memory state.
* @returns pretty-printed JSON document with a trailing newline.
*/
function serialize(name, state) {
	const tables = {};
	for (const [table, records] of state.tables) tables[table] = Object.fromEntries(records);
	const document = {
		unit: {
			name,
			version: state.version
		},
		global: state.global,
		tables
	};
	return `${JSON.stringify(document, null, 2)}\n`;
}
/**
* Parse file content into unit state, validating shape and version.
* @param text - Raw file content.
* @param descriptor - Expected identity; version mismatch rejects.
* @returns the parsed state.
*/
function parse(text, descriptor) {
	let document;
	try {
		document = JSON.parse(text);
	} catch (error) {
		throw new StorageError("malformed-medium", `unit '${descriptor.name}': file is not valid JSON`, { cause: error });
	}
	if (typeof document !== "object" || document === null) throw new StorageError("malformed-medium", `unit '${descriptor.name}': file is not a JSON object`);
	const { unit, global: globalValue, tables } = document;
	if (typeof unit !== "object" || unit === null || unit["name"] !== descriptor.name || typeof unit["version"] !== "number") throw new StorageError("malformed-medium", `unit '${descriptor.name}': missing or foreign unit header`);
	const version = unit["version"];
	if (version !== descriptor.version) throw new StorageError("version-mismatch", `unit '${descriptor.name}': stored version ${version} != expected ${descriptor.version}`);
	if (typeof tables !== "object" || tables === null) throw new StorageError("malformed-medium", `unit '${descriptor.name}': tables is not an object`);
	const state = {
		version,
		global: globalValue ?? null,
		tables: /* @__PURE__ */ new Map()
	};
	for (const table of descriptor.tables) {
		const records = tables[table];
		if (records === void 0) {
			state.tables.set(table, /* @__PURE__ */ new Map());
			continue;
		}
		if (typeof records !== "object" || records === null || Array.isArray(records)) throw new StorageError("malformed-medium", `unit '${descriptor.name}': table '${table}' is not an object`);
		state.tables.set(table, new Map(Object.entries(records)));
	}
	return state;
}
//#endregion
//#region lib/types/unit.js
/**
* One opened JSON unit. The in-memory state is authoritative; every write
* primitive mutates it and republishes the whole file atomically. Writes are
* NOT queued here — per the backend contract, write ordering belongs to the
* caller (the domain layer's write chain); this unit only guarantees that
* each single call publishes a complete, durable file.
* @module @deepseek-ai/dsh-storage-json/src/unit
*/
/**
* Open (load or lazily create) one unit backed by `path`.
* @param descriptor - Static identity and shape of the unit.
* @param path - Absolute unit file path under the backend root.
* @param onClose - Backend callback releasing the unit's open-slot.
* @returns the opened unit.
*/
async function openJsonUnit(descriptor, path, onClose) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return new JsonKvUnit(descriptor, path, text === void 0 ? {
		version: descriptor.version,
		global: null,
		tables: new Map(descriptor.tables.map((table) => [table, /* @__PURE__ */ new Map()]))
	} : parse(text, descriptor), onClose);
}
var JsonKvUnit = class {
	descriptor;
	path;
	state;
	onClose;
	closed = false;
	/** In-flight publishes; close() drains them before releasing the unit. */
	inFlight = /* @__PURE__ */ new Set();
	constructor(descriptor, path, state, onClose) {
		this.descriptor = descriptor;
		this.path = path;
		this.state = state;
		this.onClose = onClose;
	}
	async loadAll() {
		this.assertOpen();
		const tables = {};
		for (const [table, records] of this.state.tables) tables[table] = Object.fromEntries(records);
		return {
			tables,
			global: this.state.global
		};
	}
	async putRecord(table, key, value) {
		this.assertOpen();
		const records = this.records(table);
		const hadKey = records.has(key);
		const previous = records.get(key);
		records.set(key, value);
		await this.publish().catch((error) => {
			if (hadKey) records.set(key, previous);
			else records.delete(key);
			throw error;
		});
	}
	async deleteRecord(table, key) {
		this.assertOpen();
		const records = this.records(table);
		if (!records.has(key)) return;
		const previous = records.get(key);
		records.delete(key);
		await this.publish().catch((error) => {
			records.set(key, previous);
			throw error;
		});
	}
	async setGlobal(value) {
		this.assertOpen();
		if (!this.descriptor.hasGlobal) throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`);
		const previous = this.state.global;
		this.state.global = value;
		await this.publish().catch((error) => {
			this.state.global = previous;
			throw error;
		});
	}
	async close() {
		if (this.closed) {
			await Promise.allSettled(this.inFlight);
			return;
		}
		this.closed = true;
		await Promise.allSettled(this.inFlight);
		this.onClose();
	}
	assertOpen() {
		if (this.closed) throw new StorageError("closed", `unit '${this.descriptor.name}' is closed`);
	}
	records(table) {
		const records = this.state.tables.get(table);
		if (!records) throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`);
		return records;
	}
	publish() {
		const write = writeAtomic(this.path, serialize(this.descriptor.name, this.state));
		this.inFlight.add(write);
		write.catch(() => {}).finally(() => this.inFlight.delete(write));
		return write;
	}
};
//#endregion
//#region lib/types/index.js
/**
* JSON storage backend: one human-readable file per unit under a configured
* root, published by atomic whole-file rewrite. Registers as backend `json`
* on the storage hub.
* @module @deepseek-ai/dsh-storage-json
*/
/** Cordis plugin name. */
const name = "storage-json";
/** The hub must exist before the backend can register. */
const inject = ["storage"];
/** Config schema. */
const Config = z.object({ root: z.string().required() });
/** JSON backend: owns the file-tree root and serves the `kv` facet. */
var JsonStorageBackend = class {
	root;
	open = /* @__PURE__ */ new Map();
	opening = /* @__PURE__ */ new Map();
	closed = false;
	constructor(root) {
		this.root = root;
	}
	kv = { open: async (descriptor) => {
		if (this.closed) throw new StorageError("closed", "json backend is closed");
		validateDescriptor(descriptor);
		if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`);
		const opening = this.openUnit(descriptor);
		this.opening.set(descriptor.name, opening);
		return opening.finally(() => this.opening.delete(descriptor.name));
	} };
	async openUnit(descriptor) {
		await mkdir(this.root, {
			recursive: true,
			mode: 448
		});
		const unit = await openJsonUnit(descriptor, join(this.root, `${descriptor.name}.json`), () => this.open.delete(descriptor.name));
		if (this.closed) {
			await unit.close();
			throw new StorageError("closed", "json backend is closed");
		}
		this.open.set(descriptor.name, unit);
		return unit;
	}
	async close() {
		if (!this.closed) this.closed = true;
		await Promise.allSettled([...this.opening.values()]);
		for (const unit of [...this.open.values()]) await unit.close();
	}
};
function validateDescriptor(descriptor) {
	if (!UNIT_NAME_RE.test(descriptor.name)) throw new StorageError("malformed-medium", `invalid unit name '${descriptor.name}'`);
	for (const table of descriptor.tables) if (!UNIT_NAME_RE.test(table)) throw new StorageError("malformed-medium", `invalid table name '${table}' in unit '${descriptor.name}'`);
}
/**
* Register the `json` backend on the storage hub.
* @param ctx - Plugin context.
* @param config - Validated configuration.
*/
function apply(ctx, config) {
	const backend = new JsonStorageBackend(config.root);
	ctx.effect(() => {
		const unregister = ctx.storage.backend.register("json", backend);
		return async () => {
			unregister();
			await backend.close();
		};
	});
	ctx.provide(storageBackendServiceKey("json"), backend);
}
//#endregion
export { Config, JsonStorageBackend, apply, inject, name };
