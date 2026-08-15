import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDownOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './JobListAction.module.css';
/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_TASKS = [];
/** A job the registry still holds open, and whose duration therefore ticks. */
function isLive(job) {
    return job.status === 'running' || job.status === 'stopping';
}
/** Closed-union exhaustiveness fence for the wire status set. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value) {
    throw new Error(`unhandled job status: ${JSON.stringify(value)}`);
}
/**
 * Status marker semantics. `stopping` and `killed` share the attention color:
 * both mean the work ended (or is ending) on request rather than on its own.
 */
function dotState(status) {
    switch (status) {
        case 'running': return 'ongoing';
        case 'stopping': return 'warning';
        case 'completed': return 'done';
        case 'killed': return 'warning';
        case 'failed': return 'error';
        /* v8 ignore next -- closed wire status union */
        default: return assertNever(status);
    }
}
/** Human status word for the row and its accessible name. */
function statusLabel(status, t) {
    switch (status) {
        case 'running': return t('status.running');
        case 'stopping': return t('status.stopping');
        case 'completed': return t('status.completed');
        case 'killed': return t('status.killed');
        case 'failed': return t('status.failed');
        /* v8 ignore next -- closed wire status union */
        default: return assertNever(status);
    }
}
/**
 * Elapsed time in at most two adjacent units. A background job that outlives
 * an hour is already exceptional, so hours is the widest unit — beyond that the
 * figure stays in hours rather than growing a day/month vocabulary no producer
 * currently reaches.
 */
function formatDuration(elapsedMs, t) {
    const total = Math.max(0, Math.floor(elapsedMs / 1_000));
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3_600);
    if (hours > 0)
        return t('duration.hours', { hours, minutes });
    if (minutes > 0)
        return t('duration.minutes', { minutes, seconds });
    return t('duration.seconds', { seconds });
}
/**
 * Live rows first in start order, then settled rows newest-first. Two jobs
 * that settled in the same millisecond fall back to start order, so the sort
 * never depends on the host's map iteration.
 */
function ordered(jobs) {
    return [...jobs].sort((left, right) => {
        const liveLeft = isLive(left);
        if (liveLeft !== isLive(right))
            return liveLeft ? -1 : 1;
        if (liveLeft)
            return left.startedAt - right.startedAt;
        const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt);
        return finished !== 0 ? finished : left.startedAt - right.startedAt;
    });
}
/**
 * Session-header entry point for this session's background jobs. It renders
 * nothing at all until the session has at least one job, so an ordinary
 * conversation never grows a control for a capability it is not using.
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the trigger and its popover list, or null when there is nothing to show.
 */
export function JobListAction({ sessionId, useSessions, t }) {
    const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS;
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const rows = useMemo(() => ordered(jobs), [jobs]);
    const liveCount = useMemo(() => jobs.filter(isLive).length, [jobs]);
    useEffect(() => {
        if (!open)
            return;
        const closeOutside = (event) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => { document.removeEventListener('pointerdown', closeOutside); };
    }, [open]);
    // The clock only runs while an open list is showing something that moves.
    useEffect(() => {
        if (!open || liveCount === 0)
            return;
        setNow(Date.now());
        const timer = setInterval(() => { setNow(Date.now()); }, 1_000);
        return () => { clearInterval(timer); };
    }, [open, liveCount]);
    // The last job disappearing removes this control; close first so focus does
    // not vanish from an unmounting node.
    useEffect(() => {
        if (jobs.length === 0 && open)
            setOpen(false);
    }, [jobs.length, open]);
    if (jobs.length === 0)
        return null;
    const countKey = liveCount > 0
        ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
        : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other');
    const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length });
    const onKeyDown = (event) => {
        if (event.key !== 'Escape' || !open)
            return;
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
    };
    return (_jsxs("div", { ref: rootRef, className: css.root, onKeyDown: onKeyDown, children: [_jsxs("button", { ref: triggerRef, type: "button", className: css.trigger, "aria-expanded": open, "aria-label": countLabel, onClick: () => {
                    // Sample the clock in the same commit that opens the list: the
                    // mount-time value predates every job, so the first painted frame
                    // would otherwise clamp a long-running row to zero until the
                    // open effect corrects it a frame later.
                    setNow(Date.now());
                    setOpen(current => !current);
                }, children: [liveCount > 0 ? _jsx(StateDot, { state: "ongoing", className: css.triggerDot }) : null, _jsx("span", { className: css.count, children: countLabel }), _jsx(IconChevronDownOutline14, { className: open ? css.triggerOpen : undefined })] }), open
                ? (_jsx("ul", { className: css.menu, "aria-label": t('list.aria'), children: rows.map((job) => {
                        const live = isLive(job);
                        const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt;
                        const duration = formatDuration(elapsed, t);
                        const status = statusLabel(job.status, t);
                        return (_jsxs("li", { className: live ? css.row : `${css.row} ${css.rowSettled}`, children: [_jsx(StateDot, { state: dotState(job.status), className: css.rowDot }), _jsx("span", { className: css.kind, children: job.kind }), _jsx("span", { className: css.label, title: job.label, children: job.label }), _jsx("span", { className: css.status, title: job.detail ?? status, children: job.detail ?? status }), _jsx("span", { className: css.duration, title: t(live ? 'duration.title.live' : 'duration.title.done', { duration }), children: duration })] }, job.id));
                    }) }))
                : null] }));
}
//# sourceMappingURL=JobListAction.js.map