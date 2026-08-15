import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector.js";
import { SlotOwnershipError, SlotOwnershipError as SlotOwnershipError$1, StaleAuthorizationError, StaleAuthorizationError as StaleAuthorizationError$1 } from "@deepseek-ai/dsh-client-ui-slots";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Component, createContext, useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
//#region lib/types/bind.js
/**
* uSES bridge: turns any bare observable snapshot source into a typed
* selector hook. Client-side-rendered only, so no server snapshot is wired.
* This is the ONE hook constructor in the client stack — engines and hosts
* traffic in bare sources; binding happens on the React side.
*/
/**
* Bind a bare observable source to a typed uSES selector hook.
* subscribe/getSnapshot are captured once per source into stable closures
* (also re-binds `this` for method-based sources), so components never
* resubscribe across renders. Equality defaults to Object.is.
* @param w - snapshot source (engine store, Session object, store instance).
* @returns the selector hook.
*/
function bindSnapshotSelector(w) {
	const subscribe = (fn) => w.subscribe(fn);
	const getSnapshot = () => w.getSnapshot();
	return function useSelector(sel, eq) {
		return useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, sel, eq);
	};
}
//#endregion
//#region lib/types/session-provider.js
/** Internal React bindings for the renderer host and active session provide bundle. */
/**
* A missing-provider assembly error: the shell wired the tree wrong. The slot
* error boundary rethrows this class so misassembly stays fail-loud while
* registrant errors (inject factories, entry components) are contained
* per entry.
*/
var SlotAssemblyError = class extends Error {};
/** In-package renderer host context. */
const HostContext = createContext(null);
/**
* Read the installed renderer host; throws outside the rendered root tree
* (framework components must not render detached from the renderer).
* @returns the host API.
*/
function useHost() {
	const host = useContext(HostContext);
	if (!host) throw new SlotAssemblyError("slot machinery rendered outside the installed renderer tree");
	return host;
}
const BindingContext = createContext(null);
/** Read the current-session-optional bundle supplied at the root. */
function useSessionMaybeProvideInfo() {
	const info = useContext(BindingContext);
	if (!info) throw new SlotAssemblyError("session-aware slot rendered outside the root binding provider");
	return info;
}
/**
* Identity-stable selector hook per host observable. uSES resubscribes when
* the subscribe reference changes, so the bound hook must be created once per
* source — cached here by source identity (sources are host-owned singletons).
* @param source - host-provided observable.
* @returns the cached selector hook.
*/
function observableHook(source) {
	let hook = hookCache.get(source);
	if (hook === void 0) {
		hook = bindSnapshotSelector(source);
		hookCache.set(source, hook);
	}
	return hook;
}
const hookCache = /* @__PURE__ */ new WeakMap();
const absentSource = {
	getSnapshot: () => void 0,
	subscribe: () => () => {}
};
/** Bind a source that disappears with the current session to an optional selector hook. */
function maybeObservableHook(source) {
	if (source !== void 0) return observableHook(source);
	return useAbsentSnapshot;
}
function useAbsentSnapshot(_selector, _equal) {
	observableHook(absentSource)(() => void 0);
}
/**
* The useProjection framework seat (docs/subsystems/session-projection.md), one bound
* function per provide bundle (cached by info identity — components may hold
* it across renders). Key-addressed: the key resolves a per-session value
* face off the projection store; the bound selector hook comes from the same
* per-source cache as every other kit hook, so exactly one uSES subscription
* runs per call and the subscribe reference stays stable per key. A key no
* baseline or frame has carried (or a no-session bundle) reads `undefined` —
* capability absence — keeping the hook order constant.
*/
function projectionHook(info) {
	let hook = projectionHookCache.get(info);
	if (hook === void 0) {
		hook = (key, selector, eq) => {
			return observableHook(info.projections?.faceOf(key) ?? absentSource)(selector ?? ((value) => value), eq);
		};
		projectionHookCache.set(info, hook);
	}
	return hook;
}
const projectionHookCache = /* @__PURE__ */ new WeakMap();
/**
* Root-level binding provider. It follows current selection without a key;
* per-entry identity is the outlet's adoption bookkeeping (SessionMaybeEntry):
* a blank-born incarnation adopts the first session without remounting, and
* every later transition (switch or loss) remounts like a strict entry.
*/
function SessionMaybeProvider({ children }) {
	const info = observableHook(useHost().sessions.provideInfo)((s) => s);
	return jsx(BindingContext.Provider, {
		value: info,
		children
	});
}
/**
* Framework-wired session area: subscribes to the host's current provide
* source and remounts the body under `key={sessionId}` so a session switch
* rebuilds the session subtree. This dependency-inverted layer uses plain
* string ids; `PropsRuntime` applies the branded type at the component
* boundary.
*/
function SessionProvider({ empty, children }) {
	const info = observableHook(useHost().sessions.provideInfo)((s) => s);
	const id = info.sessionId;
	if (id === void 0) return jsx(Fragment, { children: empty?.() ?? null });
	return jsx(BindingContext.Provider, {
		value: info,
		children: children(id)
	}, id);
}
//#endregion
//#region lib/types/scoped-slots.js
/**
* React renderer for declarative slots. Per-entry bindings enforce child
* authorization, and entry boundaries contain registrant failures.
*/
/**
* Per-entry renderSlot bindings. The binding is identity-stable per entry
* (memoized components must not resubscribe on unrelated re-renders) and dies
* with the entry: a retained closure calling after the entry's disposal hits
* the in-ledger check and throws.
*/
const renderSlotCache = /* @__PURE__ */ new WeakMap();
function boundRenderSlot(host, entry) {
	let binding = renderSlotCache.get(entry);
	if (!binding) {
		binding = (key, owner, opts) => {
			if (!host.isLive(entry)) throw new StaleAuthorizationError$1(`renderSlot('${key}') from a disposed registration`);
			const declared = entry.children?.[key];
			if (declared === void 0) throw new SlotOwnershipError$1(`slot '${key}' is not declared by this entry's children`);
			if (declared.kind === "chain") throw new SlotOwnershipError$1(`slot '${key}' is declared 'chain' — use renderSlotChain`);
			return jsx(SlotOutlet, {
				slotKey: key,
				ownerProps: owner,
				opts
			});
		};
		renderSlotCache.set(entry, binding);
	}
	return binding;
}
/**
* Per-entry renderSlotChain bindings: identity-stable per entry (same cache
* axis as renderSlot — a per-frame dispatch must not rebuild the binding) and
* dead with the entry. The chain-kind check is the plain-JS backstop twin of
* the declaration check; typed callers are narrowed to chain keys.
*/
const renderSlotChainCache = /* @__PURE__ */ new WeakMap();
function boundRenderSlotChain(host, entry) {
	let binding = renderSlotChainCache.get(entry);
	if (!binding) {
		binding = (key, owner, opts) => {
			if (!host.isLive(entry)) throw new StaleAuthorizationError$1(`renderSlotChain('${key}') from a disposed registration`);
			const declared = entry.children?.[key];
			if (declared === void 0) throw new SlotOwnershipError$1(`slot '${key}' is not declared by this entry's children`);
			if (declared.kind !== "chain") throw new SlotOwnershipError$1(`slot '${key}' is declared '${declared.kind}', not 'chain' — use renderSlot`);
			return jsx(SlotOutlet, {
				slotKey: key,
				ownerProps: owner,
				opts
			});
		};
		renderSlotChainCache.set(entry, binding);
	}
	return binding;
}
/**
* Inject results cache: root entries per entry, session entries per
* (entry x provide bundle). WeakMap keys are entry/info objects (both
* identity-stable per registration/session scope), so cache lifetime rides
* the same axes as the values it memoizes.
*/
const rootInjectCache = /* @__PURE__ */ new WeakMap();
const sessionInjectCache = /* @__PURE__ */ new WeakMap();
const sessionMaybeInjectCache = /* @__PURE__ */ new WeakMap();
const EMPTY_INJECTED_PROPS = {};
function runInject(entry, info, actions) {
	const inject = entry.inject;
	if (!inject) return EMPTY_INJECTED_PROPS;
	const args = [];
	if (info !== void 0) args.push(info.sessionId);
	if (actions !== void 0) args.push(actions);
	return bindInjectHooks(inject(...args));
}
/**
* Normalize one entry-owned inject face on its existing cache axis. Its hooks
* compartment remains the original Observable-only contract.
*/
function bindInjectHooks(face) {
	const sources = face["hooks"];
	if (sources === void 0) return face;
	const { hooks: _hooks, ...rest } = face;
	const bound = rest;
	for (const [name, source] of Object.entries(sources)) {
		const hookName = `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
		bound[hookName] = observableHook(source);
	}
	return bound;
}
const slotInjectCache = /* @__PURE__ */ new WeakMap();
const EMPTY_SLOT_INJECT = { props: EMPTY_INJECTED_PROPS };
/** Normalize one dispatcher-owned inject face by its stable object identity. */
function cachedSlotInject(face) {
	if (face === void 0) return EMPTY_SLOT_INJECT;
	let bound = slotInjectCache.get(face);
	if (bound !== void 0) return bound;
	const definitions = face["hooks"];
	if (definitions === void 0) {
		bound = { props: face };
		slotInjectCache.set(face, bound);
		return bound;
	}
	const { hooks: _hooks, ...rest } = face;
	const props = rest;
	let factories;
	for (const [name, definition] of Object.entries(definitions)) {
		const hookName = `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
		if (typeof definition === "function") {
			factories ??= {};
			factories[name] = definition;
		} else props[hookName] = observableHook(definition);
	}
	bound = factories === void 0 ? { props } : {
		props,
		slotHookFactories: factories
	};
	slotInjectCache.set(face, bound);
	return bound;
}
/** Bind deferred slot-level factories for one stable renderSlot occurrence. */
function bindSlotHookFactories(factories, standard, hookContext) {
	const hooks = {};
	for (const [name, factory] of Object.entries(factories)) {
		const hookName = `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
		hooks[hookName] = factory(standard, hookContext);
	}
	return hooks;
}
function cachedRootInject(entry, actions) {
	let props = rootInjectCache.get(entry);
	if (!props) {
		props = runInject(entry, void 0, actions);
		rootInjectCache.set(entry, props);
	}
	return props;
}
function cachedSessionInject(entry, info, actions) {
	let perInfo = sessionInjectCache.get(entry);
	if (!perInfo) {
		perInfo = /* @__PURE__ */ new WeakMap();
		sessionInjectCache.set(entry, perInfo);
	}
	let props = perInfo.get(info);
	if (!props) {
		props = runInject(entry, info, actions);
		perInfo.set(info, props);
	}
	return props;
}
function cachedSessionMaybeInject(entry, info, actions) {
	let perInfo = sessionMaybeInjectCache.get(entry);
	if (!perInfo) {
		perInfo = /* @__PURE__ */ new WeakMap();
		sessionMaybeInjectCache.set(entry, perInfo);
	}
	let props = perInfo.get(info);
	if (!props) {
		props = runInject(entry, info, actions);
		perInfo.set(info, props);
	}
	return props;
}
/**
* Locale `t` seat bindings, cached per (face, namespace, revision). The
* revision is part of the cache key ON PURPOSE: a locale switch mints a NEW
* function reference per namespace, so `React.memo` components taking `t`
* re-render through ordinary shallow comparison — freshness rides identity,
* no extra invalidation channel. Within one revision the reference is stable
* (memoized children do not churn on unrelated re-renders).
*/
const localeSeatCache = /* @__PURE__ */ new WeakMap();
function localeSeat(face, ns) {
	let perNs = localeSeatCache.get(face);
	if (!perNs) {
		perNs = /* @__PURE__ */ new Map();
		localeSeatCache.set(face, perNs);
	}
	const revision = face.getSnapshot().revision;
	const cached = perNs.get(ns);
	if (cached && cached.revision === revision) return cached.t;
	const bound = face.bind(ns);
	const t = (key, params) => bound(key, params);
	perNs.set(ns, {
		revision,
		t
	});
	return t;
}
const noopSubscribe = () => () => {};
const zeroRevision = () => 0;
/**
* Per-face subscribe/getSnapshot closure pair. Cached by face identity: the
* face is one global source shared by every outlet, and uSES resubscribes
* whenever the subscribe reference changes — fresh closures per render would
* churn one unsubscribe/resubscribe pair per outlet per render.
*/
const localeSubscriptionCache = /* @__PURE__ */ new WeakMap();
function localeSubscription(face) {
	let cached = localeSubscriptionCache.get(face);
	if (!cached) {
		cached = {
			subscribe: (fn) => face.subscribe(fn),
			getRevision: () => face.getSnapshot().revision
		};
		localeSubscriptionCache.set(face, cached);
	}
	return cached;
}
/**
* Subscribe an outlet to the installed locale face's revision (0 while none
* is installed — exactly one uSES call either way, keeping hook order
* stable). Every outlet re-renders on a locale switch; entry bodies then
* re-derive their `t` seat at the new revision. The face must be installed
* before the first render that needs it — a face appearing later has no
* notification channel to already-mounted outlets.
*/
function useLocaleRevision(face) {
	const subscription = face !== void 0 ? localeSubscription(face) : void 0;
	return useSyncExternalStore(subscription?.subscribe ?? noopSubscribe, subscription?.getRevision ?? zeroRevision);
}
/**
* Entry-identity React keys for entry boundaries. An outlet renders one
* winner per position (single/keyed/list cell head, chain election) through
* an error boundary; without a key, a boundary that failed on entry A would
* survive a winner change (re-election, shadowing fallback after an
* abdication, HMR re-registration) and keep a healthy entry B blacked out.
* Keying by entry identity remounts the boundary fresh whenever the winner
* changes (entries are identity-stable per registration, so the key is
* stable while the same entry stays the winner).
*/
let nextEntryKey = 0;
const entryKeys = /* @__PURE__ */ new WeakMap();
function entryKeyOf(entry) {
	let key = entryKeys.get(entry);
	if (key === void 0) {
		key = nextEntryKey++;
		entryKeys.set(entry, key);
	}
	return key;
}
/**
* Per-entry isolation: one registrant crashing (component render or inject
* factory) must not take down siblings. Assembly errors (missing providers)
* rethrow — a miswired shell must fail loud, not degrade into fallbacks.
* Every catch reports through `onEntryError` (the ledger's supervision
* seam); for shadowing kinds the report abdicates the entry, the outlet
* re-renders onto the cell's next survivor, and this boundary's crash face
* only shows until that re-render lands (permanently once the cell is dry —
* the outlet then owns the crash face).
*/
var SlotErrorBoundary = class extends Component {
	state = { failed: false };
	static getDerivedStateFromError(error) {
		if (error instanceof SlotAssemblyError) throw error;
		return { failed: true };
	}
	componentDidCatch(error) {
		console.error(`slot entry crashed in '${this.props.slotKey}':`, error);
		this.props.onEntryError(error);
	}
	render() {
		if (this.state.failed) return jsx("div", { "data-slot-error": this.props.slotKey });
		return this.props.children;
	}
};
const standardPropsCache = /* @__PURE__ */ new WeakMap();
/** Stable official-props object used by contextual Hook factories. */
function standardProps(host, scope, info) {
	let cache = standardPropsCache.get(host);
	if (cache === void 0) {
		cache = {
			root: {
				useSessions: observableHook(host.sessions.list),
				useWorkspaces: observableHook(host.workspaces.list)
			},
			session: /* @__PURE__ */ new WeakMap(),
			sessionMaybe: /* @__PURE__ */ new WeakMap()
		};
		standardPropsCache.set(host, cache);
	}
	if (scope === "root") return cache.root;
	if (info === void 0) throw new SlotAssemblyError(`scope '${scope}' rendered without session provide info`);
	const byInfo = scope === "session" ? cache.session : cache.sessionMaybe;
	let standard = byInfo.get(info);
	if (standard !== void 0) return standard;
	standard = { ...cache.root };
	for (const [name, source] of Object.entries(info.hooks)) {
		const hookName = `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
		if (scope === "session-maybe") standard[hookName] = maybeObservableHook(source);
		else {
			if (source === void 0) throw new SlotAssemblyError(`strict session hook '${name}' has no source`);
			standard[hookName] = observableHook(source);
		}
	}
	Object.assign(standard, info.props);
	standard["sessionId"] = info.sessionId;
	standard["useProjection"] = projectionHook(info);
	byInfo.set(info, standard);
	return standard;
}
/**
* Standard-kit synthesis shared by both scope branches: the global
* useSessions/useWorkspaces hooks, the per-session provide bundle (every
* `hooks` source becomes a `use<Name>` selector hook — useSession is the
* runtime's own 'session' contribution, no special case — and `props` spread
* verbatim), the store pair when declared, the renderSlot binding when
* children are declared, and the SessionProvider seat when the children
* declare a session-scope slot. Hosts hand out BARE observable sources
* (hooks never cross the host contract); every hook is bound HERE, cached
* per source (observableHook), so spreading a fresh kit object per render
* never churns child subscriptions.
*/
function standardKit(host, entry, scope, info) {
	const standard = standardProps(host, scope, info);
	const kit = { ...standard };
	if (entry.locale !== void 0) {
		const face = host.locale;
		if (face === void 0) throw new SlotAssemblyError(`entry declares locale namespace '${entry.locale}' but no locale face is installed (locale plugin missing from the composition?)`);
		kit["t"] = localeSeat(face, entry.locale);
	}
	const store = scope === "session-maybe" && info?.sessionId === void 0 ? void 0 : host.storeOf(entry, info?.sessionId);
	if (store !== void 0) {
		kit["useStore"] = observableHook(store);
		kit["actions"] = store.actions;
	}
	if (entry.children !== void 0) {
		kit["renderSlot"] = boundRenderSlot(host, entry);
		if (Object.values(entry.children).some((spec) => spec.kind === "chain")) kit["renderSlotChain"] = boundRenderSlotChain(host, entry);
		if (Object.values(entry.children).some((spec) => spec.scope === "session")) kit["SessionProvider"] = SessionProvider;
	}
	return {
		kit,
		standard,
		actions: store?.actions
	};
}
/**
* One rendered entry: standard kit + cached entry inject + common slot inject
* + owner props (owner wins). The shares are erased at this render boundary;
* the registration and renderSlot seams already proved their contracts.
*/
function ContextualEntry({ slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext }) {
	const contextual = useMemo(() => {
		if (!hasHookContext) throw new SlotAssemblyError(`slot '${slotKey}' has contextual injected Hooks but no hookContext`);
		return bindSlotHookFactories(slotInjected.slotHookFactories, standard, hookContext);
	}, [
		hasHookContext,
		hookContext,
		slotInjected.slotHookFactories,
		slotKey,
		standard
	]);
	return jsx(Comp, {
		...kit,
		...injected,
		...slotInjected.props,
		...contextual,
		...ownerProps
	});
}
function renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext) {
	if (slotInjected.slotHookFactories === void 0) return jsx(Comp, {
		...kit,
		...injected,
		...slotInjected.props,
		...ownerProps
	});
	return jsx(ContextualEntry, {
		slotKey,
		Comp,
		kit,
		standard,
		injected,
		slotInjected,
		ownerProps,
		hookContext,
		hasHookContext
	});
}
function SessionEntry({ entry, ownerProps, info, slotKey, slotInjected, hookContext, hasHookContext }) {
	const host = useHost();
	const Comp = entry.component;
	const { kit, standard, actions } = standardKit(host, entry, "session", info);
	return renderEntry(slotKey, Comp, kit, standard, cachedSessionInject(entry, info, actions), slotInjected, ownerProps, hookContext, hasHookContext);
}
function SessionMaybeEntryBody({ entry, ownerProps, info, slotKey, slotInjected, hookContext, hasHookContext }) {
	const host = useHost();
	const Comp = entry.component;
	const { kit, standard, actions } = standardKit(host, entry, "session-maybe", info);
	return renderEntry(slotKey, Comp, kit, standard, cachedSessionMaybeInject(entry, info, actions), slotInjected, ownerProps, hookContext, hasHookContext);
}
/**
* Session-maybe identity: adoption — the ONLY behavior (there is no
* hold-identity-forever mode). An incarnation born session-less ADOPTS the
* first session that arrives: identity holds across that one transition
* (undefined → first id), so a blank shell's DOM survives the moment a
* session appears. From then on the entry behaves exactly like a strict
* session entry: switching to a DIFFERENT session remounts (component-local
* state must not leak between sessions), and dropping back to no-session
* remounts into a fresh blank incarnation, which will adopt again.
* Component-local per-session state therefore clears by construction; state
* that must SURVIVE a switch belongs in session-bound sources (machine,
* store, hooks) — the existing layering rule, now load-bearing.
*/
function SessionMaybeEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }) {
	const info = useSessionMaybeProvideInfo();
	const [state, setState] = useState(FIRST_INCARNATION);
	let { adopted, epoch } = state;
	if (info.sessionId !== void 0 && adopted === void 0) {
		adopted = info.sessionId;
		setState({
			adopted,
			epoch
		});
	} else if (adopted !== void 0 && info.sessionId !== void 0 && info.sessionId !== adopted) {
		adopted = info.sessionId;
		epoch += 1;
		setState({
			adopted,
			epoch
		});
	} else if (adopted !== void 0 && info.sessionId === void 0) {
		adopted = void 0;
		epoch += 1;
		setState({
			adopted,
			epoch
		});
	}
	return jsx(SessionMaybeEntryBody, {
		entry,
		ownerProps,
		info,
		slotKey,
		slotInjected,
		hookContext,
		hasHookContext
	}, epoch);
}
const FIRST_INCARNATION = {
	adopted: void 0,
	epoch: 0
};
function RootEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }) {
	const host = useHost();
	const Comp = entry.component;
	const { kit, standard, actions } = standardKit(host, entry, "root", void 0);
	return renderEntry(slotKey, Comp, kit, standard, cachedRootInject(entry, actions), slotInjected, ownerProps, hookContext, hasHookContext);
}
function StrictSessionEntry({ slotKey, entry, ownerProps, slotInjected, hookContext, hasHookContext, onEntryError }) {
	const info = useSessionMaybeProvideInfo();
	if (info.sessionId === void 0) return null;
	return jsx(SlotErrorBoundary, {
		slotKey,
		onEntryError,
		children: jsx(SessionEntry, {
			entry,
			ownerProps,
			info,
			slotKey,
			slotInjected,
			hookContext,
			hasHookContext
		})
	}, info.sessionId);
}
/**
* Anchor style shared by every outlet wrapper: `display:contents` keeps the
* wrapper out of layout (grid/flex parents see the slot's own children), so
* the anchor is purely addressable surface. Module-level constant — a stable
* reference so the wrapper never diffs its style prop.
*/
const ANCHOR_STYLE = { display: "contents" };
function SlotOutlet({ slotKey, ownerProps, opts }) {
	const host = useHost();
	useSyncExternalStore((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey));
	useLocaleRevision(host.locale);
	return jsx("div", {
		"data-slot": slotKey,
		style: ANCHOR_STYLE,
		children: renderOutletContent(host, slotKey, ownerProps, opts, useSessionMaybeProvideInfo())
	});
}
/** Kind dispatch behind the outlet anchor (single/keyed/list/chain, fallbacks, crash faces). */
function renderOutletContent(host, slotKey, ownerProps, opts, sessionInfo) {
	const spec = host.specOf(slotKey);
	if (!spec) return null;
	const strictSessionAbsent = spec.scope === "session" && sessionInfo.sessionId === void 0;
	if (strictSessionAbsent && (spec.kind !== "chain" || !opts?.overlay)) return jsx(Fragment, { children: opts?.fallback ?? null });
	const entries = strictSessionAbsent ? [] : host.entriesOf(slotKey);
	const slotInjected = cachedSlotInject(spec.inject);
	const guarded = (entry, key, owner = ownerProps) => {
		const hasHookContext = opts !== void 0 && Object.hasOwn(opts, "hookContext");
		const hookContext = opts?.hookContext;
		const onEntryError = (error) => {
			host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== "chain" });
		};
		return spec.scope === "session" ? jsx(StrictSessionEntry, {
			slotKey,
			entry,
			ownerProps: owner,
			slotInjected,
			hookContext,
			hasHookContext,
			onEntryError
		}, key) : jsx(SlotErrorBoundary, {
			slotKey,
			onEntryError,
			children: spec.scope === "session-maybe" ? jsx(SessionMaybeEntry, {
				entry,
				ownerProps: owner,
				slotKey,
				slotInjected,
				hookContext,
				hasHookContext
			}) : jsx(RootEntry, {
				entry,
				ownerProps: owner,
				slotKey,
				slotInjected,
				hookContext,
				hasHookContext
			})
		}, key);
	};
	const deadCell = () => jsx("div", { "data-slot-error": slotKey });
	if (spec.kind === "single") {
		const entry = host.entriesOfSlot(slotKey)[0];
		if (!entry) return entries.length > 0 ? deadCell() : jsx(Fragment, { children: opts?.fallback ?? null });
		return guarded(entry, entryKeyOf(entry));
	}
	if (spec.kind === "keyed") {
		const entry = host.entriesOfSlot(slotKey).find((e) => e.options.key === opts?.entryKey);
		if (!entry) return entries.some((e) => e.options.key === opts?.entryKey) ? deadCell() : jsx(Fragment, { children: opts?.fallback ?? null });
		return guarded(entry, entryKeyOf(entry));
	}
	if (spec.kind === "chain") {
		let elected = null;
		for (const entry of entries) {
			let matched;
			try {
				matched = entry.select(ownerProps);
			} catch (error) {
				console.error(`chain selector crashed in '${slotKey}' (${entry.registrant ?? "unknown registrant"}), treating as declined:`, error);
				continue;
			}
			if (matched !== null) {
				elected = guarded(entry, entryKeyOf(entry), {
					...ownerProps,
					matched
				});
				break;
			}
		}
		if (opts?.overlay) return jsxs(Fragment, { children: [jsx("div", {
			"data-chain-overlay-fallback": slotKey,
			style: { display: elected === null ? "contents" : "none" },
			children: opts.fallback ?? null
		}), elected] });
		return elected ?? jsx(Fragment, { children: opts?.fallback ?? null });
	}
	const rows = host.entriesOfSlot(slotKey).map((entry) => ({
		entry,
		id: entry.options.id,
		order: entry.options.order ?? 0
	}));
	const rowIds = new Set(rows.map((row) => row.id));
	for (const entry of entries) {
		if (rowIds.has(entry.options.id)) continue;
		rowIds.add(entry.options.id);
		rows.push({
			entry: void 0,
			id: entry.options.id,
			order: entry.options.order ?? 0
		});
	}
	let list = [...rows].sort((a, b) => a.order - b.order);
	if (opts?.only !== void 0) list = list.filter((item) => item.id === opts.only);
	if (list.length === 0) return jsx(Fragment, { children: opts?.fallback ?? null });
	return jsx(Fragment, { children: list.map((item, i) => item.entry !== void 0 ? guarded(item.entry, `e${entryKeyOf(item.entry)}`) : jsx("div", { "data-slot-error": slotKey }, `x${item.id ?? i}`)) });
}
/** Root outlet: the shell's single ctx-level render entry — an unregistered 'root' is a boot-order failure, never a silent blank. */
function RootOutlet({ ownerProps }) {
	const host = useHost();
	useSyncExternalStore((fn) => host.subscribe("root", fn), () => host.getVersion("root"));
	useLocaleRevision(host.locale);
	const entry = host.entriesOfSlot("root")[0];
	if (!entry) {
		if (host.entriesOf("root").length > 0) return jsx("div", { "data-slot-error": "root" });
		throw new SlotAssemblyError("renderSlot('root') before any 'root' registration (boot order)");
	}
	return jsx("div", {
		"data-slot": "root",
		style: ANCHOR_STYLE,
		children: jsx(SlotErrorBoundary, {
			slotKey: "root",
			onEntryError: (error) => {
				host.reportEntryError("root", entry, error, { abdicate: true });
			},
			children: jsx(RootEntry, {
				entry,
				ownerProps,
				slotKey: "root",
				slotInjected: EMPTY_SLOT_INJECT,
				hookContext: void 0,
				hasHookContext: false
			})
		}, entryKeyOf(entry))
	});
}
/**
* Build the renderer the shell installs into the runtime SlotRegistry
* (ctx.slots.install(createSlotRenderer()) at boot; the service owns the
* install/renderSlot contract and the double-install/not-installed throws).
* @returns the renderer.
*/
function createSlotRenderer() {
	return { renderRoot(host, ownerProps) {
		return jsx(HostContext.Provider, {
			value: host,
			children: jsx(SessionMaybeProvider, { children: jsx(RootOutlet, { ownerProps }) })
		});
	} };
}
//#endregion
//#region lib/types/use-invoke.js
/**
* useInvoke: wrap an async action into a stable trigger plus pending flag.
* Pending is tracked in a per-hook external store read through uSES instead
* of setState, keeping the render body side-effect free and the invoke
* reference stable across renders (idempotent-hook rules).
*/
function createCell(fn) {
	const cell = {
		inflight: 0,
		listeners: /* @__PURE__ */ new Set(),
		fn,
		invoke: () => {
			bump(cell, 1);
			cell.fn().catch((error) => {
				console.error("useInvoke action failed:", error);
			}).finally(() => {
				bump(cell, -1);
			});
		},
		subscribe: (listener) => {
			cell.listeners.add(listener);
			return () => {
				cell.listeners.delete(listener);
			};
		},
		getPending: () => cell.inflight > 0
	};
	return cell;
}
function bump(cell, delta) {
	const wasPending = cell.inflight > 0;
	cell.inflight += delta;
	if (wasPending !== cell.inflight > 0) for (const listener of [...cell.listeners]) listener();
}
/**
* Wrap an async action into a stable invoke callback plus pending flag.
* Concurrent invocations are counted: pending stays true until the last
* in-flight call settles. The latest `fn` is always the one invoked.
* @param fn - async action.
* @returns invoke trigger and pending state.
*/
function useInvoke(fn) {
	const ref = useRef(null);
	ref.current ??= createCell(fn);
	const cell = ref.current;
	cell.fn = fn;
	const pending = useSyncExternalStore(cell.subscribe, cell.getPending);
	return [cell.invoke, pending];
}
//#endregion
export { SessionProvider, SlotAssemblyError, SlotOwnershipError, StaleAuthorizationError, bindSnapshotSelector, createSlotRenderer, useInvoke };
