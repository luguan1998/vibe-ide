import { jsx as _jsx } from "react/jsx-runtime";
import css from './GeneralSection.module.css';
/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot }) {
    return (_jsx("div", { className: css.section, children: renderSlot('settings.general.item', {}) }));
}
//# sourceMappingURL=GeneralSection.js.map