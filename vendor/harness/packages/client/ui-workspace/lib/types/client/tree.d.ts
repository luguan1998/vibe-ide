/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import { type PendingInteractionStatus, type SessionId, type SessionListState, type SessionSearchResultItem, type WorkspaceId, type WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client';
/** Group key for Sessions outside every Workspace. */
export declare const UNGROUPED_KEY = "";
/** Display label for the ungrouped bucket row. */
export declare const UNGROUPED_LABEL = "Ungrouped";
/** One top-level session row in a group or the flat list. */
export interface SessionNode {
    id: SessionId;
    /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
    title: string;
    /** The provisional blank session (renderer shows the localized New Session title). */
    blank: boolean;
    /** The runtime Session list reports an interaction awaiting this user. */
    pendingInteraction?: PendingInteractionStatus;
    running: boolean;
    /** Running descendants connected through uninterrupted subagent-origin lineage. */
    runningSubagentCount: number;
    /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
    completed: boolean;
    updatedAt: number;
}
/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated';
/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
    /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
    key: string;
    /** Backing Workspace id; absent only for the ungrouped bucket. */
    workspaceId: WorkspaceId | undefined;
    cwd: string | undefined;
    /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
    createdAt: number | undefined;
    label: string;
    /** Total visible sessions in the group. */
    sessionCount: number;
    expanded: boolean;
    /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
    containsCurrent: boolean;
    /** Visible session rows (empty while the group is folded). */
    sessions: readonly SessionNode[];
}
/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
    id: SessionId;
    title: string;
    workspace: string;
    /** The runtime Session list reports an interaction awaiting this user. */
    pendingInteraction?: PendingInteractionStatus;
    running: boolean;
    /** Running descendants connected through uninterrupted subagent-origin lineage. */
    runningSubagentCount: number;
    /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
    completed: boolean;
    snippet?: string;
}
/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
    items: readonly SearchResultNode[];
    hasMore: boolean;
}
/** Viewing state consumed by the derivation. */
export interface TreeView {
    expandedGroups: readonly string[];
    /** Browser-local order for Sessions without a backing Workspace account. */
    ungroupedOrder?: readonly string[];
}
/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
 */
export declare function workspaceLabel(cwd: string | undefined): string;
/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export declare function deriveGroups(list: SessionListState, workspaces: readonly WorkspaceView[], archivedSessionIds: readonly SessionId[], view: TreeView): GroupNode[];
/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns flat rows in render order.
 */
export declare function deriveFlat(list: SessionListState, archivedSessionIds: readonly SessionId[]): SessionNode[];
/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years';
/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
    unit: RelativeTimeUnit;
    n: number;
}
/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export declare function deriveSearchResults(list: SessionListState, workspaces: readonly WorkspaceView[], query: string, archivedSessionIds: readonly SessionId[], content: {
    items: readonly SessionSearchResultItem[];
    hasMore: boolean;
}, limit: number): SearchResultSet;
/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the session's last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 */
export declare function relativeTime(updatedAt: number, now: number): RelativeTime;
//# sourceMappingURL=tree.d.ts.map