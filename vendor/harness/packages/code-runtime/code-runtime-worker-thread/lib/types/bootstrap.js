/**
 * Worker-side execution logic, written as plain functions over an injected port so the unit
 * suite can run every line IN-PROCESS against a fake port (a real worker thread is a separate
 * V8 isolate the coverage provider cannot observe).
 * @module @deepseek-ai/dsh-code-runtime-worker-thread/src/bootstrap
 */
import { inspect } from 'node:util';
import { jsonStringBytesUpTo, jsonValueBytesUpTo, truncateJsonStringBytes } from "./output-json.js";
import { decodeWorkerJson, encodeWorkerJson, snapshotCodeJsonValue } from "./worker-json.js";
const CapturedError = Error;
const capturedObjectCreate = Object.create;
const capturedObjectDefineProperty = Object.defineProperty;
/** Define one public binding-error field without consulting mutable globals or descriptor prototypes. */
function defineBindingErrorField(error, key, value) {
    const attributes = capturedObjectCreate(null);
    attributes.enumerable = true;
    attributes.value = value;
    capturedObjectDefineProperty(error, key, attributes);
}
/**
 * Ordered text capture under the shared outer JSON-byte budget, delivered to
 * a sink as each item lands (the real sink streams text over the port eagerly,
 * so captured output survives a mid-run termination). It includes the log
 * array syntax and string escaping in its accounting. Once exhausted it emits
 * the fitting prefix and reports the limit once; the host turns that condition
 * into an explicit `output-limit` run failure.
 */
export class LogBuffer {
    bytes = 2; // JSON serialization of the empty logs array: []
    entries = 0;
    truncated = false;
    // Explicit fields, not constructor parameter properties: this module loads
    // under Node's native strip-only mode, which rejects non-erasable syntax —
    // and parameter properties are non-erasable.
    sink;
    onLimit;
    maxBytes;
    constructor(maxBytes, sink, onLimit = () => { }) {
        this.maxBytes = maxBytes;
        this.sink = sink;
        this.onLimit = onLimit;
    }
    /**
     * Emit text to the sink, charging it against the budget (drops + marks once exhausted).
     * @param text - the captured text to deliver.
     */
    push(text) {
        if (this.truncated)
            return;
        const separatorBytes = this.entries > 0 ? 1 : 0;
        const availableBytes = this.maxBytes - this.bytes - separatorBytes;
        const stringBytes = jsonStringBytesUpTo(text, availableBytes);
        if (stringBytes === undefined) {
            this.truncated = true;
            const prefix = truncateJsonStringBytes(text, availableBytes);
            if (prefix.length > 0) {
                const prefixBytes = jsonStringBytesUpTo(prefix, availableBytes);
                /* v8 ignore next -- truncateJsonStringBytes guarantees the returned prefix fits. */
                if (prefixBytes === undefined)
                    throw new CapturedError('worker output ledger produced an oversized log prefix');
                this.bytes += prefixBytes + separatorBytes;
                this.entries += 1;
                this.sink(prefix);
            }
            this.onLimit();
            return;
        }
        this.bytes += stringBytes + separatorBytes;
        this.entries += 1;
        this.sink(text);
    }
    /** Remaining exact JSON-byte budget for the completion value or failure message. */
    remainingOutputBytes() {
        return this.maxBytes - this.bytes;
    }
}
/** The five console methods the shim captures, in the seam's level vocabulary. */
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
/**
 * A `console` replacement whose five leveled methods render their arguments
 * `util.inspect`-style (matching real console formatting closely enough for
 * a model to recognize its own output) into the buffer. Only these five
 * exist — the program gets a deliberately small console, not Node's full
 * console API.
 * @param logs - the buffer every rendered line is pushed into.
 * @returns the five-method console object handed to the program.
 */
export function makeConsoleShim(logs) {
    const render = (args) => args.map(arg => typeof arg === 'string' ? arg : inspect(arg, INSPECT_OPTIONS)).join(' ');
    const shim = Object.create(null);
    for (const level of CONSOLE_LEVELS) {
        shim[level] = (...args) => { logs.push(render(args)); };
    }
    return shim;
}
/**
 * Redirect a stream's `write` into the log buffer (the program-visible
 * `process.stdout`/`process.stderr` in the real worker), so raw writes land in emission order
 * alongside console output instead of racing down a pipe. It preserves Node's optional callback
 * contract: the callback runs asynchronously after admission, even when the log budget drops
 * the write.
 *
 * @param logs - the buffer captured writes are pushed into.
 * @param stream - the stream whose `write` slot is patched.
 * @returns the restore function (the in-process tests un-patch; the real
 *   worker never needs to).
 */
export function captureStreamWrites(logs, stream) {
    // The slot's VALUE is stored for restore and reassigned — never invoked
    // detached, so the unbound-method concern does not apply.
    // oxlint-disable-next-line typescript/unbound-method
    const original = stream.write;
    stream.write = (chunk, ...rest) => {
        logs.push(typeof chunk === 'string' ? chunk : String(chunk));
        // Node's optional-encoding shape: the callback is whichever of the next
        // two positions holds a function (a non-function there is the encoding).
        const callback = [rest[0], rest[1]].find((arg) => typeof arg === 'function');
        if (callback)
            queueMicrotask(() => { callback(null); });
        return true;
    };
    return () => { stream.write = original; };
}
/** Bounded inspect options: deep enough to be useful, bounded so a pathological value cannot explode the rendering. */
const INSPECT_OPTIONS = { depth: 4, maxArrayLength: 100, maxStringLength: 10_000 };
/**
 * Prepare the program's completion value for the done message. Only lossless
 * JSON crosses, and a value that does not fit the remaining combined outer
 * budget reports `output-limit`; the host revalidates hostile traffic and
 * remains authoritative for native pipe writes the worker cannot observe.
 *
 * @param value - the program's completion value.
 * @param remainingOutputBytes - exact bytes left after captured logs.
 * @param maxOutputBytes - the configured cap named in an overflow diagnostic.
 * @returns the done-message fragment: `{}` for `undefined`, else a flat wire `{ value }`.
 */
export function prepareCompletion(value, remainingOutputBytes, maxOutputBytes = remainingOutputBytes) {
    if (value === undefined)
        return {};
    let snapshot;
    try {
        snapshot = snapshotCodeJsonValue(value);
    }
    catch {
        snapshot = undefined;
    }
    if (snapshot === undefined) {
        return prepareFailure('invalid-output', 'program completion must be lossless JSON', remainingOutputBytes, maxOutputBytes);
    }
    if (jsonValueBytesUpTo(snapshot, remainingOutputBytes) === undefined) {
        return outputLimit(maxOutputBytes);
    }
    return { value: encodeWorkerJson(snapshot) };
}
/** Build the fixed overflow fragment without carrying rejected variable bytes. */
function outputLimit(maxOutputBytes) {
    return { error: { kind: 'output-limit', message: `outer output exceeded ${maxOutputBytes} bytes` } };
}
/** Admit one bounded failure message or replace it with the fixed overflow diagnostic. */
function prepareFailure(kind, message, remainingOutputBytes, maxOutputBytes) {
    if (jsonStringBytesUpTo(message, remainingOutputBytes) === undefined)
        return outputLimit(maxOutputBytes);
    return { error: { kind, message } };
}
/**
 * Prepare a thrown program value without sending an unbounded stack or
 * string across the worker port.
 * @param error - the value thrown by the program.
 * @param remainingOutputBytes - exact bytes left after captured logs.
 * @param maxOutputBytes - the configured cap named in an overflow diagnostic.
 * @returns a bounded exception or fixed output-limit fragment.
 */
export function prepareException(error, remainingOutputBytes, maxOutputBytes = remainingOutputBytes) {
    let message;
    try {
        const detail = error instanceof CapturedError ? error.stack ?? error.message : error;
        message = typeof detail === 'string' ? detail : String(detail);
    }
    catch {
        message = 'program threw an unrenderable value';
    }
    return prepareFailure('exception', message, remainingOutputBytes, maxOutputBytes);
}
/**
 * Materialize the real error constructor declared by one namespace.
 * @param descriptor - program-global class name and member-name property.
 * @returns the constructor injected into the program and used for rejections.
 */
function makeBindingErrorClass(descriptor) {
    return class BindingCallError extends CapturedError {
        constructor(memberName, message) {
            super(message);
            defineBindingErrorField(this, 'name', descriptor.name);
            defineBindingErrorField(this, descriptor.memberNameProperty, memberName);
        }
    };
}
/** Create the namespace-specific rejection for one failed binding call. */
function bindingFailure(errorClass, memberName, message) {
    return errorClass ? new errorClass(memberName, message) : new CapturedError(message);
}
/**
 * Build each declared error class once so calls and `instanceof` share constructor identity.
 * @param data - binding namespace declarations from the boot payload.
 * @returns constructors keyed by their owning namespace global.
 */
export function makeBindingErrorClasses(data) {
    const classes = new Map();
    for (const namespace of data.namespaces) {
        if (namespace.errorClass)
            classes.set(namespace.global, makeBindingErrorClass(namespace.errorClass));
    }
    return classes;
}
/**
 * Route host replies into the pending-call map: each reply settles its call
 * at most once, and a reply for an unknown id (stray, or a duplicate answer
 * to an id already settled) is ignored. Shared wiring between
 * {@link runWorkerMain} and the tests that exercise {@link makeNamespaces}
 * standalone.
 * @param port - the port whose `message` events carry the replies.
 * @param pending - the id-keyed map of unsettled binding calls.
 */
export function wireReplies(port, pending) {
    port.on('message', (message) => {
        const entry = pending.get(message.id);
        if (!entry)
            return;
        pending.delete(message.id);
        if (message.ok) {
            const value = decodeWorkerJson(message.value);
            if (value === undefined)
                entry.reject(new CapturedError('binding resolution must be lossless JSON'));
            else
                entry.resolve(value);
        }
        else {
            entry.reject(new CapturedError(message.message));
        }
    });
}
/**
 * Build the binding namespace objects the program sees: one null-prototype global per
 * namespace, each declared name an own enumerable async function that bridges over the port
 * (`__proto__`/`constructor`/`toString` are ordinary keys, never prototype collisions).
 * Lossy arguments reject before posting; clone failures and host failure
 * replies reject only the corresponding call.
 *
 * @param data - the boot payload's namespace declarations (globals + names).
 * @param port - the port binding calls are posted to.
 * @param pending - the id-keyed map each posted call parks its handles in.
 * @param nextId - the shared mutable id counter (worker-issued correlation ids).
 * @param errorClasses - per-namespace constructors shared with program globals.
 * @returns one namespace object per declaration, in declaration order.
 */
export function makeNamespaces(data, port, pending, nextId, errorClasses = makeBindingErrorClasses(data)) {
    return data.namespaces.map(({ global, names }) => {
        const errorClass = errorClasses.get(global);
        const namespace = Object.create(null);
        for (const name of names) {
            Object.defineProperty(namespace, name, {
                enumerable: true,
                value: (args) => {
                    let detached;
                    try {
                        detached = snapshotCodeJsonValue(args);
                    }
                    catch {
                        detached = undefined;
                    }
                    if (detached === undefined) {
                        return Promise.reject(bindingFailure(errorClass, name, 'binding arguments must be lossless JSON'));
                    }
                    return new Promise((resolve, reject) => {
                        const id = nextId.value++;
                        pending.set(id, {
                            resolve,
                            reject: (error) => {
                                reject(bindingFailure(errorClass, name, error.message));
                            },
                        });
                        try {
                            port.postMessage({ type: 'call', id, global, name, args: encodeWorkerJson(detached) });
                        }
                        catch (error) {
                            pending.delete(id);
                            const message = `binding arguments must be structured-cloneable: ${error instanceof CapturedError ? error.message : String(error)}`;
                            reject(bindingFailure(errorClass, name, message));
                        }
                    });
                },
            });
        }
        return namespace;
    });
}
/**
 * Run one strict async-function body, allowing top-level `await` and `return`, and post exactly
 * one terminal {@link DoneMessage}; a thrown program error becomes its `error` field.
 * @param port - host message port or test double.
 * @param data - the boot payload the host sent.
 * @param streams - stdout/stderr objects captured as program logs.
 * @returns after posting the done message.
 */
export async function runWorkerMain(port, data, streams) {
    const logs = new LogBuffer(data.maxOutputBytes, (text) => { port.postMessage({ type: 'log', text }); }, () => { port.postMessage({ type: 'output-limit' }); });
    captureStreamWrites(logs, streams.stdout);
    captureStreamWrites(logs, streams.stderr);
    const pending = new Map();
    wireReplies(port, pending);
    const nextId = { value: 1 };
    const errorClasses = makeBindingErrorClasses(data);
    const namespaces = makeNamespaces(data, port, pending, nextId, errorClasses);
    const errorClassParameters = [];
    const errorClassValues = [];
    for (const namespace of data.namespaces) {
        if (!namespace.errorClass)
            continue;
        errorClassParameters.push(namespace.errorClass.name);
        const errorClass = errorClasses.get(namespace.global);
        /* v8 ignore next -- makeBindingErrorClasses covers every declaration in the same data. */
        if (!errorClass)
            throw new CapturedError(`missing binding error class for ${namespace.global}`);
        errorClassValues.push(errorClass);
    }
    const consoleShim = makeConsoleShim(logs);
    let done;
    try {
        // The async function constructor, reached through an instance because
        // `AsyncFunction` is not a global. The program body is strict-mode.
        /* v8 ignore next -- the arrow exists only to reach the AsyncFunction constructor; it is never invoked. */
        const AsyncFunction = (async () => { }).constructor;
        const fn = new AsyncFunction(...data.namespaces.map(namespace => namespace.global), ...errorClassParameters, 'console', `'use strict';\n${data.code}`);
        const value = await fn(...namespaces, ...errorClassValues, consoleShim);
        done = {
            type: 'done',
            ...prepareCompletion(value, logs.remainingOutputBytes(), data.maxOutputBytes),
        };
    }
    catch (error) {
        done = {
            type: 'done',
            ...prepareException(error, logs.remainingOutputBytes(), data.maxOutputBytes),
        };
    }
    port.postMessage(done);
}
//# sourceMappingURL=bootstrap.js.map