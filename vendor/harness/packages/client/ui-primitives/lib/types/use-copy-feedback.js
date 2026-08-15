// The copy-to-clipboard-with-feedback hook shared by the block primitives
// (TerminalBlock, SearchBlock): write the given text, and on success flip a
// transient `copied` flag that the caller renders as a "复制成功" label for one
// second. A refused write leaves the flag untouched, so the control never claims
// a copy the host declined.
import { useCallback, useState } from 'react';
import { writeClipboard } from "./clipboard.js";
/** How long the `copied` flag stays true after a successful write, in ms. */
const COPIED_FEEDBACK_MS = 1000;
/**
 * Copy `text` to the clipboard with one-second success feedback.
 * @param text - the text to write on copy.
 * @returns the `copied` flag and the `onCopy` handler.
 */
export function useCopyFeedback(text) {
    const [copied, setCopied] = useState(false);
    const onCopy = useCallback(() => {
        if (copied)
            return;
        void writeClipboard(text).then((ok) => {
            if (!ok)
                return;
            setCopied(true);
            window.setTimeout(() => { setCopied(false); }, COPIED_FEEDBACK_MS);
        });
    }, [copied, text]);
    return { copied, onCopy };
}
//# sourceMappingURL=use-copy-feedback.js.map