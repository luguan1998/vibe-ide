/**
 * On-disk JSON unit format: the file is always the current net state, kept
 * human-readable (pretty-printed, stable key order from insertion) — that
 * legibility is this backend's reason to exist.
 * @module @deepseek-ai/dsh-storage-json/src/format
 */
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage';
/** In-memory authoritative state of one unit; the file is its projection. `global` is `null` until first written. */
export interface UnitState {
    version: number;
    global: unknown;
    tables: Map<string, Map<string, unknown>>;
}
/**
 * Serialize a unit state to file content.
 * @param name - Unit name, stamped into the header.
 * @param state - Authoritative in-memory state.
 * @returns pretty-printed JSON document with a trailing newline.
 */
export declare function serialize(name: string, state: UnitState): string;
/**
 * Parse file content into unit state, validating shape and version.
 * @param text - Raw file content.
 * @param descriptor - Expected identity; version mismatch rejects.
 * @returns the parsed state.
 */
export declare function parse(text: string, descriptor: KvUnitDescriptor): UnitState;
//# sourceMappingURL=format.d.ts.map