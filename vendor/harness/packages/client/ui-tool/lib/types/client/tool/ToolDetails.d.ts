import type { ToolDetailsProps } from '../contract/slots.ts';
/** Pure details-body inputs; framework session seats stay at the slot boundary. */
interface ToolDetailsContentProps {
    block: ToolDetailsProps['block'];
    cwd?: ToolDetailsProps['cwd'];
    t: ToolDetailsProps['t'];
}
/**
 * Render the selected Tool call's structured output when its presentation
 * intent is known, otherwise preserve the flattened result text.
 * @param props - selected call slice, workspace root, and locale seat.
 * @returns the details output body.
 */
export declare function ToolDetails({ block, cwd, t }: ToolDetailsContentProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ToolDetails.d.ts.map