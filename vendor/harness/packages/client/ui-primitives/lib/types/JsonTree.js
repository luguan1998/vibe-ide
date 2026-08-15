import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconCheckOutline16, IconCopyOutline16 } from "./icons/index.js";
import { Menu } from "./Menu.js";
import css from './JsonTree.module.css';
const OBJECT_PREVIEW_LIMIT = 4;
const ARRAY_PREVIEW_LIMIT = 5;
const PREVIEW_DEPTH_LIMIT = 2;
const DEFAULT_LABELS = {
    copyValue: 'Copy value',
    copyJson: 'Copy JSON',
    copyPath: 'Copy property path',
    copyPrettyJson: 'Copy pretty JSON',
    copyCompactJson: 'Copy compact JSON',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    collapseNode: 'Collapse JSON node',
    expandNode: 'Expand JSON node',
    copyButtonTitle: action => `${action}; right-click for copy options`,
};
function valueCopyMenuItems(labels) {
    return [
        { id: 'value', label: labels.copyValue },
        { id: 'json', label: labels.copyJson },
        { id: 'path', label: labels.copyPath },
    ];
}
function objectCopyMenuItems(labels) {
    return [
        { id: 'prettyJson', label: labels.copyPrettyJson },
        { id: 'json', label: labels.copyCompactJson },
        { id: 'path', label: labels.copyPath },
    ];
}
function isExpandableValue(value) {
    return typeof value === 'object' && value !== null && !(value instanceof Date);
}
function entriesOf(value) {
    if (Array.isArray(value)) {
        return value.map((item, index) => [String(index), item]);
    }
    return Object.keys(value).map(key => [
        key,
        value[key],
    ]);
}
function bracketOf(value) {
    return Array.isArray(value) ? ['[', ']'] : ['{', '}'];
}
function previewPrimitive(value) {
    if (value === null)
        return _jsx("span", { className: css.keywordValue, children: "null" });
    if (typeof value === 'string') {
        return _jsx("span", { className: css.stringValue, children: JSON.stringify(value) });
    }
    if (typeof value === 'number') {
        return _jsx("span", { className: css.numberValue, children: String(value) });
    }
    if (typeof value === 'boolean') {
        return _jsx("span", { className: css.keywordValue, children: String(value) });
    }
    if (typeof value === 'bigint') {
        return _jsx("span", { className: css.otherValue, children: value.toString() });
    }
    if (typeof value === 'undefined') {
        return _jsx("span", { className: css.otherValue, children: "undefined" });
    }
    if (typeof value === 'symbol') {
        return _jsx("span", { className: css.otherValue, children: value.description ?? 'Symbol' });
    }
    if (typeof value === 'function') {
        return _jsx("span", { className: css.otherValue, children: value.name || 'Function' });
    }
    return null;
}
function previewValue(value, depth) {
    if (!isExpandableValue(value))
        return previewPrimitive(value);
    const array = Array.isArray(value);
    const entries = entriesOf(value);
    const limit = array ? ARRAY_PREVIEW_LIMIT : OBJECT_PREVIEW_LIMIT;
    const visible = entries.slice(0, limit);
    const [open, close] = bracketOf(value);
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: css.punctuation, children: open }), depth >= PREVIEW_DEPTH_LIMIT
                ? _jsx("span", { className: css.previewEllipsis, children: "\u2026" })
                : visible.map(([key, item], index) => (_jsxs("span", { children: [index > 0 && _jsx("span", { className: css.punctuation, children: ", " }), !array && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.previewProperty, children: key }), _jsx("span", { className: css.punctuation, children: ": " })] })), previewValue(item, depth + 1)] }, key))), depth < PREVIEW_DEPTH_LIMIT && entries.length > limit && (_jsx("span", { className: css.previewEllipsis, children: ", \u2026" })), _jsx("span", { className: css.punctuation, children: close })] }));
}
function primitiveValue(value) {
    if (value === null)
        return _jsx("span", { className: css.keywordValue, children: "null" });
    if (typeof value === 'string') {
        return _jsx("span", { className: css.stringValue, children: JSON.stringify(value) });
    }
    if (typeof value === 'boolean') {
        return _jsx("span", { className: css.keywordValue, children: String(value) });
    }
    if (typeof value === 'number') {
        return _jsx("span", { className: css.numberValue, children: String(value) });
    }
    if (typeof value === 'bigint') {
        return _jsx("span", { className: css.numberValue, children: `${value.toString()}n` });
    }
    if (value instanceof Date) {
        return _jsx("span", { className: css.otherValue, children: value.toISOString() });
    }
    if (typeof value === 'function') {
        return _jsxs("span", { className: css.otherValue, children: ["function() ", '{ }'] });
    }
    if (typeof value === 'undefined') {
        return _jsx("span", { className: css.otherValue, children: "undefined" });
    }
    return _jsx("span", { className: css.otherValue, children: value.toString() });
}
function fieldText(field) {
    return field === '' ? '""' : field;
}
function pathId(path) {
    return path.map(part => (typeof part === 'number' ? `n${String(part)}` : `s${String(part.length)}:${part}`)).join('/');
}
function claimFocus(button) {
    button.focus();
}
function moveFocus(button, direction) {
    const tree = button.closest('[role="tree"]');
    /* v8 ignore next -- JsonTree attaches expander handlers only beneath its owning role=tree. */
    if (tree === null)
        return;
    const expanders = Array.from(tree.querySelectorAll('[data-json-expander]'));
    const current = expanders.indexOf(button);
    /* v8 ignore next -- the current expander is a member of the queried non-empty set. */
    if (current < 0 || expanders.length === 0)
        return;
    const next = (current + direction + expanders.length) % expanders.length;
    const nextExpander = expanders[next];
    /* v8 ignore next -- modulo over the non-empty expander set always resolves a member. */
    if (nextExpander !== undefined)
        claimFocus(nextExpander);
}
function NodeField({ field, expandable, onToggle, }) {
    if (field === undefined)
        return null;
    return (_jsxs("span", { className: clsx(css.label, expandable && css.clickableLabel), onClick: expandable ? onToggle : undefined, children: [fieldText(field), ":"] }));
}
function JsonTreeNode({ field, initialExpanded, labels, lastElement, onClaimTabStop, onRowHover, path, tabStopId, value, }) {
    const contentsId = useId();
    const expanderRef = useRef(null);
    const [expanded, setExpanded] = useState(initialExpanded);
    const nodeId = pathId(path);
    const container = isExpandableValue(value);
    const entries = container ? entriesOf(value) : [];
    const expandable = entries.length > 0;
    const toggle = () => {
        setExpanded(current => !current);
        claimFocus(expanderRef.current);
    };
    const onExpanderKeyDown = (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            setExpanded(event.key === 'ArrowRight');
            return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1);
        }
    };
    const row = (children, ariaExpanded) => (_jsx("div", { className: css.row, role: "treeitem", "aria-expanded": ariaExpanded, onMouseOver: (event) => {
            event.stopPropagation();
            onRowHover(event.currentTarget, { path, value });
        }, children: children }));
    if (!container) {
        return row((_jsxs(_Fragment, { children: [_jsx(NodeField, { field: field, expandable: false, onToggle: toggle }), primitiveValue(value), !lastElement && _jsx("span", { className: css.punctuation, children: "," })] })));
    }
    const [open, close] = bracketOf(value);
    if (!expandable) {
        return row((_jsxs(_Fragment, { children: [_jsx(NodeField, { field: field, expandable: false, onToggle: toggle }), _jsx("span", { className: css.punctuation, children: open }), _jsx("span", { className: css.punctuation, children: close }), !lastElement && _jsx("span", { className: css.punctuation, children: "," })] })));
    }
    return row((_jsxs(_Fragment, { children: [_jsx("span", { ref: expanderRef, className: clsx(css.expander, expanded ? css.collapseIcon : css.expandIcon), "data-json-expander": true, role: "button", "aria-label": expanded ? labels.collapseNode : labels.expandNode, "aria-expanded": expanded, "aria-controls": expanded ? contentsId : undefined, tabIndex: tabStopId === nodeId ? 0 : -1, onFocus: () => { onClaimTabStop(nodeId); }, onClick: toggle, onKeyDown: onExpanderKeyDown }), _jsx(NodeField, { field: field, expandable: true, onToggle: toggle }), _jsx("span", { className: css.preview, children: previewValue(value, 0) }), !lastElement && _jsx("span", { className: css.punctuation, children: "," }), expanded && (_jsx("ul", { id: contentsId, role: "group", className: css.children, children: entries.map(([key, item], index) => (_jsx(JsonTreeNode, { field: key, value: item, path: [...path, Array.isArray(value) ? index : key], labels: labels, lastElement: index === entries.length - 1, initialExpanded: false, tabStopId: tabStopId, onClaimTabStop: onClaimTabStop, onRowHover: onRowHover }, key))) }))] })), expanded);
}
function formattedPath(path) {
    return path.reduce((result, part) => {
        if (typeof part === 'number')
            return `${result}[${String(part)}]`;
        return /^[A-Za-z_$][\w$]*$/.test(part)
            ? `${result}.${part}`
            : `${result}[${JSON.stringify(part)}]`;
    }, '$');
}
function copyText(target, mode) {
    if (mode === 'path')
        return formattedPath(target.path);
    if (mode === 'prettyJson')
        return JSON.stringify(target.value, null, 2);
    if (mode === 'json')
        return JSON.stringify(target.value);
    if (typeof target.value === 'string')
        return target.value;
    if (typeof target.value === 'undefined')
        return 'undefined';
    if (typeof target.value === 'bigint')
        return target.value.toString();
    if (typeof target.value === 'symbol')
        return target.value.description ?? 'Symbol';
    if (typeof target.value === 'function')
        return target.value.name || 'Function';
    return JSON.stringify(target.value);
}
/**
 * Render parsed JSON as a compact, keyboard-accessible inspector tree.
 * @param props - Parsed data, accessible label, and display options.
 * @returns A read-only JSON tree with an optionally fixed-open top level.
 */
export function JsonTree({ data, label = 'JSON', className, copyable = true, expandTopLevel = true, labels, }) {
    const copyLabels = useMemo(() => (labels === undefined ? DEFAULT_LABELS : { ...DEFAULT_LABELS, ...labels }), [labels]);
    const rootEntries = entriesOf(data);
    const firstExpandableIndex = rootEntries.findIndex(([, value]) => (isExpandableValue(value) && entriesOf(value).length > 0));
    const firstExpandableEntry = rootEntries[firstExpandableIndex];
    const initialTabStopId = expandTopLevel
        ? firstExpandableEntry === undefined
            ? null
            : pathId([Array.isArray(data) ? firstExpandableIndex : firstExpandableEntry[0]])
        : isExpandableValue(data) && rootEntries.length > 0 ? pathId([]) : null;
    const rootRef = useRef(null);
    const activeRowRef = useRef();
    const copyButtonRef = useRef(null);
    const copyMenuOpenRef = useRef(false);
    const resetTimer = useRef();
    const [copyTarget, setCopyTarget] = useState();
    const [copyState, setCopyState] = useState('idle');
    const [copyMenuOpen, setCopyMenuOpen] = useState(false);
    const [tabStopId, setTabStopId] = useState(initialTabStopId);
    const setActiveRow = (row) => {
        activeRowRef.current?.removeAttribute('data-json-copy-active');
        activeRowRef.current = row;
        row?.setAttribute('data-json-copy-active', '');
    };
    const clearCopyTarget = () => {
        setActiveRow(undefined);
        setCopyTarget(undefined);
        setCopyState('idle');
        copyMenuOpenRef.current = false;
        setCopyMenuOpen(false);
    };
    const copyPosition = (row) => {
        const root = rootRef.current;
        /* v8 ignore next -- row events and viewport listeners run only after the root ref mounts. */
        if (root === null)
            throw new Error('JsonTree root is not mounted');
        const rootRect = root.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        return {
            left: rootRect.left + root.clientWidth - 26,
            side: rowRect.top - rootRect.top > root.clientHeight / 2 ? 'top' : 'bottom',
            top: rowRect.top,
        };
    };
    const positionCopyButton = (row, target) => {
        const position = copyPosition(row);
        setCopyTarget({ ...target, ...position });
    };
    const repositionCopyButton = (row) => {
        const position = copyPosition(row);
        setCopyTarget((current) => {
            /* v8 ignore next -- an active row and its copy target are installed together. */
            if (current === undefined)
                return current;
            return { ...current, ...position };
        });
    };
    useEffect(() => () => {
        if (resetTimer.current !== undefined)
            clearTimeout(resetTimer.current);
        activeRowRef.current?.removeAttribute('data-json-copy-active');
    }, []);
    useEffect(() => {
        activeRowRef.current?.removeAttribute('data-json-copy-active');
        activeRowRef.current = undefined;
        copyMenuOpenRef.current = false;
        setCopyTarget(undefined);
        setCopyState('idle');
        setCopyMenuOpen(false);
        setTabStopId(initialTabStopId);
    }, [data, expandTopLevel, initialTabStopId]);
    useEffect(() => {
        const reposition = () => {
            const row = activeRowRef.current;
            if (row !== undefined)
                repositionCopyButton(row);
        };
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, []);
    const handleRowHover = (row, target) => {
        if (!copyable || copyMenuOpenRef.current)
            return;
        if (activeRowRef.current === row)
            return;
        setActiveRow(row);
        setCopyState('idle');
        copyMenuOpenRef.current = false;
        setCopyMenuOpen(false);
        positionCopyButton(row, target);
    };
    const handleRootMouseOver = (event) => {
        if (!copyable || copyMenuOpenRef.current)
            return;
        /* v8 ignore next -- browser mouse events delivered through React target an Element. */
        if (!(event.target instanceof Element))
            return;
        if (event.target.closest('[data-json-copy-button]') === null)
            clearCopyTarget();
    };
    const handleScroll = (_event) => {
        const row = activeRowRef.current;
        if (row !== undefined)
            repositionCopyButton(row);
    };
    const copy = async (mode) => {
        /* v8 ignore next -- copy controls only render while their target exists. */
        if (copyTarget === undefined)
            return;
        try {
            await navigator.clipboard.writeText(copyText(copyTarget, mode));
            setCopyState('copied');
        }
        catch {
            setCopyState('failed');
        }
        if (resetTimer.current !== undefined)
            clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => { setCopyState('idle'); }, 1_500);
    };
    const [rootOpen, rootClose] = bracketOf(data);
    const copyTargetIsObject = typeof copyTarget?.value === 'object' && copyTarget.value !== null;
    const defaultCopyMode = copyTargetIsObject ? 'prettyJson' : 'value';
    const copyTitle = copyState === 'copied'
        ? copyLabels.copied
        : copyState === 'failed'
            ? copyLabels.copyFailed
            : copyTargetIsObject ? copyLabels.copyPrettyJson : copyLabels.copyValue;
    return (_jsxs("div", { ref: rootRef, className: clsx(css.root, className), onMouseOver: handleRootMouseOver, onMouseLeave: () => {
            if (!copyMenuOpenRef.current)
                clearCopyTarget();
        }, onScroll: handleScroll, children: [expandTopLevel
                ? (_jsxs("div", { className: css.expandedTopLevel, children: [_jsx("div", { className: clsx(css.row, css.topLevelBracket), "data-json-root-row": true, onMouseOver: (event) => {
                                event.stopPropagation();
                                handleRowHover(event.currentTarget, { path: [], value: data });
                            }, children: _jsx("span", { className: css.punctuation, children: rootOpen }) }), _jsx("div", { "aria-label": label, className: clsx(css.container, css.expandedTopLevelContainer), role: "tree", children: rootEntries.map(([key, value], index) => (_jsx(JsonTreeNode, { field: key, value: value, path: [Array.isArray(data) ? index : key], labels: copyLabels, lastElement: index === rootEntries.length - 1, initialExpanded: false, tabStopId: tabStopId, onClaimTabStop: setTabStopId, onRowHover: handleRowHover }, key))) }), _jsx("div", { className: clsx(css.row, css.topLevelBracket), children: _jsx("span", { className: css.punctuation, children: rootClose }) })] }))
                : (_jsx("div", { "aria-label": label, className: css.container, role: "tree", children: _jsx(JsonTreeNode, { value: data, path: [], labels: copyLabels, lastElement: true, initialExpanded: true, tabStopId: tabStopId, onClaimTabStop: setTabStopId, onRowHover: handleRowHover }) })), copyTarget !== undefined && (_jsx("span", { className: css.copyAnchor, style: { left: copyTarget.left, top: copyTarget.top }, children: _jsx(Menu, { open: copyMenuOpen, compact: true, portal: true, align: "end", side: copyTarget.side, anchor: (_jsx("button", { ref: copyButtonRef, type: "button", className: css.copyButton, "data-json-copy-button": true, "data-state": copyState, "aria-label": copyTitle, title: copyLabels.copyButtonTitle(copyTitle), onClick: () => void copy(defaultCopyMode), onContextMenu: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            copyMenuOpenRef.current = true;
                            setCopyMenuOpen(true);
                        }, children: copyState === 'copied'
                            ? _jsx(IconCheckOutline16, { size: 12 })
                            : _jsx(IconCopyOutline16, { size: 12 }) })), items: copyTargetIsObject ? objectCopyMenuItems(copyLabels) : valueCopyMenuItems(copyLabels), onSelect: (id) => {
                        void copy(id);
                        copyMenuOpenRef.current = false;
                        setCopyMenuOpen(false);
                    }, onClose: clearCopyTarget, getAnchorRect: () => copyButtonRef.current.getBoundingClientRect() }) }))] }));
}
//# sourceMappingURL=JsonTree.js.map