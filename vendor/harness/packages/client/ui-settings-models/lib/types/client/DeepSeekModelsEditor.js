import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Curated editor for the direct DeepSeek adapter's advisory model catalog.
 * The settings layer replaces `models` as one array, so the parent supplies
 * the effective inherited rows until the first edit materializes a user
 * override; reset removes that override instead of copying defaults into it.
 */
import { useState } from 'react';
import { IconChevronDownOutline14, IconChevronRightOutline14, IconPlusOutline16, IconTrashOutline16, } from '@deepseek-ai/dsh-client-ui-primitives';
import styles from './ModelsSection.module.css';
/** Row index encoded in an editing-buffer key. */
function rowOf(key) {
    return Number(key.slice(0, key.indexOf(':')));
}
/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 };
/**
 * Read a typed capacity, so a user can write `256K` or `1M` instead of counting
 * zeroes. The stored value stays a plain token count.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (inherit), `NaN` when unreadable
 * (rejected by {@link validateDeepSeekModels} before any write).
 */
export function parseCapacity(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return undefined;
    const match = CAPACITY_PATTERN.exec(trimmed);
    if (match === null)
        return Number.NaN;
    const suffix = match[2]?.toLowerCase();
    const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1;
    const scaled = Number(match[1]) * scale;
    // A decimal multiple is exact in intent but not in binary floating point
    // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
    const rounded = Math.round(scaled);
    return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}
/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value) {
    if (!Number.isInteger(value) || value <= 0)
        return String(value);
    if (value % CAPACITY_SCALE.m === 0)
        return `${String(value / CAPACITY_SCALE.m)}M`;
    if (value % CAPACITY_SCALE.k === 0)
        return `${String(value / CAPACITY_SCALE.k)}K`;
    return String(value);
}
/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value) {
    if (!Array.isArray(value))
        return [];
    return value.map(entry => typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry
        : {});
}
/**
 * Validate adapter constraints that the serialized schema cannot express.
 * @param value - user-owned `models` value, or undefined while inherited.
 * @returns the first invalid row, or undefined when the adapter will accept it.
 */
export function validateDeepSeekModels(value) {
    if (value === undefined)
        return undefined;
    const models = modelDrafts(value);
    const seen = new Set();
    for (const [index, model] of models.entries()) {
        // Compared trimmed: surrounding whitespace is a paste artifact the adapter
        // would never match, and an untrimmed compare lets `model ` slip past the
        // duplicate check against its own twin.
        const id = model['id'];
        const trimmed = typeof id === 'string' ? id.trim() : undefined;
        if (trimmed === undefined || trimmed.length === 0)
            return { index, key: 'modelIdRequired' };
        if (seen.has(trimmed))
            return { index, key: 'modelIdDuplicate' };
        seen.add(trimmed);
        const name = model['name'];
        if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
            return { index, key: 'modelNameInvalid' };
        }
        const contextWindow = model['contextWindow'];
        if (contextWindow !== undefined
            && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
            return { index, key: 'modelContextInvalid' };
        }
        const maxTokens = model['maxTokens'];
        if (maxTokens !== undefined
            && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
            return { index, key: 'modelMaxTokensInvalid' };
        }
    }
    return undefined;
}
/**
 * Render the direct DeepSeek adapter's model catalog: id and display name on
 * each row, capacities behind the row's own disclosure.
 * @param props - effective rows plus the array-level override actions.
 * @returns the catalog editor.
 */
export function DeepSeekModelsEditor(props) {
    // Capacities are edited as text, so a field's keystrokes are held here
    // rather than re-derived from the parsed count on every change, which would
    // rewrite `1000` to `1K` mid-word. Unreadable text is kept past blur so the
    // save-time rejection names a row the user can still see — which is why
    // this is one entry PER FIELD: a single active buffer would be displaced by
    // editing any other field, and the abandoned one would fall back to
    // rendering its stored NaN as the literal `NaN`.
    //
    // Keys carry the row index, so the two operations that move indexes maintain
    // them: `remove` re-keys around the dropped row, and reset clears them all
    // because the rows they annotated are gone.
    const [editing, setEditing] = useState(() => new Map());
    const [expanded, setExpanded] = useState(() => new Set());
    const update = (index, key, value) => {
        const next = props.models.map((model, at) => {
            const copy = { ...model };
            if (at !== index)
                return copy;
            if (value === undefined)
                Reflect.deleteProperty(copy, key);
            else
                copy[key] = value;
            return copy;
        });
        props.onChange(next);
    };
    const remove = (index) => {
        setEditing((current) => {
            const next = new Map();
            for (const [key, text] of current) {
                const at = rowOf(key);
                if (at === index)
                    continue;
                // Only the row number moves; the field half of the key is untouched.
                next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, text);
            }
            return next;
        });
        setExpanded((current) => {
            const next = new Set();
            for (const at of current) {
                if (at === index)
                    continue;
                next.add(at > index ? at - 1 : at);
            }
            return next;
        });
        props.onChange(props.models.filter((_model, at) => at !== index).map(model => ({ ...model })));
    };
    const reset = () => {
        setEditing(new Map());
        setExpanded(new Set());
        props.onReset();
    };
    const toggle = (index) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(index))
                next.add(index);
            return next;
        });
    };
    /** The field's text: its live keystrokes, else the stored count spelled short. */
    const capacityText = (model, index, field) => {
        const typed = editing.get(`${String(index)}:${field}`);
        if (typed !== undefined)
            return typed;
        const value = model[field];
        return typeof value === 'number' ? formatCapacity(value) : '';
    };
    const settleCapacity = (index, field) => {
        const key = `${String(index)}:${field}`;
        const typed = editing.get(key);
        if (typed === undefined)
            return;
        // Unreadable text stays on screen: the save-time rejection names a row the
        // user can still see and correct.
        const parsed = parseCapacity(typed);
        if (parsed !== undefined && Number.isNaN(parsed))
            return;
        setEditing((current) => {
            const next = new Map(current);
            next.delete(key);
            return next;
        });
    };
    /** One capacity field of one row, rendered inside the row's disclosure. */
    const capacityField = (model, index, field, fallback) => (_jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens') }), _jsx("input", { className: styles['input'], type: "text", inputMode: "numeric", value: capacityText(model, index, field), placeholder: fallback === undefined
                    ? props.t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')
                    : formatCapacity(fallback), "aria-label": `${props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')} ${String(index + 1)}`, disabled: props.disabled, onChange: (event) => {
                    const text = event.target.value;
                    setEditing(current => new Map(current).set(`${String(index)}:${field}`, text));
                    update(index, field, parseCapacity(text));
                }, onBlur: () => { settleCapacity(index, field); } })] }));
    return (_jsxs("section", { className: styles['modelCatalog'], "aria-label": props.t('models'), children: [_jsxs("div", { className: styles['modelListHead'], children: [_jsxs("div", { className: styles['modelCatalogHeading'], children: [_jsx("span", { className: styles['modelCatalogTitle'], children: props.t('models') }), _jsx("span", { className: styles['modelCatalogMeta'], children: props.overridden ? props.t('modelsCustomized') : props.t('modelsInherited') })] }), props.overridden
                        ? (_jsx("button", { type: "button", className: styles['linkButton'], disabled: props.disabled, onClick: reset, children: props.t('resetModels') }))
                        : null] }), props.models.length === 0
                ? _jsx("p", { className: styles['modelEmpty'], children: props.t('modelsEmpty') })
                : (_jsx("div", { className: styles['modelList'], children: props.models.map((model, index) => (_jsxs("div", { className: styles['modelEntry'], children: [_jsxs("div", { className: styles['modelRow'], children: [_jsx("input", { className: styles['input'], type: "text", value: typeof model['id'] === 'string' ? model['id'] : '', placeholder: props.t('modelId'), "aria-label": `${props.t('modelId')} ${String(index + 1)}`, disabled: props.disabled, onChange: (event) => { update(index, 'id', event.target.value); }, onBlur: (event) => {
                                            // Settle a pasted id rather than trimming per keystroke,
                                            // which would stop the user typing an interior space.
                                            const trimmed = event.target.value.trim();
                                            if (trimmed !== event.target.value)
                                                update(index, 'id', trimmed);
                                        } }), _jsx("input", { className: styles['input'], type: "text", value: typeof model['name'] === 'string' ? model['name'] : '', placeholder: props.t('modelName'), "aria-label": `${props.t('modelName')} ${String(index + 1)}`, disabled: props.disabled, onChange: (event) => {
                                            update(index, 'name', event.target.value === '' ? undefined : event.target.value);
                                        } }), _jsx("button", { type: "button", className: styles['iconButton'], "aria-label": `${props.t('modelAdvanced')} ${String(index + 1)}`, "aria-expanded": expanded.has(index), title: props.t('modelAdvanced'), onClick: () => { toggle(index); }, children: expanded.has(index) ? _jsx(IconChevronDownOutline14, {}) : _jsx(IconChevronRightOutline14, {}) }), _jsx("button", { type: "button", className: `${styles['iconButton']} ${styles['iconButtonDanger']}`, "aria-label": `${props.t('removeModel')} ${String(index + 1)}`, title: props.t('removeModel'), disabled: props.disabled, onClick: () => { remove(index); }, children: _jsx(IconTrashOutline16, { size: 14 }) })] }), expanded.has(index)
                                ? (_jsxs("div", { className: styles['modelAdvanced'], children: [capacityField(model, index, 'contextWindow', props.defaultContextWindow), capacityField(model, index, 'maxTokens', props.defaultMaxTokens)] }))
                                : null] }, index))) })), _jsxs("button", { type: "button", className: styles['addModelButton'], disabled: props.disabled, onClick: () => { props.onChange([...props.models.map(model => ({ ...model })), { id: '' }]); }, children: [_jsx(IconPlusOutline16, { size: 14 }), props.t('addModel')] })] }));
}
//# sourceMappingURL=DeepSeekModelsEditor.js.map