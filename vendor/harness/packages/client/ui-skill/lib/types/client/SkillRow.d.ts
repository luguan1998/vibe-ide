import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Full row props: the toolview runtime share plus this package's locale seat. */
type SkillRowProps = ToolCallViewProps & PropsLocale<'skill'>;
/**
 * Render one `skill` tool call as an accent summary and instructions disclosure.
 * @param props - keyed toolview payload plus the skill locale seat.
 * @returns the dedicated skill row.
 */
export declare function SkillRow({ block, inspect, t }: SkillRowProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=SkillRow.d.ts.map