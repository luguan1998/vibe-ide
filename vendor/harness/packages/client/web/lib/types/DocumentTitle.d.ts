/** Props for the shell-owned browser title projection. */
export interface DocumentTitleProps {
    /** Durable title of the selected session, or undefined for the product title. */
    title?: string;
}
/**
 * Project the selected durable session title into the browser title and
 * restore the shell's original product title when unmounted.
 * @param props - selected session title projection.
 * @returns no rendered content.
 */
export declare function DocumentTitle({ title }: DocumentTitleProps): null;
//# sourceMappingURL=DocumentTitle.d.ts.map