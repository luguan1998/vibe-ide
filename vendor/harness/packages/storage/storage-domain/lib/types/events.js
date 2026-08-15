/**
 * Change-event vocabulary of the domain data form. Every durable write emits
 * one event after the backend resolves durability, carrying the new snapshot
 * and an operation discriminant — never the old value (a diffing consumer
 * keeps its own previous snapshot). This is the event source for cross-process
 * change push (RPC frames) in a later phase.
 * @module @deepseek-ai/dsh-storage-domain/src/events
 */
export {};
//# sourceMappingURL=events.js.map