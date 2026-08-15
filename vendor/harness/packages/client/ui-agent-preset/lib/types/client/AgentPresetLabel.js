import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The session header's agent-preset label.
 *
 * Read-only by construction: a session's composition is fixed once its
 * conversation starts, and a header is only worth reading after that. Offering
 * a control here would promise a switch the host refuses; naming what the
 * session runs is the honest affordance, and the choice itself lives on the
 * new-session screen ({@link AgentPresetSeat}).
 */
import { useEffect } from 'react';
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { presetDisplayText } from "./locales.js";
import css from './AgentPresetLabel.module.css';
/**
 * Render this session's agent-preset name beside its title.
 * @param props - composed slot props.
 * @returns the label, or null when the session records no preset.
 */
export function AgentPresetLabel({ sessionId, useSessions, useAgentPresets, load, t, }) {
    const preset = useSessions(state => state.byId[sessionId]?.agentPreset);
    const options = useAgentPresets(state => state.options);
    useEffect(() => {
        // Deployments that compose no presets never label anything, so the roster
        // is only worth a request once a session reports one.
        if (preset !== undefined)
            void load();
    }, [preset, load]);
    if (preset === undefined)
        return null;
    const option = options.find(entry => entry.id === preset);
    const text = option === undefined ? undefined : presetDisplayText(option, t);
    return (_jsxs("span", { className: css.label, title: text?.description ?? t('headerHint'), children: [_jsx(IconAgentPresetOutline16, { size: 14, className: css.icon }), text?.name ?? preset] }));
}
//# sourceMappingURL=AgentPresetLabel.js.map