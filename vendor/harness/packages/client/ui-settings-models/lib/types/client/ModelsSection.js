import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */
import { useState } from 'react';
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { CustomProviderCard } from "./CustomProviderCard.js";
import { deriveKeyRef, messageOf, protocolChoices, providerUsable } from "./store.js";
import { ProviderEditor } from "./ProviderEditor.js";
import styles from './ModelsSection.module.css';
/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }) {
    return (_jsx(ProviderEditor, { provider: target.provider, displayName: target.displayName, settingsPath: target.settingsPath, ...target.declared === true ? { declared: true } : {}, ...props }));
}
/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(api, controller, target) {
    try {
        if (target.credentialRef !== undefined) {
            const credential = await api.credentials.unset({ ref: target.credentialRef });
            if (!credential.result.ok)
                return credential.result.error.message;
        }
        const response = await api.settings.mutate({
            ns: target.settingsNs,
            ops: [{ op: 'unset', path: [...target.settingsPath] }],
        });
        if (!response.result.ok)
            return response.result.error.message;
    }
    catch (error) {
        // The transport rejected rather than answering; the caller must be able
        // to retry the idempotent operation instead of the row silently staying.
        return messageOf(error);
    }
    await controller.load();
    return undefined;
}
/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row, anyUsable) {
    if (anyUsable)
        return false;
    if (row.entry.settingsPath.length > 0)
        return false;
    return row.credential?.configured !== true;
}
function targetOf(row) {
    const managedRef = deriveKeyRef(row.entry.provider);
    const credentialRef = row.apiKeyEnv === managedRef
        && row.credential?.configured === true
        && row.credential.writable
        ? managedRef
        : undefined;
    return {
        provider: row.entry.provider,
        displayName: row.entry.displayName,
        settingsNs: row.entry.settingsNs,
        settingsPath: row.entry.settingsPath,
        ...credentialRef === undefined ? {} : { credentialRef },
        // Absent is not "shipped": an adapter that answers nothing leaves the
        // route-level fields only a declared route owns off the card, exactly as
        // it leaves the custom tag off the row.
        ...row.entry.declared === true ? { declared: true } : {},
    };
}
/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target) {
    return target.provider === target.displayName
        ? target.provider
        : `${target.displayName} (${target.provider})`;
}
/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template, target) {
    return template.replace('{provider}', () => providerTargetLabel(target));
}
/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props) {
    const { controller, useSnapshot, api, t } = props;
    if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined)
        return null;
    return _jsx(Loaded, { injected: { controller, useSnapshot, api, t } });
}
function Loaded({ injected }) {
    const { controller, api, t } = injected;
    const state = injected.useSnapshot(snapshot => snapshot);
    const [editing, setEditing] = useState(undefined);
    const [adding, setAdding] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(undefined);
    const [deleting, setDeleting] = useState(false);
    const [deleteFailure, setDeleteFailure] = useState(undefined);
    const [savedTarget, setSavedTarget] = useState(undefined);
    const [declaring, setDeclaring] = useState(false);
    const [dismissedSetup, setDismissedSetup] = useState(() => new Set());
    const announceSaved = (target) => {
        // Announced only once the refreshed directory is in the snapshot the
        // notice reads its name from: an apply can rename the route, and the
        // target captured when the card opened still carries the old name.
        void controller.load().then(() => { setSavedTarget(target); });
    };
    const closeEditor = (changed, target) => {
        setEditing(undefined);
        setAdding(false);
        setDeclaring(false);
        if (changed)
            announceSaved(target);
    };
    /**
     * Close a setup card, which owns none of the state above: the row-editor,
     * add, and declare cards each own one of those, so clearing them here would
     * discard a draft the user opened beside this card. Dismissal is this card's
     * own — the provider falls back to an ordinary row for the rest of the
     * session, and reopens through Edit.
     */
    const closeSetup = (changed, target) => {
        setDismissedSetup(previous => new Set([...previous, target.provider]));
        if (changed)
            announceSaved(target);
    };
    const closeDelete = () => {
        if (deleting)
            return;
        setDeleteTarget(undefined);
        setDeleteFailure(undefined);
    };
    const confirmDelete = () => {
        /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
        if (deleteTarget === undefined || deleting)
            return;
        setDeleting(true);
        setDeleteFailure(undefined);
        void removeProviderProfile(api, controller, deleteTarget)
            .then((failure) => {
            if (failure !== undefined) {
                setDeleteFailure(failure);
                return;
            }
            setDeleteTarget(undefined);
        })
            .finally(() => { setDeleting(false); });
    };
    if (state.status === 'idle')
        void controller.load();
    if (state.status === 'error') {
        /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
        const errorText = state.error ?? '';
        return (_jsxs("div", { className: styles['section'], children: [_jsx("p", { className: styles['error'], children: `${t('loadFailed')}: ${errorText}` }), _jsx("button", { type: "button", className: styles['secondaryButton'], onClick: () => { void controller.load(); }, children: t('retry') })] }));
    }
    // The saved provider as the directory currently names it. The route id is
    // what the apply cannot change, so it is what the notice is keyed by; a row
    // the same apply removed keeps the captured identity, since nothing newer
    // exists to name it with.
    const savedRow = savedTarget === undefined
        ? undefined
        : state.rows.find(row => row.entry.provider === savedTarget.provider);
    const savedIdentity = savedRow === undefined
        ? savedTarget
        : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName };
    // One fact decides both first-run postures on this page and the onboarding
    // step: whether the user already has a provider to talk to.
    const anyUsable = state.rows.some(providerUsable);
    const configured = state.rows.filter(row => row.configured);
    const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '');
    const addTarget = adding ? editing : undefined;
    const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs);
    // Hand-declared routes live in the pi-ai namespace, which is also the only
    // one whose schema names the protocols one may speak; without it mounted
    // there is nothing to declare and the entry point stays disabled.
    const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'));
    return (_jsxs("div", { className: styles['section'], children: [_jsx("h2", { className: styles['title'], children: t('title') }), _jsx("p", { className: styles['intro'], children: t('intro') }), !state.writable && state.status === 'ready' ? _jsx("p", { className: styles['notice'], children: t('readOnly') }) : null, savedIdentity === undefined
                ? null
                : (_jsx("p", { className: styles['savedNotice'], role: "status", "aria-live": "polite", children: providerCopy(t('savedProvider'), savedIdentity) })), _jsx("ul", { className: styles['rows'], children: configured.map((row) => {
                    const target = targetOf(row);
                    const namespace = state.namespaces.get(target.settingsNs);
                    /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
                    if (namespace === undefined)
                        return null;
                    if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
                        // First-run posture: the provider exists but has no key — the
                        // setup card IS its presence on the page, until the user closes it.
                        return (_jsx("li", { className: styles['setupCard'], children: renderProviderEditor({
                                target,
                                namespace,
                                api,
                                t,
                                readOnly: !state.writable,
                                onClose: (changed) => { closeSetup(changed, target); },
                            }) }, row.entry.provider));
                    }
                    const open = !adding && editing?.provider === row.entry.provider;
                    const credentialConfigured = row.credential?.configured === true;
                    const credentialMissing = !credentialConfigured
                        && row.apiKeyEnv !== undefined
                        && row.credential?.configured === false;
                    return (_jsxs("li", { className: styles['rowCard'], children: [_jsxs("div", { className: styles['rowHead'], children: [_jsxs("span", { className: styles['rowIdentity'], children: [_jsx("span", { className: styles['rowName'], children: row.entry.displayName }), row.entry.declared === true
                                                ? _jsx("span", { className: styles['rowTag'], children: t('customTag') })
                                                : null, credentialConfigured
                                                ? (_jsx("span", { className: `${styles['credentialDot']} ${styles['credentialDotConfigured']}`, role: "img", "aria-label": t('credentialConfigured'), title: t('credentialConfigured') }))
                                                : credentialMissing
                                                    ? (_jsx("span", { className: `${styles['credentialDot']} ${styles['credentialDotMissing']}`, role: "img", "aria-label": t('credentialMissing'), title: t('credentialMissing') }))
                                                    : null] }), _jsxs("span", { className: styles['rowActions'], children: [_jsx("button", { type: "button", className: styles['secondaryButton'], "aria-label": providerCopy(t('editProvider'), target), onClick: () => {
                                                    setSavedTarget(undefined);
                                                    // One card at a time: leaving `declaring` set would show
                                                    // the create card beside this editor, and closing either
                                                    // one discards the other's draft.
                                                    setDeclaring(false);
                                                    setAdding(false);
                                                    setEditing(open ? undefined : target);
                                                }, children: t('edit') }), row.removable
                                                ? (_jsx("button", { type: "button", className: styles['dangerButton'], "aria-label": providerCopy(t('removeProvider'), target), disabled: !state.writable, onClick: () => {
                                                        setSavedTarget(undefined);
                                                        setDeleteFailure(undefined);
                                                        setDeleteTarget(target);
                                                    }, children: t('remove') }))
                                                : null] })] }), open
                                ? renderProviderEditor({
                                    target,
                                    namespace,
                                    api,
                                    t,
                                    readOnly: !state.writable,
                                    onClose: (changed) => { closeEditor(changed, target); },
                                })
                                : null] }, row.entry.provider));
                }) }), _jsx("div", { className: styles['addBlock'], children: addTarget !== undefined && addNamespace !== undefined
                    ? (_jsxs("div", { className: styles['addCard'], children: [_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('provider') }), _jsx("select", { className: `${styles['input']} ${styles['selectInput']}`, value: addTarget.provider, "aria-label": t('provider'), onChange: (event) => {
                                            const row = addable.find(candidate => candidate.entry.provider === event.target.value);
                                            /* v8 ignore next -- the select only lists addable rows */
                                            if (row === undefined)
                                                return;
                                            setEditing(targetOf(row));
                                        }, children: addable.map(row => (_jsx("option", { value: row.entry.provider, children: row.entry.displayName }, row.entry.provider))) })] }), _jsx(ProviderEditor, { provider: addTarget.provider, displayName: addTarget.displayName, hideTitle: true, namespace: addNamespace, settingsPath: addTarget.settingsPath, api: api, t: t, readOnly: !state.writable, onClose: (changed) => { closeEditor(changed, addTarget); } }, addTarget.provider)] }))
                    : declaring
                        ? (_jsx("div", { className: styles['addCard'], children: _jsx(CustomProviderCard, { taken: state.rows.map(row => row.entry.provider), protocols: protocols, 
                                /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                                revision: state.namespaces.get('llm-pi-ai')?.revision ?? 0, api: api, t: t, readOnly: !state.writable, onClose: (changed) => {
                                    setDeclaring(false);
                                    if (changed)
                                        void controller.load();
                                } }) }))
                        : (_jsxs("div", { className: styles['addActions'], children: [_jsxs("button", { type: "button", className: styles['addButton'], disabled: addable.length === 0 || !state.writable, onClick: () => {
                                        const first = addable[0];
                                        /* v8 ignore next -- the button is disabled while nothing is addable */
                                        if (first === undefined)
                                            return;
                                        setSavedTarget(undefined);
                                        setDeclaring(false);
                                        setAdding(true);
                                        setEditing(targetOf(first));
                                    }, children: [_jsx(IconPlusOutline16, { size: 14 }), t('add')] }), _jsxs("button", { type: "button", className: styles['addButton'], disabled: protocols.length === 0 || !state.writable, onClick: () => {
                                        setSavedTarget(undefined);
                                        setAdding(false);
                                        setEditing(undefined);
                                        setDeclaring(true);
                                    }, children: [_jsx(IconPlusOutline16, { size: 14 }), t('customAdd')] })] })) }), _jsx(Modal, { open: deleteTarget !== undefined, onClose: closeDelete, title: deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget), closeLabel: t('close'), description: deleteTarget === undefined
                    ? ''
                    : providerCopy(deleteTarget.credentialRef === undefined
                        ? t('deleteDescription')
                        : t('deleteDescriptionWithCredential'), deleteTarget), className: styles['deleteDialog'], footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", autoFocus: true, disabled: deleting, onClick: closeDelete, children: t('cancel') }), _jsx(Button, { variant: "outline", className: styles['deleteConfirm'], disabled: deleting, onClick: confirmDelete, children: deleteTarget === undefined
                                ? ''
                                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget) })] })), children: deleteFailure === undefined ? null : _jsx("p", { className: styles['error'], children: deleteFailure }) })] }));
}
//# sourceMappingURL=ModelsSection.js.map