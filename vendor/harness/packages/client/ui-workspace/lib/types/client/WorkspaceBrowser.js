import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, IconCloseFill14, IconPersonalizationOutline16, IconProjectAddOutline16, IconSearchOutline16, Menu, Modal, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import { deriveFlat, deriveGroups, deriveSearchResults, UNGROUPED_KEY } from "./tree.js";
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from "./rows/Rows.js";
import { FLAT_SESSION_ORDER_KEY } from "./stores.js";
import { WorkspacePickFlow } from "./WorkspacePicker.js";
import css from './WorkspaceBrowser.module.css';
/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300;
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250;
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500;
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5;
/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value) {
    const withoutNul = value.replaceAll('\0', '');
    if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS)
        return withoutNul;
    let end = SEARCH_QUERY_MAX_CODE_UNITS;
    const last = withoutNul.charCodeAt(end - 1);
    const next = withoutNul.charCodeAt(end);
    if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF)
        end--;
    return withoutNul.slice(0, end);
}
/** Immutable membership toggle for the local expand-all array. */
function toggled(list, key) {
    return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
}
/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active) {
    useEffect(() => {
        if (!active)
            return;
        const acceptDrag = (event) => {
            event.preventDefault();
            if (event.dataTransfer !== null)
                event.dataTransfer.dropEffect = 'move';
        };
        const acceptDrop = (event) => { event.preventDefault(); };
        document.addEventListener('dragover', acceptDrag);
        document.addEventListener('drop', acceptDrop);
        return () => {
            document.removeEventListener('dragover', acceptDrag);
            document.removeEventListener('drop', acceptDrop);
        };
    }, [active]);
}
/** Reconcile a stored view order with the Workspace's current session account. */
function reconciledSessionOrder(sessionIds, stored) {
    if (stored === undefined)
        return [...sessionIds];
    const byId = new Map(sessionIds.map(id => [id, id]));
    const ordered = [];
    const included = new Set();
    for (const key of stored) {
        const id = byId.get(key);
        if (id === undefined || included.has(key))
            continue;
        ordered.push(id);
        included.add(key);
    }
    for (const id of sessionIds) {
        if (included.has(id))
            continue;
        ordered.push(id);
    }
    return ordered;
}
/** Newest update first with stable Session identity as the tie-break. */
function compareSessionRecency(a, b, byId) {
    const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY;
    const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY;
    if (aUpdatedAt !== bUpdatedAt)
        return bUpdatedAt - aUpdatedAt;
    return a < b ? -1 : 1;
}
/** Reconcile one editable order account and apply its activity-promotion policy. */
function nextSessionOrderAccount({ sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency, }) {
    let order = reconciledSessionOrder(sessionIds, previousOrder);
    if (sortByRecency) {
        order.sort((a, b) => compareSessionRecency(a, b, list.byId));
    }
    else if (orderBy === 'updated') {
        const promoted = sessionIds
            .filter((id) => {
            const session = list.byId[id];
            return session !== undefined
                && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id]);
        })
            .sort((a, b) => compareSessionRecency(a, b, list.byId));
        if (promoted.length > 0) {
            const promotedIds = new Set(promoted);
            order = [...promoted, ...order.filter(id => !promotedIds.has(id))];
        }
    }
    const updatedAt = {};
    for (const id of sessionIds) {
        const session = list.byId[id];
        if (session !== undefined)
            updatedAt[id] = session.updatedAt;
    }
    const orderChanged = previousOrder === undefined
        || order.length !== previousOrder.length
        || order.some((id, index) => id !== previousOrder[index]);
    const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
        || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp);
    return { order, updatedAt, changed: orderChanged || timestampsChanged };
}
/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }) {
    const [open, setOpen] = useState(false);
    return (_jsx(Menu, { open: open, onClose: () => { setOpen(false); }, items: [
            { type: 'label', id: 'group-by', text: t('groupBy.label') },
            { id: 'workspace', label: t('groupBy.workspace') },
            { id: 'flat', label: t('groupBy.flat') },
            { type: 'separator', id: 'order-by-separator' },
            { type: 'label', id: 'order-by', text: t('orderBy.label') },
            { id: 'manual', label: t('orderBy.manual') },
            { id: 'updated', label: t('orderBy.updated') },
        ], selectedIds: [groupBy, orderBy], onSelect: (id) => {
            if (id === 'workspace' || id === 'flat')
                onGroupPick(id);
            else if (id === 'manual' || id === 'updated')
                onOrderPick(id);
            setOpen(false);
        }, align: "end", dense: true, 
        // Portal: the section header clips overflow, so an in-place list would
        // be cut off at the header's bounds.
        portal: true, anchor: (_jsx(Tooltip, { label: t('viewOptions.label'), side: "bottom", delayMs: 500, children: _jsx("button", { type: "button", className: clsx(css.iconButton, css.wide), "aria-label": t('viewOptions.label'), onClick: () => { setOpen(v => !v); }, children: _jsx(IconPersonalizationOutline16, {}) }) })) }));
}
/** Resolve an insertion side from the full rendered workspace group. */
function workspaceGroupHalf(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}
/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t, }) {
    const list = useSessions(s => s);
    const current = list.current;
    const [expandedSessionGroups, setExpandedSessionGroups] = useState([]);
    // Transient drag marker state; the selected mode owns the resulting order.
    const [drag, setDrag] = useState(null);
    const sessionDropCommitted = useRef(false);
    const [workspaceDrag, setWorkspaceDrag] = useState(null);
    const workspaceDropCommitted = useRef(false);
    const previousOrderBy = useRef(orderBy);
    const nativeDragActive = drag !== null || workspaceDrag !== null;
    useNativeDragAcceptance(nativeDragActive);
    const currentGroup = current === undefined
        ? undefined
        : workspaces.find(w => w.sessionIds.includes(current))?.workspaceId
            ?? UNGROUPED_KEY;
    useEffect(() => {
        if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup))
            return;
        setGroupExpanded(currentGroup, true);
    }, [current, currentGroup, setGroupExpanded, groupExpansion]);
    const expandedGroups = useMemo(() => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key), [groupExpansion]);
    const ungroupedSessionIds = useMemo(() => {
        const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds));
        return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id));
    }, [list, workspaces]);
    useEffect(() => {
        if (list.phase !== 'ready')
            return;
        const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated';
        previousOrderBy.current = orderBy;
        const accounts = [
            ...workspaces.map(workspace => ({
                key: workspace.workspaceId,
                sessionIds: workspace.sessionIds.filter(id => list.byId[id] !== undefined),
            })),
            { key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds },
        ];
        for (const { key, sessionIds } of accounts) {
            const previousOrder = sessionOrderByAccount[key];
            const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {};
            const next = nextSessionOrderAccount({
                sessionIds,
                previousOrder,
                previousUpdatedAt,
                list,
                orderBy,
                sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
            });
            if (next.changed) {
                syncSessionOrderAccount(key, next.order.map(id => id), next.updatedAt);
            }
        }
    }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, ungroupedSessionIds, workspaces]);
    const orderedWorkspaces = useMemo(() => {
        return workspaces.map((workspace) => {
            const stored = sessionOrderByAccount[workspace.workspaceId];
            const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored);
            return { ...workspace, sessionIds };
        });
    }, [sessionOrderByAccount, workspaces]);
    const orderedUngroupedSessionIds = useMemo(() => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY]), [sessionOrderByAccount, ungroupedSessionIds]);
    const groups = useMemo(() => deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
        expandedGroups,
        ...(sessionOrderByAccount[UNGROUPED_KEY] === undefined
            ? {}
            : { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }),
    }), [list, orderedWorkspaces, archivedSessionIds, expandedGroups, sessionOrderByAccount]);
    const now = Date.now();
    const commitSessionDrag = (activeDrag, over) => {
        if (sessionDropCommitted.current)
            return;
        sessionDropCommitted.current = true;
        setDrag(null);
        const group = groups.find(candidate => candidate.key === activeDrag.accountKey);
        if (group === undefined)
            return;
        const targetIndex = group.sessions.findIndex(session => session.id === over.id);
        if (targetIndex === -1)
            return;
        const anchor = over.half === 'before' ? over.id : group.sessions[targetIndex + 1]?.id;
        if (anchor === activeDrag.sessionId)
            return;
        const sourceIndex = group.sessions.findIndex(session => session.id === activeDrag.sessionId);
        const anchorIndex = anchor === undefined
            ? group.sessions.length
            : group.sessions.findIndex(session => session.id === anchor);
        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1))
            return;
        const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
            ? orderedUngroupedSessionIds
            : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds;
        if (accountSessionIds === undefined)
            return;
        const nextOrder = accountSessionIds.filter(id => id !== activeDrag.sessionId);
        const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor);
        nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId);
        setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id));
        if (orderBy === 'updated' || activeDrag.accountKey === UNGROUPED_KEY)
            return;
        insertSessionBefore(activeDrag.accountKey, activeDrag.sessionId, anchor).catch((reason) => {
            console.warn('session reorder rejected:', reason);
        });
    };
    const commitWorkspaceDrag = (activeDrag, over) => {
        if (workspaceDropCommitted.current)
            return;
        workspaceDropCommitted.current = true;
        setWorkspaceDrag(null);
        const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id);
        if (rowIndex === -1)
            return;
        const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId;
        if (anchor === activeDrag.workspaceId)
            return;
        const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId);
        const anchorIndex = anchor === undefined
            ? workspaces.length
            : workspaces.findIndex(workspace => workspace.workspaceId === anchor);
        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1))
            return;
        insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason) => {
            console.warn('workspace reorder rejected:', reason);
        });
    };
    const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
        && workspaceDrag?.over?.id === groups[0].workspaceId
        && workspaceDrag.over.half === 'before';
    return (_jsxs("div", { className: clsx(css.treeBody, css.wide), children: [workspaceDropAtListStart && _jsx("span", { className: css.listTopDropIndicator, "aria-hidden": "true" }), _jsxs("div", { className: clsx(css.list, workspaceDropAtListStart && css.listTopDropActive), role: "tree", "aria-label": t('section.sessions'), children: [groups.length === 0 && (_jsx("div", { className: css.empty, children: t('empty.none') })), groups.map((group) => {
                        const workspaceId = group.workspaceId;
                        const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
                            ? workspaceDrag.over.half
                            : null;
                        const workspaceDragProps = workspaceId === undefined ? undefined : {
                            start: () => {
                                workspaceDropCommitted.current = false;
                                setWorkspaceDrag({ workspaceId, over: null });
                            },
                            end: () => {
                                if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                                    commitWorkspaceDrag(workspaceDrag, workspaceDrag.over);
                                }
                                else {
                                    setWorkspaceDrag(null);
                                }
                                workspaceDropCommitted.current = false;
                            },
                        };
                        const hoverWorkspace = workspaceId === undefined
                            ? undefined
                            : (half) => {
                                setWorkspaceDrag(active => active === null
                                    ? active
                                    : { ...active, over: { id: workspaceId, half } });
                            };
                        const dropWorkspace = workspaceId === undefined
                            ? undefined
                            : (half) => {
                                if (workspaceDrag === null)
                                    return;
                                commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half });
                            };
                        return (_jsxs("div", { className: clsx(css.groupSection, workspaceMarker === 'before' && css.workspaceDropBefore, workspaceMarker === 'after' && css.workspaceDropAfter), onDragOver: workspaceDrag === null || hoverWorkspace === undefined
                                ? undefined
                                : (e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    hoverWorkspace(workspaceGroupHalf(e));
                                }, onDrop: workspaceDrag === null || dropWorkspace === undefined
                                ? undefined
                                : (e) => {
                                    e.preventDefault();
                                    dropWorkspace(workspaceGroupHalf(e));
                                }, children: [_jsx(ProjectRowItem, { group: group, t: t, onToggle: () => {
                                        if (group.expanded) {
                                            setExpandedSessionGroups(keys => keys.filter(key => key !== group.key));
                                        }
                                        setGroupExpanded(group.key, !group.expanded);
                                    }, onCreate: () => {
                                        if (group.workspaceId !== undefined) {
                                            setGroupExpanded(group.key, true);
                                            startSession(group.workspaceId);
                                        }
                                    }, drag: workspaceDragProps, actions: group.workspaceId === undefined
                                        ? undefined
                                        : {
                                            rename: () => {
                                                /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                                                if (group.workspaceId !== undefined)
                                                    onRenameRequest(group.workspaceId, group.label);
                                            },
                                            delete: () => {
                                                /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                                                if (group.workspaceId !== undefined)
                                                    onDeleteRequest(group.workspaceId, group.label);
                                            },
                                        } }), (expandedSessionGroups.includes(group.key)
                                    ? group.sessions
                                    : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {
                                    // Session drag never leaves its group. Ungrouped writes only the
                                    // browser-local account; real Workspaces may also write Host order.
                                    const sameGroupDrag = drag !== null && drag.accountKey === group.key;
                                    const dragProps = {
                                        start: () => {
                                            sessionDropCommitted.current = false;
                                            setDrag({ accountKey: group.key, sessionId: node.id, over: null });
                                        },
                                        active: sameGroupDrag,
                                        marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                                        hover: (half) => {
                                            /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                                            setDrag(d => (d === null ? d : { ...d, over: { id: node.id, half } }));
                                        },
                                        drop: (half) => {
                                            /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                                            if (drag === null)
                                                return;
                                            commitSessionDrag(drag, { id: node.id, half });
                                        },
                                        end: () => {
                                            if (drag?.over !== null && drag?.over !== undefined)
                                                commitSessionDrag(drag, drag.over);
                                            else
                                                setDrag(null);
                                            sessionDropCommitted.current = false;
                                        },
                                    };
                                    return (_jsx(SessionNodeItem, { node: node, currentId: current, now: now, onOpen: open, onRename: onSessionRename, onFork: forkSession, onArchive: onSessionArchive, drag: dragProps, t: t }, node.id));
                                }), group.sessions.length > COLLAPSED_SESSION_LIMIT && (_jsx("button", { type: "button", className: css.sessionOverflowButton, "aria-expanded": expandedSessionGroups.includes(group.key), onClick: () => { setExpandedSessionGroups(keys => toggled(keys, group.key)); }, children: expandedSessionGroups.includes(group.key)
                                        ? t('sessions.collapse')
                                        : t('sessions.expand', { n: group.sessions.length - COLLAPSED_SESSION_LIMIT }) }))] }, group.key));
                    })] }), _jsx("span", { className: css.fade })] }));
}
/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t, }) {
    const list = useSessions(s => s);
    const baseRows = useMemo(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds]);
    const sessionIds = useMemo(() => baseRows.map(row => row.id), [baseRows]);
    const previousOrderBy = useRef(orderBy);
    useEffect(() => {
        if (list.phase !== 'ready')
            return;
        const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY];
        const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {};
        const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated';
        previousOrderBy.current = orderBy;
        const next = nextSessionOrderAccount({
            sessionIds,
            previousOrder,
            previousUpdatedAt,
            list,
            orderBy,
            sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
        });
        if (next.changed) {
            syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map(id => id), next.updatedAt);
        }
    }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount]);
    const rows = useMemo(() => {
        const byId = new Map(baseRows.map(row => [row.id, row]));
        return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
            .flatMap((id) => {
            const row = byId.get(id);
            return row === undefined ? [] : [row];
        });
    }, [baseRows, sessionOrderByAccount, sessionIds]);
    const [drag, setDrag] = useState(null);
    const dropCommitted = useRef(false);
    useNativeDragAcceptance(drag !== null);
    const commitDrag = (activeDrag, over) => {
        if (dropCommitted.current)
            return;
        dropCommitted.current = true;
        setDrag(null);
        const targetIndex = rows.findIndex(row => row.id === over.id);
        if (targetIndex === -1)
            return;
        const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id;
        if (anchor === activeDrag.sessionId)
            return;
        const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId);
        const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor);
        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1))
            return;
        const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId);
        const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor);
        nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId);
        setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id));
    };
    const now = Date.now();
    return (_jsxs("div", { className: clsx(css.treeBody, css.wide), children: [_jsxs("div", { className: clsx(css.list, css.flatList), role: "tree", "aria-label": t('section.sessions'), children: [rows.length === 0 && (_jsx("div", { className: css.empty, children: t('empty.none') })), rows.map((node) => {
                        const active = drag !== null;
                        return (_jsx(SessionNodeItem, { node: node, currentId: list.current, now: now, onOpen: open, onRename: onSessionRename, onFork: forkSession, onArchive: onSessionArchive, flat: true, drag: {
                                start: () => {
                                    dropCommitted.current = false;
                                    setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null });
                                },
                                active,
                                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                                hover: (half) => {
                                    setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } });
                                },
                                drop: (half) => {
                                    if (drag !== null)
                                        commitDrag(drag, { id: node.id, half });
                                },
                                end: () => {
                                    if (drag?.over !== null && drag?.over !== undefined)
                                        commitDrag(drag, drag.over);
                                    else
                                        setDrag(null);
                                    dropCommitted.current = false;
                                },
                            }, t: t }, node.id));
                    })] }), _jsx("span", { className: css.fade })] }));
}
/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({ useSessions, open, workspaces, archivedSessionIds, query, remote, resultLimit, t, }) {
    const list = useSessions(s => s);
    const currentRemote = remote.query === query
        ? remote
        : { query, status: 'loading', items: [], hasMore: false };
    const results = useMemo(() => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit), [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit]);
    const pending = currentRemote.status === 'loading';
    const failed = currentRemote.status === 'error';
    return (_jsxs("div", { className: clsx(css.treeBody, css.wide), children: [_jsxs("div", { className: css.list, children: [_jsx("div", { className: css.searchTree, role: "tree", "aria-label": t('search.results.aria'), children: results.items.map(result => (_jsx(SearchResultItem, { result: result, currentId: list.current, onOpen: open, t: t }, result.id))) }), pending && (_jsx("div", { className: css.searchStatus, role: "status", children: t('search.pending') })), failed && (_jsx("div", { className: css.searchWarning, role: "status", children: t('search.unavailable') })), !pending && results.items.length === 0 && (_jsx("div", { className: css.empty, children: t('search.noMatches') })), results.hasMore && (_jsx("div", { className: css.searchStatus, children: t('search.hasMore', { n: resultLimit }) }))] }), _jsx("span", { className: css.fade })] }));
}
/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, renderSlot, t, }) {
    const workspaces = useWorkspaces(state => state.items);
    const workspacePhase = useWorkspaces(state => state.phase);
    const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds);
    // Live occupancy of this surface's directory-flow hole (the same source the
    // flow reads): a composition without a picking affordance can add nothing.
    const directoryFlowAvailable = useDirectoryFlow(occupied => occupied);
    const groupBy = useStore(s => s.groupBy);
    const orderBy = useStore(s => s.orderBy);
    const groupExpansion = useStore(s => s.groupExpansion);
    const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount);
    const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount);
    useEffect(() => {
        if (workspacePhase !== 'ready')
            return;
        actions.retainAccountKeys([
            UNGROUPED_KEY,
            FLAT_SESSION_ORDER_KEY,
            ...workspaces.map(workspace => workspace.workspaceId),
        ]);
    }, [actions.retainAccountKeys, workspacePhase, workspaces]);
    // The query outlives the tree and the input (both wide-only) so collapsing
    // does not silently drop an in-progress filter.
    const [query, setQuery] = useState('');
    const [searchExpanded, setSearchExpanded] = useState(false);
    const normalizedQuery = sanitizeSearchQuery(query).trim();
    const [remoteSearch, setRemoteSearch] = useState({
        query: '',
        status: 'idle',
        items: [],
        hasMore: false,
    });
    const searchRoot = useRef(null);
    const searchInput = useRef(null);
    // Section-header ＋ opens the picker menu (same popover in wide and rail
    // states; the menu anchors on this button).
    const [wsPickerOpen, setWsPickerOpen] = useState(false);
    const wsPlusRef = useRef(null);
    const composingRef = useRef(false);
    // Rail search = expand + land in the search box: the flag arms before the
    // expand request; once the shell flips wide the input mounts and takes focus.
    const [searchOnExpand, setSearchOnExpand] = useState(false);
    useEffect(() => {
        if (wide && searchOnExpand) {
            const timer = window.setTimeout(() => {
                searchInput.current?.focus({ preventScroll: true });
                setSearchOnExpand(false);
            }, EXPAND_SLIDE_MS);
            return () => { window.clearTimeout(timer); };
        }
    }, [wide, searchOnExpand]);
    useEffect(() => {
        if (!wide || !searchExpanded || searchOnExpand)
            return;
        searchInput.current?.focus({ preventScroll: true });
    }, [wide, searchExpanded, searchOnExpand]);
    useEffect(() => {
        if (!wide || !searchExpanded)
            return;
        const onClick = (event) => {
            if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true)
                return;
            searchInput.current?.blur();
            if (normalizedQuery !== '')
                return;
            setSearchExpanded(false);
        };
        document.addEventListener('click', onClick);
        return () => { document.removeEventListener('click', onClick); };
    }, [normalizedQuery, wide, searchExpanded]);
    useEffect(() => {
        if (normalizedQuery === '') {
            setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false });
            return;
        }
        const controller = new AbortController();
        setRemoteSearch({
            query: normalizedQuery,
            status: 'loading',
            items: [],
            hasMore: false,
        });
        const timer = window.setTimeout(() => {
            searchSessions(normalizedQuery, controller.signal).then((result) => {
                if (controller.signal.aborted)
                    return;
                setRemoteSearch({
                    query: normalizedQuery,
                    status: 'ready',
                    items: result.items,
                    hasMore: result.hasMore,
                });
            }).catch(() => {
                if (controller.signal.aborted)
                    return;
                setRemoteSearch({
                    query: normalizedQuery,
                    status: 'error',
                    items: [],
                    hasMore: false,
                });
            });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [normalizedQuery, searchSessions]);
    // Rename dialog (browser-owned so it outlives row unmounts during collapse).
    const [renameTarget, setRenameTarget] = useState(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [renameError, setRenameError] = useState(null);
    const renameTrimmed = renameDraft.trim();
    const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
        && workspaces.some(w => w.title === renameTrimmed);
    const renameBlocked = renaming || renameTrimmed === ''
        || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate;
    const closeRename = () => {
        if (renaming)
            return;
        setRenameTarget(null);
        setRenameError(null);
    };
    const confirmRename = () => {
        if (renameBlocked)
            return;
        setRenaming(true);
        setRenameError(null);
        renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
            setRenaming(false);
            setRenameTarget(null);
        }).catch((reason) => {
            setRenaming(false);
            setRenameError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    // Session rename dialog (same browser-owned pattern as workspace rename;
    // sessions have no client-side name-conflict rule — the host normalizes).
    // Unlike workspace rename, an unchanged title is NOT blocked: confirming
    // the current automatic title is the gesture that pins it.
    const [sessionRenameTarget, setSessionRenameTarget] = useState(null);
    const [sessionRenameDraft, setSessionRenameDraft] = useState('');
    const [sessionRenaming, setSessionRenaming] = useState(false);
    const [sessionRenameError, setSessionRenameError] = useState(null);
    const sessionRenameTrimmed = sessionRenameDraft.trim();
    const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null;
    const closeSessionRename = () => {
        if (sessionRenaming)
            return;
        setSessionRenameTarget(null);
        setSessionRenameError(null);
    };
    const confirmSessionRename = () => {
        if (sessionRenameBlocked)
            return;
        setSessionRenaming(true);
        setSessionRenameError(null);
        renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
            setSessionRenaming(false);
            setSessionRenameTarget(null);
        }).catch((reason) => {
            setSessionRenaming(false);
            setSessionRenameError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    const onSessionRename = (sessionId, currentTitle) => {
        setSessionRenameTarget({ sessionId, currentTitle });
        setSessionRenameDraft(currentTitle);
        setSessionRenameError(null);
    };
    // Archive is dialog-free: not destructive (the log and the accounting slot
    // remain), so the menu action commits directly; the row disappears when the
    // archive-set echo lands. Failures are non-fatal console diagnostics, the
    // same posture as reorder rejections.
    const onSessionArchive = (sessionId) => {
        archiveSession(sessionId).catch((reason) => {
            console.warn('session archive rejected:', reason);
        });
    };
    // Delete dialog is separate from the row so a successful removal can
    // unmount that row without tearing down the in-flight confirmation state.
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteCommittedId, setDeleteCommittedId] = useState(null);
    const [deleteError, setDeleteError] = useState(null);
    useEffect(() => {
        if (deleteCommittedId === null
            || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId))
            return;
        setDeleting(false);
        setDeleteCommittedId(null);
        setDeleteTarget(null);
    }, [deleteCommittedId, workspaces]);
    const closeDelete = () => {
        if (deleting)
            return;
        setDeleteTarget(null);
        setDeleteError(null);
    };
    const confirmDelete = () => {
        /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
        if (deleting || deleteTarget === null)
            return;
        setDeleting(true);
        setDeleteCommittedId(null);
        setDeleteError(null);
        deleteWorkspace(deleteTarget.workspaceId).then(() => {
            // Keep the confirmation pending until this component has rendered the
            // committed list projection without the deleted id. Closing earlier
            // exposes one stale React frame to the next Create Workspace gesture.
            setDeleteCommittedId(deleteTarget.workspaceId);
        }).catch((reason) => {
            setDeleting(false);
            setDeleteError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    return (_jsxs("div", { className: clsx(css.root, !wide && css.rail), children: [_jsxs("div", { className: css.sectionHeader, children: [wide && (_jsx("span", { className: clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden), children: groupBy === 'flat' ? t('section.sessions') : t('section.workspaces') })), wide && (_jsx("div", { className: clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded), children: _jsxs("div", { ref: searchRoot, className: clsx(css.search, searchExpanded && css.searchExpanded), onClick: () => {
                                setWsPickerOpen(false);
                                setSearchExpanded(true);
                                searchInput.current?.focus();
                            }, children: [_jsx(Tooltip, { label: t('search'), side: "bottom", delayMs: 500, disabled: searchExpanded, children: _jsx("button", { type: "button", className: css.searchButton, "aria-label": t('search.sessions.aria'), "aria-expanded": searchExpanded, onClick: () => {
                                            setWsPickerOpen(false);
                                            setSearchExpanded(true);
                                        }, children: _jsx(IconSearchOutline16, { size: searchExpanded ? 11 : 14 }) }) }), _jsx("input", { ref: searchInput, className: css.searchInput, type: "text", placeholder: t('search.placeholder'), maxLength: SEARCH_QUERY_MAX_CODE_UNITS, value: query, tabIndex: searchExpanded ? 0 : -1, onChange: (e) => { setQuery(sanitizeSearchQuery(e.target.value)); }, onKeyDown: (e) => {
                                        if (e.key !== 'Escape')
                                            return;
                                        setQuery('');
                                        setSearchExpanded(false);
                                    } }), searchExpanded && (_jsx("button", { type: "button", className: css.clearButton, "aria-label": t('search.clear'), onClick: (e) => {
                                        e.stopPropagation();
                                        setQuery('');
                                        setSearchExpanded(false);
                                    }, children: _jsx(IconCloseFill14, {}) }))] }) })), _jsxs("div", { className: clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden), children: [wide && (_jsx(ViewOptionsMenu, { groupBy: groupBy, orderBy: orderBy, onGroupPick: (mode) => { actions.setGroupBy(mode); }, onOrderPick: (mode) => { actions.setOrderBy(mode); }, t: t })), directoryFlowAvailable && (_jsx(Tooltip, { label: t('workspace.add'), side: "bottom", delayMs: 500, children: _jsx("button", { ref: wsPlusRef, type: "button", className: css.iconButton, "aria-label": t('workspace.add'), onClick: () => {
                                        setWsPickerOpen(v => !v);
                                    }, children: _jsx(IconProjectAddOutline16, { size: wide ? 16 : 18 }) }) }))] }), _jsx(WorkspacePickFlow, { t: t, open: wsPickerOpen, anchorRef: wsPlusRef, useWorkspaces: useWorkspaces, createWorkspace: createWorkspace, useDirectoryFlow: useDirectoryFlow, renderDirectoryFlow: owner => renderSlot('sidebar.workspaces.directoryFlow', owner), addOnly: true, side: "right", onPick: (workspaceId) => {
                            setWsPickerOpen(false);
                            startSession(workspaceId);
                        }, onClose: () => { setWsPickerOpen(false); } })] }), !wide && _jsx("div", { className: css.search, children: _jsx(Tooltip, { label: t('search'), children: _jsx("button", { type: "button", className: css.searchButton, "aria-label": t('search.sessions.aria'), onClick: () => {
                            setSearchExpanded(true);
                            setSearchOnExpand(true);
                            expandSidebar();
                        }, children: _jsx(IconSearchOutline16, { size: 18 }) }) }) }), _jsx("div", { className: css.listArea, children: wide && (normalizedQuery !== ''
                    ? (_jsx(SearchResults, { useSessions: useSessions, open: open, workspaces: workspaces, archivedSessionIds: archivedSessionIds, query: normalizedQuery, remote: remoteSearch, resultLimit: searchResultLimit, t: t }))
                    : groupBy === 'flat'
                        ? (_jsx(FlatList, { useSessions: useSessions, open: open, forkSession: forkSession, onSessionRename: onSessionRename, onSessionArchive: onSessionArchive, archivedSessionIds: archivedSessionIds, orderBy: orderBy, sessionOrderByAccount: sessionOrderByAccount, sessionUpdatedAtByAccount: sessionUpdatedAtByAccount, syncSessionOrderAccount: actions.syncSessionOrderAccount, setSessionOrder: actions.setSessionOrder, t: t }))
                        : (_jsx(SessionTree, { useSessions: useSessions, onSessionRename: onSessionRename, onSessionArchive: onSessionArchive, forkSession: forkSession, workspaces: workspaces, groupExpansion: groupExpansion, setGroupExpanded: actions.setGroupExpanded, sessionOrderByAccount: sessionOrderByAccount, sessionUpdatedAtByAccount: sessionUpdatedAtByAccount, syncSessionOrderAccount: actions.syncSessionOrderAccount, setSessionOrder: actions.setSessionOrder, archivedSessionIds: archivedSessionIds, startSession: startSession, open: open, insertWorkspaceBefore: insertWorkspaceBefore, insertSessionBefore: insertSessionBefore, orderBy: orderBy, t: t, onRenameRequest: (workspaceId, currentTitle) => {
                                setRenameTarget({ workspaceId, currentTitle });
                                setRenameDraft(currentTitle);
                                setRenameError(null);
                            }, onDeleteRequest: (workspaceId, title) => {
                                setDeleteTarget({ workspaceId, title });
                                setDeleteError(null);
                            } }))) }), _jsxs(Modal, { open: renameTarget !== null, onClose: closeRename, closeLabel: t('close'), title: t('rename.workspace.title'), footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: renaming, onClick: closeRename, children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: renameBlocked, onClick: confirmRename, children: t('rename') })] })), children: [_jsx("input", { className: css.renameInput, value: renameDraft, "aria-label": t('field.workspaceName'), autoFocus: true, disabled: renaming, onFocus: (e) => { e.target.select(); }, onChange: (e) => { setRenameDraft(e.target.value); setRenameError(null); }, onCompositionStart: () => { composingRef.current = true; }, onCompositionEnd: () => { composingRef.current = false; }, onKeyDown: (e) => {
                            if (e.key === 'Enter' && !composingRef.current) {
                                e.preventDefault();
                                confirmRename();
                            }
                        } }), renameDuplicate && (_jsx("div", { className: css.renameError, role: "alert", children: t('conflict.named', { name: renameTrimmed }) })), renameError !== null && _jsx("div", { className: css.renameError, role: "alert", children: renameError })] }), _jsxs(Modal, { open: sessionRenameTarget !== null, onClose: closeSessionRename, closeLabel: t('close'), title: t('rename.session.title'), footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: sessionRenaming, onClick: closeSessionRename, children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: sessionRenameBlocked, onClick: confirmSessionRename, children: t('rename') })] })), children: [_jsx("input", { className: css.renameInput, value: sessionRenameDraft, "aria-label": t('field.sessionName'), autoFocus: true, disabled: sessionRenaming, onFocus: (e) => { e.target.select(); }, onChange: (e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null); }, onCompositionStart: () => { composingRef.current = true; }, onCompositionEnd: () => { composingRef.current = false; }, onKeyDown: (e) => {
                            if (e.key === 'Enter' && !composingRef.current) {
                                e.preventDefault();
                                confirmSessionRename();
                            }
                        } }), sessionRenameError !== null && _jsx("div", { className: css.renameError, role: "alert", children: sessionRenameError })] }), _jsxs(Modal, { open: deleteTarget !== null, onClose: closeDelete, closeLabel: t('close'), title: t('delete.workspace'), ...deleteTarget === null
                    ? {}
                    : { description: t('delete.desc', { name: deleteTarget.title }) }, footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: deleting, onClick: closeDelete, children: t('cancel') }), _jsx(Button, { variant: "outline", className: css.deleteAction, disabled: deleting, onClick: confirmDelete, children: t('delete.workspace') })] })), children: [deleting && _jsx("div", { className: css.deleteStatus, role: "status", children: t('delete.pending') }), deleteError !== null && _jsx("div", { className: css.renameError, role: "alert", children: deleteError })] })] }));
}
//# sourceMappingURL=WorkspaceBrowser.js.map