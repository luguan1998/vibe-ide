import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { MenuState } from '../core/contract.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /**
         * The InputBar floating overlay anchor: MenuView (this package) and the
         * popupSelect shell (ui-commands) contribute list entries; each reads its
         * own store and renders null while closed. Declared (children table) by
         * ui-conversation's composer entry; the anchor hides with the input
         * under a takeover.
         */
        'conversation.input.overlay': {
            kind: 'list';
            scope: 'session';
        };
    }
}
/** Injected business face of the MenuView overlay entry (copy rides the standard locale seat, not this face). */
export interface MenuViewInjected {
    /** The service's menu state store (read-only here; MenuView subscribes). */
    menu: SnapshotStore<MenuState>;
    /**
     * Pointer pick routed back through the service pipeline.
     * @param source - source (group) name.
     * @param index - candidate index within the group.
     */
    onPick: (source: string, index: number) => void;
    /** Dismiss the menu (external pointer outside the composer area). */
    onDismiss: () => void;
}
//# sourceMappingURL=slots.d.ts.map