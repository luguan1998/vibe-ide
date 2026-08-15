/** Persistent PTY session over the subprocess seam's terminal primitive. */
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess';
import type { TerminalBackendSession, TerminalReadRequest, TerminalReadResult, TerminalSendOperation, TerminalSendRequest, TerminalSessionStatus, TerminalSignal, TerminalSignalResult } from '@deepseek-ai/dsh-terminal';
import type { ResolvedConfig } from './config.ts';
/** Backend session wrapping one provider-owned terminal process. */
export declare class LocalPtySession implements TerminalBackendSession {
    private readonly terminal;
    private readonly config;
    motd: string;
    readonly pid: number;
    private readonly decoder;
    private readonly sanitizer;
    private readonly scrollback;
    private readonly outputEnded;
    private readonly completion;
    private statusValue;
    private active;
    private activeTimer;
    private activeDeadlineTimer;
    private activeAbort;
    private interrupting;
    private activeWrite;
    private pollingReady;
    private polling;
    private promptSeen;
    private promptTextSeen;
    private promptTail;
    private shellPgid;
    private initializing;
    private lastOutputAt;
    private closing;
    private closePromise;
    private transportFailure;
    constructor(terminal: SubprocessTerminalHandle, config: ResolvedConfig);
    /**
     * Capture startup output through the same readiness contract as later sends.
     * @param signal - optional cancellation while the shell reaches its first prompt.
     * @returns Resolves after startup readiness; rejects on exit or readiness timeout.
     */
    initialize(signal?: AbortSignal): Promise<void>;
    startSend(request: TerminalSendRequest): TerminalSendOperation;
    private beginSend;
    private resetReadinessEvidence;
    read(request: TerminalReadRequest): TerminalReadResult;
    signal(signal: TerminalSignal): Promise<TerminalSignalResult>;
    status(): TerminalSessionStatus;
    close(reason: string): Promise<void>;
    private readonly onTerminalData;
    private readonly onTerminalEnd;
    private readonly onTerminalError;
    private onData;
    private onExit;
    private onTransportFailure;
    private appendOutput;
    private schedulePoll;
    private pollReadiness;
    private settleActive;
    private stopPolling;
    private stopReadinessPolling;
    private clearActive;
    private failActive;
    private interrupt;
    private interruptOnce;
    private closeOnce;
}
//# sourceMappingURL=session.d.ts.map