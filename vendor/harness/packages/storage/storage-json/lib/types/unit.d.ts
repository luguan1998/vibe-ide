/**
 * One opened JSON unit. The in-memory state is authoritative; every write
 * primitive mutates it and republishes the whole file atomically. Writes are
 * NOT queued here — per the backend contract, write ordering belongs to the
 * caller (the domain layer's write chain); this unit only guarantees that
 * each single call publishes a complete, durable file.
 * @module @deepseek-ai/dsh-storage-json/src/unit
 */
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage';
/**
 * Open (load or lazily create) one unit backed by `path`.
 * @param descriptor - Static identity and shape of the unit.
 * @param path - Absolute unit file path under the backend root.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
export declare function openJsonUnit(descriptor: KvUnitDescriptor, path: string, onClose: () => void): Promise<KvUnit>;
//# sourceMappingURL=unit.d.ts.map