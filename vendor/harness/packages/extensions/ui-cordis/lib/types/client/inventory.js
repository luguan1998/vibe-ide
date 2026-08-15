/**
 * The host's definition registry as this page last read it, owned by the
 * plugin's apply closure.
 *
 * The panel is a frame-wide surface, so it cannot derive this from any session:
 * the registry is global and the read is a single global call. The rows are
 * re-read rather than patched, because the wire announcements
 * (`cordis/dynamic-package` / `/retract`) carry no labels and a definition
 * can appear or disappear between them — a patch-in-place cache would drift into
 * showing definitions the host no longer holds.
 *
 * Reads are single-flight: several announcements settling at once, or a badge
 * opening while a reconnect re-reads, must not multiply the call. Single-flight
 * alone would be wrong across a reconnect, though — the in-flight read belongs to
 * the previous connection, so a reset both discards its answer and frees the slot
 * for a fresh one. Without that, a reconnect either loses its re-read to the old
 * call or has the old host's rows published on top of it.
 */
/**
 * Create the inventory source.
 * @param port - the RPC seam the read goes through.
 * @param onError - reporter for a failed read (console in production, captured in specs).
 * @returns the inventory observable and its read trigger.
 */
export function createCordisInventory(port, onError) {
    const listeners = new Set();
    let snapshot = { rows: [], removed: new Set(), read: false };
    let inFlight;
    // Bumped by reset; a read whose generation is stale publishes nothing.
    let generation = 0;
    const publish = (next) => {
        snapshot = next;
        for (const listener of [...listeners])
            listener();
    };
    return {
        getSnapshot: () => snapshot,
        subscribe: (fn) => {
            listeners.add(fn);
            return () => { listeners.delete(fn); };
        },
        refresh: () => {
            if (inFlight !== undefined)
                return;
            const issued = generation;
            inFlight = port.inventory().then((rows) => {
                if (issued !== generation)
                    return;
                const removed = new Set(snapshot.removed);
                const live = new Set(rows.map(row => row.pluginId));
                for (const previous of snapshot.rows) {
                    if (!live.has(previous.pluginId))
                        removed.add(previous.pluginId);
                }
                publish({ rows, removed, read: true });
            }, (error) => {
                if (issued !== generation)
                    return;
                onError(error);
                // A failed read keeps whatever was shown and says why: dropping the
                // rows would turn a transient wire failure into "nothing is defined".
                publish({
                    rows: snapshot.rows,
                    removed: snapshot.removed,
                    read: snapshot.read,
                    error: error instanceof Error ? error.message : 'reading the cordis inventory failed',
                });
            }).then(() => { if (issued === generation)
                inFlight = undefined; });
        },
        retire: (pluginId) => {
            const removed = new Set(snapshot.removed);
            removed.add(pluginId);
            publish({ ...snapshot, rows: snapshot.rows.filter(row => row.pluginId !== pluginId), removed });
        },
        reset: () => {
            generation += 1;
            inFlight = undefined;
            publish({ rows: [], removed: snapshot.removed, read: false });
        },
    };
}
//# sourceMappingURL=inventory.js.map