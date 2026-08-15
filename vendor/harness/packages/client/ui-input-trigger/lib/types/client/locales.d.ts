/**
 * `slash.menu` namespace dictionaries: group titles keyed by source name
 * (the lookup chain returns the key itself, so an unknown source shows its
 * raw name), the pending row, and the listbox aria label.
 */
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    command: string;
    skill: string;
    subagent: string;
    loading: string;
    'suggestions.aria': string;
};
/** The slash.menu namespace key union. */
export type MenuKey = keyof typeof zh;
/** English dictionary, checked complete against the zh key set. */
export declare const en: {
    command: string;
    skill: string;
    subagent: string;
    loading: string;
    'suggestions.aria': string;
};
//# sourceMappingURL=locales.d.ts.map