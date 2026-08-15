import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * One provider's editor card, hand-written per adapter family: the primary
 * field is a single write-only **API key** input (the page never asks for an
 * environment-variable name — a typed key stores through `credentials.set`
 * under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile
 * has none. The pi-ai profile records that derivation as `apiKeyEnv` only when
 * a key is entered; a blank key materializes a reference-free profile for
 * provider-native authentication);
 * the collapsed 自定义设置 area carries the per-family extras (`baseURL` for
 * both families, DeepSeek's id/name/context-window model catalog, and the
 * display name and wire protocol of a pi-ai route the adapter does not ship —
 * the two fields the create card asked that route for, editable here for the
 * same reason).
 * Reasoning effort is deliberately absent: it is a per-MODEL capability, and
 * the models under one provider disagree about it, so a provider-scoped
 * control can only be set to a value some of them reject. The composer's
 * model picker offers each model its own levels; `settings.yaml` keeps the
 * profile field for a deployment that knows its route. Everything else stays
 * owned by `settings.yaml`. Profile edits land as minimal `settings.mutate`
 * path ops against the stored section — the card names only the fields it can
 * see instead of rebuilding the whole subtree from a partial descriptor.
 */
import { useEffect, useMemo, useState } from 'react';
import { deletePath, getPath, hasPath, nodeAtPath, rehydrateSchema, setPath, validateDraft, } from '@deepseek-ai/dsh-client-schema-form';
import { DeepSeekModelsEditor, modelDrafts, validateDeepSeekModels, } from "./DeepSeekModelsEditor.js";
import { apiKeyFailure } from "./apiKey.js";
import { EditorFooter } from "./EditorFooter.js";
import { ModelListEditor } from "./ModelListEditor.js";
import { deriveKeyRef, messageOf, protocolChoices } from "./store.js";
import styles from './ModelsSection.module.css';
/** The public DeepSeek endpoint shown as the deepseek base-URL placeholder. */
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com';
/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(namespace, path) {
    const subtree = getPath(namespace.user, path);
    if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree))
        return {};
    return structuredClone(subtree);
}
/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(base, before, after) {
    const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
        ? before
        : {};
    const ops = [];
    for (const [key, value] of Object.entries(after)) {
        if (JSON.stringify(previous[key]) === JSON.stringify(value))
            continue;
        ops.push({ op: 'set', path: [...base, key], value });
    }
    for (const key of Object.keys(previous)) {
        if (!(key in after))
            ops.push({ op: 'unset', path: [...base, key] });
    }
    return ops;
}
/** The editor layout the owning namespace selects. */
function layoutOf(ns) {
    if (ns === 'llm-deepseek')
        return 'deepseek';
    if (ns === 'llm-pi-ai')
        return 'pi-ai';
    return 'unknown';
}
/** The credential reference this profile resolves keys through. */
function refFor(namespace, path, provider) {
    const profile = getPath(namespace.value, path);
    const named = typeof profile === 'object' && profile !== null
        ? profile.apiKeyEnv
        : undefined;
    return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider);
}
/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card.
 */
export function ProviderEditor(props) {
    const { namespace, settingsPath, api, t } = props;
    const [draft, setDraft] = useState(() => draftAt(namespace, settingsPath));
    const [keyDraft, setKeyDraft] = useState('');
    const [keyState, setKeyState] = useState(undefined);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState(undefined);
    // A settings success advances both retry baselines immediately. Keeping the
    // derived fields in the draft prevents a pushed namespace refresh from
    // turning them into deletions when the following credential write is retried.
    const [committedOriginal, setCommittedOriginal] = useState(() => getPath(namespace.user, settingsPath));
    const [expectedRevision, setExpectedRevision] = useState(() => namespace.revision);
    const root = useMemo(() => rehydrateSchema(namespace.schema), [namespace.schema]);
    const node = useMemo(() => nodeAtPath(root, settingsPath), [root, settingsPath]);
    const fallback = getPath(namespace.value, settingsPath);
    const disabled = props.readOnly || busy;
    const layout = layoutOf(namespace.ns);
    const keyRef = refFor(namespace, settingsPath, props.provider);
    // The same schema read the create card makes, so the choices offered here
    // and there cannot drift apart: both come from the adapter's own `Config`.
    // Only the pi-ai layout has a per-route protocol for the read to find, and
    // it rehydrates the whole section schema, so the other layouts skip it.
    const protocols = useMemo(() => layout === 'pi-ai' ? protocolChoices(namespace) : [], [layout, namespace]);
    useEffect(() => {
        let stale = false;
        setKeyState(undefined);
        // The key state is a placeholder hint, not a precondition for editing:
        // neither a business rejection nor a transport failure may reach the
        // browser as an unhandled rejection, so the card simply renders without
        // the "already configured" hint.
        void api.credentials.describe({ refs: [keyRef] }).then((response) => {
            if (stale || !response.result.ok)
                return;
            setKeyState(response.result.value.credentials[keyRef]);
        }, () => undefined);
        return () => { stale = true; };
    }, [api.credentials, keyRef]);
    const stringAt = (source, key) => {
        const value = getPath(source, [key]);
        return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
    };
    const setField = (key, next) => {
        // A value of nothing but whitespace is cleared, not stored: `stringAt`
        // already reports it as absent, so the field would otherwise render empty
        // while the draft still carried the spaces into `settings.yaml`, where
        // both adapters would accept that non-empty string as a real value.
        const value = next === undefined || next.trim().length === 0 ? undefined : next;
        setDraft(current => value === undefined ? deletePath(current, [key]) : setPath(current, [key], value));
    };
    // The model list is validated by the same per-row checker for both families,
    // so a bad row is named by its position rather than by a blanket message.
    const modelFailure = validateDeepSeekModels(getPath(draft, ['models']));
    const keyFailure = apiKeyFailure(keyDraft);
    // What a probe or a write must carry: the typed key with paste whitespace
    // removed. A blank field yields an empty string, which both call sites read
    // as "no key supplied" rather than as a key — that is how a card whose
    // provider already has a stored key is edited without re-entering it.
    const keyValue = keyDraft.trim();
    const credentialRequiredFailure = props.credentialRequired === true
        && keyDraft.length > 0 && keyValue.length === 0
        ? 'keyRequired'
        : undefined;
    const shownKeyFailure = credentialRequiredFailure ?? keyFailure;
    // What the form currently shows, which is what an interrogation must ask:
    // an edited-but-unsaved endpoint, and a key typed but not yet stored.
    const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api');
    const probeBaseURL = stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL');
    const probe = {
        settingsNs: namespace.ns,
        // Naming the route lets an adapter that already describes it answer from
        // its own registry — better metadata, no network call, no endpoint needed.
        provider: props.provider,
        ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
        ...probeApi === undefined ? {} : { api: probeApi },
        ...keyValue.length === 0 ? {} : { apiKey: keyValue },
    };
    /**
     * The write for this card, or a failure message. Every edit travels as
     * path ops against the STORED section: the draft comes from the redacted
     * descriptor, so a wholesale replace rebuilt from it could delete fields
     * outside the card. Ops name only the fields this card can see.
     */
    const applyOnce = async () => {
        const ns = namespace.ns;
        // A pi-ai profile names the conventional reference only when this page is
        // about to store a key. Otherwise the provider keeps its native auth path.
        const next = layout === 'pi-ai' && stringAt(draft, 'apiKeyEnv') === undefined
            && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
            ? setPath(draft, ['apiKeyEnv'], keyRef)
            : draft;
        if (props.credentialOnly !== true) {
            // The same checker gates the submit button, so a card cannot reach this
            // with a bad row; it stays because the schema check below would refuse
            // the write with a message naming a path instead of the row, and because
            // nothing but this function decides what is written.
            const failure = validateDeepSeekModels(getPath(next, ['models']));
            /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
            if (failure !== undefined) {
                return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`;
            }
        }
        /* v8 ignore next -- apply is only reachable from the rendered card, which required a resolved node */
        if (props.credentialOnly !== true && node !== undefined && settingsPath.length === 0) {
            const sectionError = validateDraft(node, next);
            if (sectionError !== undefined)
                return sectionError;
        }
        const materializesNativeProfile = layout === 'pi-ai'
            && fallback === undefined
            && committedOriginal === undefined
            && Object.keys(next).length === 0;
        const ops = props.credentialOnly === true
            ? []
            : materializesNativeProfile
                ? [{ op: 'set', path: [...settingsPath], value: {} }]
                : pathOps(settingsPath, committedOriginal, next);
        if (ops.length > 0) {
            const response = await api.settings.mutate({ ns, ops, expectedRevision });
            if (!response.result.ok) {
                return response.result.error.code === 'settings-conflict'
                    ? t('conflict')
                    : response.result.error.message;
            }
            setCommittedOriginal(getPath(response.result.value.user, settingsPath));
            setExpectedRevision(response.result.value.revision);
            setDraft(next);
        }
        if (keyValue.length > 0) {
            const stored = await api.credentials.set({ ref: keyRef, value: keyValue });
            if (!stored.result.ok)
                return stored.result.error.message;
        }
        setKeyDraft('');
        return undefined;
    };
    const apply = async () => {
        setBusy(true);
        setFailure(undefined);
        try {
            const failure = await applyOnce();
            if (failure !== undefined) {
                setFailure(failure);
                return;
            }
            props.onClose(true);
        }
        catch (error) {
            // A transport failure (disconnect, a request the host refuses) rejects
            // rather than answering; without this the card would stay busy forever
            // with no error shown.
            setFailure(messageOf(error));
        }
        finally {
            setBusy(false);
        }
    };
    if (node === undefined) {
        // A directory entry addressing a position its schema cannot resolve is a
        // host-side inconsistency; showing it beats a blank card.
        return _jsx("p", { className: styles['error'], children: `${props.provider}: unresolvable settings path` });
    }
    const keyLocked = keyState?.writable === false;
    /**
     * The catalog beneath the user layer: what the composition entry pinned, or
     * else the schema default that `resolve` would supply. The effective value
     * cannot answer this — it still carries the stored override until the unset
     * is applied, so reading it would echo that override straight back the
     * moment reset drops it, leaving the rows unchanged until a reload.
     */
    const inheritedModels = () => {
        const pinned = getPath(namespace.base, [...settingsPath, 'models']);
        return pinned ?? nodeAtPath(root, [...settingsPath, 'models'])?.meta.default;
    };
    /**
     * The curated fields of one known adapter family. The family arrives
     * narrowed so the per-family branches below are total: an unknown namespace
     * renders the hint instead and never reaches this body.
     */
    const curatedFields = (family) => {
        // What a hand-declared route names for itself and nothing else can supply.
        // A whole-section `llm-deepseek` profile is a composition fact with no
        // per-route identity for its schema to carry, hence the family test.
        const ownsIdentity = family === 'pi-ai' && props.declared === true;
        const customModels = getPath(draft, ['models']);
        const modelsOverridden = hasPath(draft, ['models']);
        const models = modelDrafts(modelsOverridden ? customModels : inheritedModels());
        const defaultContextWindow = getPath(fallback, ['defaultContextWindow']);
        const defaultMaxTokens = getPath(fallback, ['maxTokens']);
        const keyPlaceholder = keyLocked
            ? t('keyEnvLocked')
            : keyState?.configured === true && props.credentialRequired !== true
                ? t('keyStored')
                : family === 'pi-ai' ? t('keyPlaceholderNative') : t('keyPlaceholder');
        /** What both family editors take: the rows, whose layer owns them, and the two writes. */
        const catalogProps = {
            models,
            overridden: modelsOverridden,
            t,
            disabled,
            onChange: (next) => {
                setDraft(current => setPath(current, ['models'], next));
            },
            onReset: () => { setDraft(current => deletePath(current, ['models'])); },
        };
        return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('keyInput') }), _jsx("input", { className: styles['input'], type: "password", autoComplete: "off", value: keyDraft, placeholder: keyPlaceholder, "aria-label": t('keyInput'), "aria-invalid": shownKeyFailure !== undefined, required: props.credentialRequired === true, autoFocus: props.autoFocusCredential === true, disabled: disabled || keyLocked, onChange: (event) => { setKeyDraft(event.target.value); } }), shownKeyFailure === undefined ? null : _jsx("p", { className: styles['error'], children: t(shownKeyFailure) })] }), props.credentialOnly === true ? null : _jsxs("details", { className: styles['customized'], children: [_jsx("summary", { className: styles['customizedSummary'], children: t('customized') }), _jsxs("div", { className: styles['customizedBody'], children: [ownsIdentity
                                    ? (_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('customDisplayName') }), _jsx("input", { className: styles['input'], type: "text", value: stringAt(draft, 'displayName') ?? '', 
                                                // What this route is called the moment the field is
                                                // cleared, which is the layer beneath the one this field
                                                // edits: a `cordis.yml` may pin a name for a route the
                                                // catalog does not ship, and only when nothing does is
                                                // the answer the route id. Reading the effective value
                                                // instead would echo the stored override back as the
                                                // thing clearing restores.
                                                placeholder: stringAt(getPath(namespace.base, settingsPath), 'displayName')
                                                    ?? props.provider, "aria-label": t('customDisplayName'), disabled: disabled, onChange: (event) => { setField('displayName', event.target.value); } })] }))
                                    : null, _jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('baseUrl') }), _jsx("input", { className: styles['input'], type: "text", value: stringAt(draft, 'baseURL') ?? '', placeholder: family === 'deepseek'
                                                ? DEEPSEEK_PUBLIC_BASE_URL
                                                : stringAt(fallback, 'baseURL') ?? t('baseUrlDefault'), "aria-label": t('baseUrl'), disabled: disabled, onChange: (event) => {
                                                setField('baseURL', event.target.value === '' ? undefined : event.target.value);
                                            } })] }), ownsIdentity
                                    ? (_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('customApi') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: probeApi ?? '', "aria-label": t('customApi'), disabled: disabled, onChange: (event) => { setField('api', event.target.value); }, children: [probeApi === undefined ? _jsx("option", { value: "", children: t('customApiUnset') }) : null, protocols.map(choice => _jsx("option", { value: choice, children: choice }, choice))] })] }))
                                    : null, family === 'deepseek'
                                    ? (_jsx(DeepSeekModelsEditor, { ...catalogProps, defaultContextWindow: typeof defaultContextWindow === 'number'
                                            ? defaultContextWindow
                                            : undefined, defaultMaxTokens: typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined }))
                                    : _jsx(ModelListEditor, { ...catalogProps, probe: probe, probeBlocked: keyFailure, api: api })] })] })] }));
    };
    return (_jsxs("div", { className: props.credentialOnly === true ? styles['addBlock'] : styles['editor'], children: [props.hideTitle === true
                ? null
                : (_jsxs("div", { className: styles['editorHeader'], children: [_jsx("span", { className: styles['editorTitle'], children: props.displayName }), props.provider !== props.displayName
                            ? _jsx("span", { className: styles['editorRoute'], children: props.provider })
                            : null] })), layout === 'unknown'
                ? _jsx("p", { className: styles['advancedHint'], children: `${t('advancedHint')} (${namespace.ns})` })
                : curatedFields(layout), failure !== undefined ? _jsx("p", { className: styles['error'], children: failure }) : null, props.credentialOnly === true || modelFailure === undefined
                ? null
                : (_jsx("p", { className: styles['advancedHint'], children: `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}` })), _jsx(EditorFooter, { t: t, busy: busy, submitDisabled: disabled || layout === 'unknown'
                    || (props.credentialOnly !== true && modelFailure !== undefined)
                    || shownKeyFailure !== undefined
                    || (props.credentialRequired === true && keyValue.length === 0), submitLabel: props.submitLabel ?? 'apply', submitBusyLabel: props.submitBusyLabel ?? 'applying', ...props.cancelLabel === undefined ? {} : { cancelLabel: props.cancelLabel }, onCancel: () => { props.onClose(false); }, onSubmit: () => { void apply(); } })] }));
}
//# sourceMappingURL=ProviderEditor.js.map