import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TerminalBlock: the terminal surface for a shell command and its output —
// prompt line (run-state dot + shortened cwd + command), ANSI-colored output,
// settled exit status, and a copy control for the raw output. Output never soft-wraps:
// column-aligned output (ls, tables, box drawing) keeps its alignment and
// scrolls horizontally instead of folding. Colors resolve through --dsw-*
// tokens; ANSI parsing lives in ansi.ts.
import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { parseAnsiLines } from "./ansi.js";
import { headTailCap } from "./head-tail-cap.js";
import { useCopyFeedback } from "./use-copy-feedback.js";
import { Pill } from "./Pill.js";
import { StateDot } from "./StateDot.js";
import css from './TerminalBlock.module.css';
/**
 * Output lines shown before the height cap collapses the middle. Matches the
 * TUI transcript's default tool-output budget so both front ends cut a long
 * command's output at the same place.
 */
export const DEFAULT_TERMINAL_MAX_LINES = 16;
const DEFAULT_LABELS = {
    signal: signal => `信号 ${signal}`,
    exitCode: exitCode => `退出码 ${exitCode}`,
    running: '运行中',
    failed: '失败',
    done: '已完成',
    copy: '复制',
    copied: '复制成功',
    noOutput: '无输出',
    collapseAria: '收起输出',
    collapse: '收起',
    expandAria: hidden => `展开其余 ${hidden} 行输出`,
    expand: hidden => `… 其余 ${hidden} 行`,
};
/**
 * Prompt label for a working directory: `~` for the home directory itself,
 * otherwise the path's last segment (both separators accepted, trailing
 * separators ignored), falling back to the path itself when it has no
 * segment.
 * @param cwd - the working directory path.
 * @param home - absolute home directory, when the caller knows it.
 * @returns the prompt label.
 */
function promptLabel(cwd, home) {
    const trimmed = cwd.replace(/[/\\]+$/, '');
    if (home !== undefined && trimmed === home.replace(/[/\\]+$/, ''))
        return '~';
    const segment = trimmed.split(/[/\\]/).pop();
    return segment === undefined || segment === '' ? cwd : segment;
}
/**
 * Status pill text for a settled command, or undefined when the command
 * settled cleanly (exit 0, no signal) and needs no pill — the same
 * distinction the bash tool's own exit-status markers draw.
 * @param exitCode - settled exit code, when known.
 * @param signal - settled terminating signal name, when known.
 * @param labels - display copy for the pill text.
 * @returns the pill text, or undefined for a clean exit.
 */
function statusText(exitCode, signal, labels) {
    if (signal !== undefined)
        return labels.signal(signal);
    if (exitCode !== undefined && exitCode !== 0)
        return labels.exitCode(exitCode);
    return undefined;
}
/**
 * Run-state indicator for the command, shown at the head of the prompt line so
 * the card states whether the command is still running without the reader
 * having to infer it from the presence of output. Three of {@link StateDotState}'s
 * four states are reachable: the running chase (the same
 * indicator a running tool row's leading icon uses, so the row and its card
 * never disagree), green for a clean settle, red for a signal or a non-zero
 * exit — the same status distinction {@link statusText} draws for the pill. A
 * settled command whose exit status never reached the view counts as a clean
 * settle: the view says it finished and says nothing went wrong.
 * @param running - the command has not settled.
 * @param exitCode - settled exit code, when known.
 * @param signal - settled terminating signal name, when known.
 * @param labels - display copy for the text label.
 * @returns the dot's state and its text label, since the dot is aria-hidden.
 */
function runState(running, exitCode, signal, labels) {
    if (running)
        return { state: 'ongoing', label: labels.running };
    if (statusText(exitCode, signal, labels) !== undefined)
        return { state: 'error', label: labels.failed };
    return { state: 'done', label: labels.done };
}
/**
 * Render one parsed output line. Runs without SGR state render as bare text,
 * so uncolored output carries no span wrappers.
 * @param line - the line's styled runs.
 * @returns the line's children.
 */
function renderLine(line) {
    return line.map((span, index) => span.style === undefined
        ? span.text
        : _jsx("span", { style: span.style, children: span.text }, index));
}
/**
 * Render a shell command as a terminal surface.
 * @param props - see {@link TerminalBlockProps}.
 * @returns the terminal block element.
 */
export function TerminalBlock({ command, cwd, home, output, exitCode, signal, running = false, maxLines = DEFAULT_TERMINAL_MAX_LINES, className, labels, }) {
    const copy = useMemo(() => (labels === undefined ? DEFAULT_LABELS : { ...DEFAULT_LABELS, ...labels }), [labels]);
    const text = output ?? '';
    // A command's output ends with a newline; that terminator is not an extra
    // blank line to draw or to count against the height cap. The check runs on the
    // PARSED lines rather than on the raw text, because a reset after the final
    // newline (`line\n\x1b[0m`) leaves the string not ending in one while still
    // producing a last line with nothing visible in it. A genuinely blank final
    // line — the double newline — survives, since it has a real empty line before
    // the terminator. The copy control still copies `text` untouched.
    const lines = useMemo(() => {
        const parsed = parseAnsiLines(text);
        const last = parsed[parsed.length - 1];
        const terminated = parsed.length > 1 && last !== undefined
            && last.every(span => span.text === '');
        return terminated ? parsed.slice(0, -1) : parsed;
    }, [text]);
    const [expanded, setExpanded] = useState(false);
    // The raw output, never the rendered tree: the prompt line and the status pill
    // are chrome the user did not run.
    const { copied, onCopy } = useCopyFeedback(text);
    const onToggle = useCallback(() => { setExpanded(value => !value); }, []);
    const status = statusText(exitCode, signal, copy);
    const state = runState(running, exitCode, signal, copy);
    // A multi-line command gets one prompt row per line, so a two-command shell
    // snippet reads as the two commands it is instead of collapsing into one
    // ellipsized row. A trailing newline is a terminator, not an empty command.
    const commandLines = useMemo(() => {
        const body = command.endsWith('\n') ? command.slice(0, -1) : command;
        return body.split('\n');
    }, [command]);
    // Read from the parsed lines the card actually renders, not from the raw text:
    // output that is only escapes or control bytes (a lone reset, an OSC title, an
    // erase) survives `text.trim()` yet parses to nothing visible. Judging it on
    // the raw text would draw an output box of blank rows plus a copy control
    // for invisible bytes, and hide the placeholder that belongs there.
    const empty = lines.every(line => line.every(span => span.text.trim() === ''));
    const { hidden, capped, headLines, tailLines } = headTailCap(lines.length, maxLines, expanded);
    return (_jsxs("div", { className: clsx(css.block, className), "data-terminal": "", "data-running": running ? '' : undefined, children: [_jsxs("div", { className: css.header, children: [_jsxs("div", { className: css.prompt, children: [_jsx("span", { className: css.runStateLabel, children: state.label }), commandLines.map((line, index) => (_jsxs("div", { className: css.promptLine, children: [index === 0 && _jsx(StateDot, { state: state.state, className: css.runState }), _jsx("span", { className: css.cwd, children: index > 0 || cwd === undefined ? '$' : promptLabel(cwd, home) }), _jsx("span", { className: css.command, children: line })] }, index)))] }), status !== undefined && _jsx(Pill, { className: css.status, children: status }), !running && !empty && (_jsx("button", { type: "button", className: css.copyButton, onClick: onCopy, children: copied ? copy.copied : copy.copy }))] }), !running && (empty
                ? _jsx("div", { className: css.empty, children: copy.noOutput })
                : (_jsxs("div", { className: css.output, children: [(capped ? lines.slice(0, headLines) : lines).map((line, index) => (_jsx("div", { className: css.line, children: renderLine(line) }, index))), hidden > 0 && (_jsx("button", { type: "button", className: css.expand, "aria-expanded": expanded, "aria-label": expanded ? copy.collapseAria : copy.expandAria(hidden), onClick: onToggle, children: expanded ? copy.collapse : copy.expand(hidden) })), capped && lines.slice(lines.length - tailLines).map((line, index) => (_jsx("div", { className: css.line, children: renderLine(line) }, index)))] })))] }));
}
//# sourceMappingURL=TerminalBlock.js.map