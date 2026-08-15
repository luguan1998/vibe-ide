import type { WorkspaceBrowserProps } from './contract/slots.ts';
/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export declare function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, renderSlot, t, }: WorkspaceBrowserProps): import("react").JSX.Element;
//# sourceMappingURL=WorkspaceBrowser.d.ts.map