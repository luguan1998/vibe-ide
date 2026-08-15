/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController {
    #panels;
    /**
     * Adopt the root entry's bound store actions. Called from the root
     * registration's inject hook (a sanctioned assembly side effect), so the
     * face is live from the entry's first render; on entry re-register the
     * fresh actions overwrite the stale set.
     * @param actions - bound actions of the entry's layout store instance.
     */
    attachPanels(actions) {
        this.#panels = actions;
    }
    /** Toggle the sidebar panel (closed ⟷ contract default width). */
    toggleSidebar() {
        this.#require().toggleSidebar();
    }
    /** Open the details panel (no-op when already open). */
    openDetails() {
        this.#require().openDetails();
    }
    /** Close the details panel. */
    closeDetails() {
        this.#require().closeDetails();
    }
    #require() {
        // Callers are UI gestures, which cannot fire before the root entry
        // rendered (the inject hook runs in its first render) — reaching this
        // unwired is a boot-order bug, not a race to tolerate.
        if (this.#panels === undefined)
            throw new Error('layout: panel actions not wired (root entry not mounted)');
        return this.#panels;
    }
}
//# sourceMappingURL=service.js.map