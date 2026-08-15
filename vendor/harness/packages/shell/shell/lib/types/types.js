/**
 * Execution types for the bash executor seam. Background job semantics belong
 * to `@deepseek-ai/dsh-jobs`; this seam exposes only process handles. The
 * managed-environment and captured-output vocabulary is owned by the
 * subprocess seam and re-exported here so bash consumers keep one import
 * root.
 * @module dsh-shell/types
 */
export { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-subprocess';
//# sourceMappingURL=types.js.map