/**
 * The host⇄worker wire protocol: one string-valued enum of message tags per direction, a
 * payload map giving each tag its parameters (the single source of truth), and the message
 * unions derived from them. Payloads are plain JSON by construction for structured clone. Both
 * directions are closed engine protocols whose receivers use `assertNever`; generic typed senders
 * make tag/payload mismatches compile-time errors rather than silently skipped messages.
 * @module @deepseek-ai/dsh-workflow-worker-thread/protocol
 */
/** Message tags the worker sends the host (the wire values are the tag strings). */
export var WorkerToHostType;
(function (WorkerToHostType) {
    /** The startup handshake: the session is listening and awaits {@link HostToWorkerType.Go}. */
    WorkerToHostType["Ready"] = "ready";
    /** Observer narration: a `phase(title)` call. */
    WorkerToHostType["Phase"] = "phase";
    /** Observer narration: a `log(message)` call. */
    WorkerToHostType["Log"] = "log";
    /** Observer lifecycle: one `agent()` call started a child. */
    WorkerToHostType["AgentStart"] = "agent-start";
    /** Observer lifecycle: one `agent()` call settled. */
    WorkerToHostType["AgentEnd"] = "agent-end";
    /** Child RPC: start a child on the host (answered by ChildStarted or ChildStartError). */
    WorkerToHostType["ChildStart"] = "child-start";
    /** Child RPC: dispose a started child (answered by ChildDisposed). */
    WorkerToHostType["ChildDispose"] = "child-dispose";
    /** The run's single terminal result. */
    WorkerToHostType["Result"] = "result";
})(WorkerToHostType || (WorkerToHostType = {}));
/** Message tags the host sends the worker (the wire values are the tag strings). */
export var HostToWorkerType;
(function (HostToWorkerType) {
    /** Releases the startup gate: run the script body. */
    HostToWorkerType["Go"] = "go";
    /** Cancel the run: hooks start throwing and the script dies at its next await. */
    HostToWorkerType["Cancel"] = "cancel";
    /** Child RPC reply: the provider fulfilled with a published run (exactly one start reply per ChildStart). */
    HostToWorkerType["ChildStarted"] = "child-started";
    /** Child RPC reply: the provider's asynchronous start failed. */
    HostToWorkerType["ChildStartError"] = "child-start-error";
    /** Child RPC: a started child's result RESOLVED (its JSON projection). */
    HostToWorkerType["ChildSettled"] = "child-settled";
    /** Child RPC: a started child's result REJECTED (an infrastructure fault, rendered). */
    HostToWorkerType["ChildFailed"] = "child-failed";
    /** Child RPC reply: a requested disposal completed. */
    HostToWorkerType["ChildDisposed"] = "child-disposed";
})(HostToWorkerType || (HostToWorkerType = {}));
//# sourceMappingURL=protocol.js.map