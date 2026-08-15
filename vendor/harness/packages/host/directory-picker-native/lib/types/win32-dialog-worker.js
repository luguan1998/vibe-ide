/**
 * Child-process entry for the Win32 folder dialog: blocks THIS process
 * inside the modal `Show` so the host event loop stays live, reporting over
 * the IPC channel. Spawned as a child process (not a worker thread) so the
 * dialog is the process's first window and Windows activates it without a
 * manual foreground call. Protocol: `{kind:'showing',threadId}` right
 * before the blocking call (the driver's abort lever needs the native
 * thread id), then exactly one of `{kind:'done',path}` or
 * `{kind:'error',message}`.
 */
import { loadWin32DialogBindings } from "./win32-dialog-bindings.js";
import { runFolderDialog } from "./win32-dialog-logic.js";
const title = process.env.DSH_DIALOG_TITLE ?? '';
if (title === '')
    throw new Error('win32-dialog-worker: DSH_DIALOG_TITLE is required');
if (process.send === undefined)
    throw new Error('win32-dialog-worker must run as a child process with an IPC channel');
// node's internal `send` reads `this.connected`, so bind the receiver.
const send = process.send.bind(process);
const post = (message) => {
    // Flush before closing the channel; the process exits when the loop drains.
    /* v8 ignore next 3 -- disconnect needs a live IPC channel the unit lane must not sever (built-worker.e2e.ts owns the real close path). */
    send(message, () => { if (process.connected)
        process.disconnect(); });
};
// A settled driver (or a dead parent) must not orphan a dialog still on screen.
/* v8 ignore next 3 -- the handler exits(0), which would kill the unit lane; built-worker.e2e.ts owns the real disconnect lifecycle. */
process.on('disconnect', () => process.exit(0));
// No top-level await: the built worker ships as CJS, which cannot carry TLA.
void (async () => {
    try {
        const bindings = await loadWin32DialogBindings();
        const path = runFolderDialog(bindings, title, (threadId) => {
            post({ kind: 'showing', threadId });
        });
        post({ kind: 'done', path });
    }
    catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        post({ kind: 'error', message });
    }
})();
//# sourceMappingURL=win32-dialog-worker.js.map