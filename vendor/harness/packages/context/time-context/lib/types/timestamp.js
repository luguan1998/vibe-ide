/** ISO-shaped time-context timestamp formatting shared by production and replay validation. */
/**
 * Create the exact formatter used by durable time-context readings.
 * @param timeZone - Explicit display zone, or `undefined` for the process fallback.
 * @returns A formatter with stable numeric local fields and long numeric offset.
 */
export function createTimestampFormatter(timeZone) {
    return new Intl.DateTimeFormat('en-US', {
        ...(timeZone === undefined ? {} : { timeZone }),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'longOffset',
    });
}
/**
 * Format an epoch millisecond value as an ISO-shaped timestamp with offset and IANA zone.
 * @param now - Epoch milliseconds to display.
 * @param formatter - Formatter created for `timeZone`.
 * @param timeZone - Canonical zone label carried in brackets.
 * @returns The durable timestamp text.
 */
export function formatTimestamp(now, formatter, timeZone) {
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    const offset = parts.timeZoneName.replace(/^GMT$/, 'GMT+00:00').slice(3);
    return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}:${parts['second']}${offset}[${timeZone}]`;
}
//# sourceMappingURL=timestamp.js.map