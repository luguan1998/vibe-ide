/**
 * Backend-facing vocabulary of the storage hub: a backend owns one medium
 * (a file-tree root, a database file) and exposes operation groups over it.
 * This module defines the normative contract text for backend implementers; the shared
 * conformance suite in `tests/contract.ts` checks every rule.
 * @module @deepseek-ai/dsh-storage/src/backend
 */
/** Allowed format for unit and table names: safe as a file name and as a SQL identifier segment without escaping. */
export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/;
//# sourceMappingURL=backend.js.map