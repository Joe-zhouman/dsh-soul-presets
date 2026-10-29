window.__ModuleLoader__.load({
	id: "dsh-soul-presets",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client-state.mjs
		/**
		* Everything the browser half can decide without a renderer: decoding the
		* roster the Host serves, mapping one row to the three labels the UI shows, and
		* deciding whether the stored selection still points at a usable preset.
		*
		* Kept free of React so the name/description/hint mapping is mechanically
		* assertable — the visibility of those three strings is the feature's stated
		* pain, and it should not depend on a browser to verify.
		* @module dsh-soul-presets/src/client-state
		*/
		/** The route the Host serves the roster on. */
		const ROSTER_ROUTE = "/plugins/soul-preset/roster";
		/** The route that creates and deletes presets, and the one that reveals the directory. */
		const PRESETS_ROUTE = "/plugins/soul-preset/presets";
		const REVEAL_ROUTE = "/plugins/soul-preset/reveal";
		/** The route that sets or clears one session's own preset selection. */
		const SELECT_ROUTE = "/plugins/soul-preset/select";
		/**
		* The menu row id that means "stop overriding; follow the default again". Not a
		* preset id shape on purpose, so it can never collide with a roster row.
		*/
		const FOLLOW_DEFAULT = "__follow_default__";
		/**
		* Decode one roster response.
		* @param payload - the parsed JSON, of unknown shape.
		* @returns the rows, the active id, the override flag, and the directory path;
		* empty when malformed.
		*/
		function decodeRoster(payload) {
			const source = payload !== null && typeof payload === "object" ? payload : {};
			return {
				presets: (Array.isArray(source.presets) ? source.presets : []).flatMap((row) => {
					if (row === null || typeof row !== "object" || typeof row.id !== "string") return [];
					const model = row.model !== null && typeof row.model === "object" && typeof row.model.provider === "string" && typeof row.model.model === "string" ? {
						provider: row.model.provider,
						model: row.model.model,
						...typeof row.model.reasoningEffort === "string" ? { reasoningEffort: row.model.reasoningEffort } : {}
					} : void 0;
					return [{
						id: row.id,
						...typeof row.name === "string" ? { name: row.name } : {},
						...typeof row.description === "string" ? { description: row.description } : {},
						...typeof row.hint === "string" ? { hint: row.hint } : {},
						...model === void 0 ? {} : { model },
						...typeof row.broken === "string" ? { broken: row.broken } : {}
					}];
				}),
				active: typeof source.active === "string" && source.active !== "" ? source.active : null,
				overridden: source.overridden === true,
				root: typeof source.root === "string" ? source.root : ""
			};
		}
		/**
		* The four strings one row contributes to the UI.
		* @param row - one roster row.
		* @returns the display name (falling back to the id), description, hint, and
		* the `provider/model[ (effort)]` label of the row's default model (empty when
		* it names none).
		*/
		function presetLabels(row) {
			const spec = row.model;
			return {
				name: typeof row.name === "string" && row.name !== "" ? row.name : row.id,
				description: typeof row.description === "string" ? row.description : "",
				hint: typeof row.hint === "string" ? row.hint : "",
				model: spec === void 0 ? "" : `${spec.provider}/${spec.model}${spec.reasoningEffort === void 0 ? "" : ` (${spec.reasoningEffort})`}`
			};
		}
		/**
		* The usable row the stored selection points at.
		* @param roster - a decoded roster.
		* @returns the row, or null when nothing is selected or the selection is stale
		* or broken — the UI shows "已失效" for that case.
		*/
		function activeRow(roster) {
			if (roster.active === null) return null;
			const row = roster.presets.find((candidate) => candidate.id === roster.active);
			return row === void 0 || row.broken !== void 0 ? null : row;
		}
		//#endregion
		//#region src/client-seats.mjs
		/**
		* The React-free half of the browser bundle: the roster store, the seat object
		* the three surfaces read, the dictionary, and the slot registrations.
		*
		* Components arrive as arguments so this module is exercisable by `node --test`
		* without React resolvable — the package has no react dependency, while the
		* browser gets React from the loader's module table. Two registration contracts
		* matter here: `inject` must return a plain props object (returning a function
		* hands the component a function as its props), and `t` comes from the
		* registration's own `locale:` — putting a `t` in the seat would override the
		* synthesized one with undefined.
		* @module dsh-soul-presets/src/client-seats
		*/
		/** Bundle id, as the profile's cordis patch row names it. */
		const ID = "dsh-soul-presets";
		/** The profile entry whose `active` field holds the selection; see the Host `Config`. */
		const SOUL_PRESET_ENTRY = "local-soul-presets";
		/** Locale namespace owned by this bundle's dictionary. */
		const NS = "localSoulPreset";
		/** Chinese copy. This is a single-user local deployment; see the spec. */
		const ZH = {
			nav: "预设提示词",
			chipEmpty: "选预设",
			chipStale: "预设已失效",
			switchTitle: "切换预设",
			currentLabel: "预设",
			defaultMark: "默认",
			followDefault: "跟随默认",
			stale: "当前选择指向的预设已不存在或已损坏，请重新选择。",
			brokenPrefix: "不可用",
			modelPrefix: "模型",
			modelFailed: "预设已切换，但模型没有切换",
			newPreset: "新建",
			newPrompt: "新预设的 id（小写字母、数字、连字符）",
			remove: "删除",
			confirmRemove: "确认删除",
			cancel: "取消",
			openFolder: "打开预设目录",
			rootLabel: "预设目录",
			reload: "重新载入",
			empty: "这个目录里还没有预设。新建一个，或手动放入 .toml 文件。"
		};
		/**
		* Services this browser half needs before it applies.
		*
		* `remote` is required even though the subscription below reads it with optional
		* chaining: cordis's service accessor THROWS on an undeclared service, so
		* `ctx.remote?.$on?.(...)` cannot protect against a missing declaration — it
		* only protects against a missing method.
		*/
		const inject = [
			"slots",
			"configForms",
			"locale",
			"remote"
		];
		/**
		* Read the roster from the Host, resolved for one session when asked.
		* @param sessionId - the session whose effective selection to read, or none for
		* the deployment's default view.
		* @returns the decoded roster.
		*/
		async function loadRoster(sessionId) {
			const query = sessionId === void 0 ? "" : `?session=${encodeURIComponent(sessionId)}`;
			const response = await fetch(`${ROSTER_ROUTE}${query}`, { headers: { accept: "application/json" } });
			if (!response.ok) throw new Error(`roster request failed with ${String(response.status)}`);
			return decodeRoster(await response.json());
		}
		/**
		* One error's message.
		* @param error - the thrown value.
		* @returns the message text.
		*/
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* The shared roster snapshot store both surfaces read.
		*
		* Two failure kinds are kept apart because they mean different things: `error` is
		* a failed roster read (the list on screen may be stale), `actionError` is a
		* failed user action (create, delete, reveal, switch). Keeping them separate is
		* what stops a successful mutation followed by a failed read from clearing the
		* read's message and presenting stale rows as success.
		*
		* Concurrent callers share one request — all three surfaces refresh on mount —
		* but a read that began before a mutation cannot answer for it, so a mutation
		* marks the running read stale and the loop repeats exactly once.
		* @param load - the fetcher, receiving whatever `refresh` was last given.
		* @returns a snapshot store over the roster, with an action-failure seat.
		*/
		function createRosterReader(load = loadRoster) {
			let state = {
				status: "loading",
				roster: {
					presets: [],
					active: null,
					overridden: false,
					root: ""
				},
				error: null,
				actionError: null
			};
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of [...listeners]) try {
					listener();
				} catch {}
			};
			let inFlight = null;
			let repeat = false;
			const set = (next) => {
				state = {
					...state,
					...next
				};
				emit();
			};
			async function read(arg) {
				try {
					set({
						status: "ready",
						roster: await load(arg),
						error: null
					});
				} catch (error) {
					set({
						status: "error",
						error: messageOf(error)
					});
				}
			}
			return {
				getSnapshot: () => state,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				/**
				* Read the roster, sharing the request with any concurrent caller.
				* @param arg - forwarded to the fetcher (the session to resolve for).
				* @returns the settled request.
				*/
				refresh(arg) {
					if (inFlight === null) inFlight = (async () => {
						try {
							do {
								repeat = false;
								await read(arg);
							} while (repeat);
						} finally {
							inFlight = null;
						}
					})();
					return inFlight;
				},
				/**
				* Announce that the roster changed. A read already in flight predates the
				* change, so the running loop performs one more read; a caller arriving with
				* no read in flight simply starts a fresh one.
				*/
				invalidate() {
					if (inFlight !== null) repeat = true;
				},
				/** The user started an action; the previous action's message no longer applies. */
				beginAction() {
					if (state.actionError !== null) set({ actionError: null });
				},
				/**
				* Record a failed user action (create, delete, reveal, switch) so the UI can
				* show it. Actions never reject; they report here instead.
				* @param message - what went wrong.
				*/
				reportFailure(message) {
					set({ actionError: message });
				}
			};
		}
		/**
		* Register the dictionary, resolve the entry's config form, build the shared
		* seat, and expose the surface registration the React half calls.
		* @param ctx - client root context, with `slots`, `configForms` and `locale` live.
		* @returns the seat and the registrar that pairs surfaces with components.
		*/
		function createSeats(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: ZH }), `${ID}: dictionaries`);
			const selection = ctx.configForms.get(SOUL_PRESET_ENTRY);
			const roster = createRosterReader((() => {
				let last;
				return (sessionId) => {
					if (sessionId !== void 0) last = sessionId;
					return loadRoster(last);
				};
			})());
			const defaults = createRosterReader(loadRoster);
			/**
			* Send one same-origin request, refusing to treat a failed status as success.
			* @param method - the HTTP method.
			* @param path - the route path.
			* @param body - the JSON body, when the method carries one.
			* @returns the accepted response's parsed JSON, or null when it carried none.
			*/
			const request = async (method, path, body) => {
				const response = await fetch(path, {
					method,
					...body === void 0 ? {} : {
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					}
				});
				if (!response.ok) {
					const detail = await response.json().catch(() => null);
					throw new Error(detail?.error ?? `request failed with ${String(response.status)}`);
				}
				return response.json().catch(() => null);
			};
			/**
			* Surface a switch whose model half failed. The preset itself is already in
			* force, so this is a warning about the route rather than a failed action.
			* @param payload - the select route's parsed response.
			*/
			const reportModelFailure = (payload) => {
				if (payload === null || typeof payload !== "object" || typeof payload.modelError !== "string") return;
				roster.reportFailure(`${ZH.modelFailed}：${payload.modelError}`);
			};
			const runAction = async (action) => {
				roster.beginAction();
				defaults.beginAction();
				try {
					await action();
				} catch (error) {
					const message = messageOf(error);
					roster.reportFailure(message);
					defaults.reportFailure(message);
				}
			};
			const runMutation = (action, readers = [roster, defaults]) => runAction(async () => {
				await action();
				for (const reader of readers) reader.invalidate();
				await Promise.all(readers.map((reader) => reader.refresh()));
			});
			const select = (id) => runMutation(() => selection.set("active", id));
			const selectSession = (sessionId, id) => runMutation(async () => {
				reportModelFailure(await request("POST", SELECT_ROUTE, {
					session: sessionId,
					id
				}));
			}, [roster]);
			const resetSession = (sessionId) => runMutation(async () => {
				reportModelFailure(await request("POST", SELECT_ROUTE, { session: sessionId }));
			}, [roster]);
			const create = (id) => runMutation(() => request("POST", PRESETS_ROUTE, { id }));
			const remove = (id) => runMutation(() => request("DELETE", PRESETS_ROUTE, { id }));
			const reveal = () => runAction(() => request("POST", REVEAL_ROUTE));
			const seat = {
				roster,
				defaults,
				selection,
				select,
				selectSession,
				resetSession,
				create,
				remove,
				reveal,
				refresh: (sessionId) => roster.refresh(sessionId)
			};
			ctx.effect(() => {
				const disposers = [ctx.remote?.$on?.("settings/document-updated", (ns) => {
					if (ns === "local-soul-presets") {
						roster.refresh();
						defaults.refresh();
					}
				}), ctx.on("connection/reset", () => {
					roster.refresh();
					defaults.refresh();
				})].filter(Boolean);
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, `${ID}: roster invalidations`);
			return {
				seat,
				/**
				* Register the three surfaces with their React faces.
				* @param components - one component per surface.
				*/
				registerSurfaces(components) {
					ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
						name: "conversation.input.left",
						id: "soul-preset-chip",
						order: 20,
						locale: NS,
						inject: () => seat
					}, components.chip));
					ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
						name: "conversation.input.dock",
						id: "soul-preset-dock",
						order: 20,
						locale: NS,
						inject: () => seat
					}, components.dock));
					ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: "soul-presets",
						order: 25,
						label: () => ctx.locale.bind(NS)("nav"),
						locale: NS,
						inject: () => seat
					}, components.settings));
				}
			};
		}
		//#endregion
		//#region src/client-styles.mjs
		/**
		* The browser half's stylesheet.
		*
		* It is one `<style>` tag injected at apply time rather than a CSS module
		* import: this package builds with its own tsdown config, which has no
		* stylesheet pipeline, while the module system already owns injected tags —
		* `data-plugin` is the disposal key (`removeOwnedStyles`) and `data-plugin-css`
		* names the sheet, the same convention the shell's own client bundles use.
		*
		* Class names carry a `dsh-sp-` prefix because they live in the page's global
		* stylesheet, unlike the hashed classes of a bundled module. The chip's
		* geometry copies the mode selector's trigger (`PermissionSelect.module.css`
		* `.trigger`) rather than approximating it, since the two sit in one composer
		* row; every other value is a `--dsw-*` token so both themes are covered.
		* @module dsh-soul-presets/src/client-styles
		*/
		/** Bundle id; also the `data-plugin` value disposal removes tags by. */
		const STYLE_PLUGIN_ID = "dsh-soul-presets";
		/** Names this sheet inside the page, for the duplicate guard and HMR bookkeeping. */
		const STYLE_TAG_ID = `${STYLE_PLUGIN_ID}/client-styles.css`;
		const CSS_TEXT = `
/* Composer chip. font-family is deliberately unset: the sibling mode trigger
   does not set it either, so both keep whatever the shell gives a button. */
.dsh-sp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: 24px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.dsh-sp-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-sp-chip:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.dsh-sp-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* inline-flex, not inline: an inline glyph reserves baseline descent under the
   svg and floats off-center in the 28px trigger. */
.dsh-sp-chevron {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}

.dsh-sp-chevron-open {
  transform: rotate(180deg);
}

/* Switch-list row body, rendered inside the shared menu card: the name on the
   first line, then the description and hint (or the reason it is unusable).
   The card, row fill, selected check, and the capped scrolling body all come
   from the primitive, which is the same menu the mode selector opens. */
.dsh-sp-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dsh-sp-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-sp-row-note {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-sp-row-part {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-sp-row-broken {
  color: var(--dsw-alias-state-error-primary);
}

/* The 「跟随默认」 row sits above the roster once a session carries its own
   override. Muted like a caption: it is an action, not a preset to pick. */
.dsh-sp-row-follow .dsh-sp-row-name {
  color: var(--dsw-alias-label-tertiary);
}

/* The switch list scrolls well before the shared card's viewport-fit cap. That
   native limit is near the full screen, so a long roster stands fully open and
   covers the page; this class narrows the card and the primitive's .viewport
   keeps scrolling it (its overflow rule keys off the card, not the class).
   min() keeps the viewport-fit expression as the lower bound, so a window
   shorter than the cap still fits the card. Appended after the shell's own
   sheet, so the tie on class specificity with .scrollable goes to this rule. */
.dsh-sp-menu-cap {
  max-height: min(320px, calc(100vh - 12px - max(12px, var(--dsh-frame-top-clearance, 12px))));
}

/* The line above the composer card: the current preset's name and hint, or the
   notice that the selection no longer resolves. */
[data-dsh-soul-preset-dock] {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0 16px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-soul-preset-line] {
  display: flex;
  align-items: baseline;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
}

[data-dsh-soul-preset-line] > span,
[data-dsh-soul-preset-stale] {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A failed action or a failed roster read, in either the dock or the page. */
[data-dsh-soul-preset-dock] [data-dsh-soul-preset-error],
[data-dsh-soul-preset-settings] [data-dsh-soul-preset-error] {
  max-width: 100%;
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}

/* Management page body. It carries no heading of its own: the Settings shell
   renders the registration's label, as it does for every other section. */
[data-dsh-soul-preset-settings] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}

[data-dsh-soul-preset-settings] p {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-soul-preset-root] {
  overflow-wrap: anywhere;
}

[data-dsh-soul-preset-settings] ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

[data-dsh-soul-preset-row] {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
}

[data-dsh-soul-preset-row]:hover {
  background: var(--dsw-alias-bg-layer-1);
}

[data-dsh-soul-preset-row-text] {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* The name is the row's switch action, so it reads as the row title rather than
   as a second capsule beside the row's buttons. */
[data-dsh-soul-preset-select] {
  align-self: flex-start;
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

[data-dsh-soul-preset-select]:hover:not(:disabled) {
  text-decoration: underline;
}

[data-dsh-soul-preset-select]:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

[data-dsh-soul-preset-row-desc],
[data-dsh-soul-preset-row-model],
[data-dsh-soul-preset-broken] {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-soul-preset-broken] {
  color: var(--dsw-alias-state-error-primary);
}

[data-dsh-soul-preset-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Destructive row action: the shared outline capsule, error-tinted. Appended
   after the shell's own sheet, so the tie on class specificity goes to it. */
.dsh-sp-danger {
  color: var(--dsw-alias-state-error-primary);
}
`;
		/**
		* Put the sheet in the page, unless it is already there.
		*
		* The duplicate guard covers a re-apply that did not go through disposal (an
		* HMR replacement removes the tag before the new instance runs, but a second
		* `apply` on the live plugin would not).
		* @returns the disposer that removes the tag this call owns.
		*/
		function installStyles() {
			if (typeof document === "undefined") return () => {};
			const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`);
			if (existing !== null) return () => {
				existing.remove();
			};
			const tag = document.createElement("style");
			tag.dataset.plugin = STYLE_PLUGIN_ID;
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = CSS_TEXT;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion
		//#region src/client.js
		/**
		* The React half of the browser bundle: three components and the wiring call.
		* Every React-free behavior — the roster store, the seat, the dictionary, the
		* registrations — lives in `./client-seats.mjs`, which is what makes the
		* registration shape testable without React resolvable.
		*
		* The switch list and the row actions are the shell's own primitives, fetched
		* from the module table: `Menu` is the card the mode selector opens, so the two
		* dropdowns in one composer row cannot drift apart, and it is what caps a long
		* list and scrolls it. `./client-styles.mjs` carries the rest of the styling.
		*
		* Each component receives the seat's fields as props plus the framework-seated
		* `t` (from the registration's `locale:`); it must not expect a `t` on the seat.
		* @module dsh-soul-presets/src/client
		*/
		/**
		* Subscribe a component to one external store.
		* @param store - the snapshot store.
		* @returns the current snapshot.
		*/
		function useStore(store) {
			return react.useSyncExternalStore(react.useCallback((listener) => store.subscribe(listener), [store]), react.useCallback(() => store.getSnapshot(), [store]));
		}
		/**
		* Read the agent preset selected for this session-scoped composer.
		* @param props - the slot's session props.
		* @returns whether this session is in qa mode.
		*/
		function useQaMode({ sessionId, useSessions }) {
			return useSessions((state) => state.byId[sessionId]?.projectionValues?.agentPreset === "qa");
		}
		/**
		* The current preset as one line, or the stale-selection notice. A selection
		* that comes from the deployment default rather than the session's own choice
		* is marked as such, so "默认" reads as "inherited", not "chosen here".
		* @param props - the injected `t` and the decoded roster.
		* @returns the line, the notice, or null when nothing is selected.
		*/
		function SelectionHint({ t, roster }) {
			const current = activeRow(roster);
			if (roster.active !== null && current === null) return react.createElement("div", { "data-dsh-soul-preset-stale": "" }, t("stale"));
			if (current === null) return null;
			const labels = presetLabels(current);
			const label = roster.overridden ? t("currentLabel") : `${t("currentLabel")}（${t("defaultMark")}）`;
			return react.createElement("div", { "data-dsh-soul-preset-line": "" }, react.createElement("span", null, `${label}：${labels.name}`), labels.hint === "" ? null : react.createElement("span", null, ` · ${labels.hint}`));
		}
		/**
		* One switch-list row's body: the name, then whatever else identifies the
		* preset — its description and hint, or the reason it cannot be selected.
		* @param t - the seat's dictionary.
		* @param row - one roster row.
		* @returns the label node the menu row renders.
		*/
		function presetRowLabel(t, row) {
			const labels = presetLabels(row);
			const note = (row.broken === void 0 ? [
				labels.description === "" ? null : react.createElement("span", {
					key: "description",
					className: "dsh-sp-row-part",
					"data-dsh-soul-preset-description": ""
				}, labels.description),
				labels.hint === "" ? null : react.createElement("span", {
					key: "hint",
					className: "dsh-sp-row-part",
					"data-dsh-soul-preset-hint": ""
				}, labels.hint),
				labels.model === "" ? null : react.createElement("span", {
					key: "model",
					className: "dsh-sp-row-part",
					"data-dsh-soul-preset-model": ""
				}, `${t("modelPrefix")} ${labels.model}`)
			].filter((part) => part !== null) : [react.createElement("span", {
				key: "broken",
				className: "dsh-sp-row-part dsh-sp-row-broken",
				"data-dsh-soul-preset-broken": ""
			}, `${t("brokenPrefix")}：${row.broken}`)]).flatMap((part, index) => index === 0 ? [part] : [" · ", part]);
			return react.createElement("span", { className: "dsh-sp-row" }, react.createElement("span", {
				className: "dsh-sp-row-name",
				"data-dsh-soul-preset-name": ""
			}, labels.name), note.length === 0 ? null : react.createElement("span", { className: "dsh-sp-row-note" }, note));
		}
		/**
		* The composer chip and, while open, the switch list. Selecting a row sets THIS
		* session's own preset; a session that has done so also sees the 「跟随默认」
		* row, which clears the override and returns it to the deployment default.
		* @param props - seat fields plus `t` and the session-scoped slot props.
		* @returns the chip element.
		*/
		function PresetChip(props) {
			const { t, roster, selectSession, resetSession, refresh } = props;
			const qa = useQaMode(props);
			const sessionId = props.sessionId;
			const [open, setOpen] = react.useState(false);
			const snapshot = useStore(roster);
			const active = snapshot.roster.active;
			const current = activeRow(snapshot.roster);
			const label = active !== null && current === null ? t("chipStale") : current === null ? t("chipEmpty") : snapshot.roster.overridden ? presetLabels(current).name : `${t("defaultMark")}·${presetLabels(current).name}`;
			react.useEffect(() => {
				if (qa) refresh(sessionId);
			}, [
				qa,
				refresh,
				sessionId
			]);
			const items = snapshot.roster.presets.length === 0 ? [{
				type: "label",
				id: "empty",
				text: t("empty")
			}] : [...snapshot.roster.overridden ? [{
				id: FOLLOW_DEFAULT,
				label: react.createElement("span", {
					className: "dsh-sp-row dsh-sp-row-follow",
					"data-dsh-soul-preset-follow": ""
				}, react.createElement("span", { className: "dsh-sp-row-name" }, t("followDefault")))
			}] : [], ...snapshot.roster.presets.map((row) => ({
				id: row.id,
				disabled: row.broken !== void 0,
				label: presetRowLabel(t, row)
			}))];
			if (!qa) return null;
			return react.createElement(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				items,
				selectedId: active ?? void 0,
				onSelect: (id) => {
					setOpen(false);
					id === "__follow_default__" ? resetSession(sessionId) : selectSession(sessionId, id);
				},
				onClose: () => {
					setOpen(false);
				},
				side: "top",
				portal: true,
				listClassName: "dsh-sp-menu-cap",
				anchor: react.createElement("button", {
					type: "button",
					className: "dsh-sp-chip",
					"data-dsh-soul-preset-chip": "",
					"aria-haspopup": "menu",
					"aria-expanded": open,
					title: t("switchTitle"),
					onClick: () => {
						setOpen((value) => !value);
						if (!open) refresh(sessionId);
					}
				}, react.createElement("span", { className: "dsh-sp-chip-label" }, label), react.createElement("span", {
					className: open ? "dsh-sp-chevron dsh-sp-chevron-open" : "dsh-sp-chevron",
					"aria-hidden": true
				}, react.createElement(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular)))
			});
		}
		/**
		* The name-and-hint line above the composer card.
		* @param props - seat fields plus `t` and the session-scoped slot props.
		* @returns the dock line.
		*/
		function PresetDock(props) {
			const { t, roster, refresh } = props;
			const qa = useQaMode(props);
			const snapshot = useStore(roster);
			react.useEffect(() => {
				if (qa) refresh(props.sessionId);
			}, [
				qa,
				refresh,
				props.sessionId
			]);
			const notice = snapshot.actionError ?? snapshot.error;
			if (!qa) return null;
			return react.createElement("div", { "data-dsh-soul-preset-dock": "" }, react.createElement(SelectionHint, {
				t,
				roster: snapshot.roster
			}), notice === null ? null : react.createElement("div", { "data-dsh-soul-preset-error": "" }, notice));
		}
		/**
		* The management section: list, create, delete with confirmation, reveal. This
		* surface reads the deployment's DEFAULT view and its select action sets the
		* default — the per-session choice lives in the composer chip. The section
		* carries no heading — the Settings shell renders the registration's label in
		* its navigation, as it does for every other section.
		* @param props - seat fields plus `t`.
		* @returns the settings section element.
		*/
		function ManagementSection(props) {
			const { t, defaults, select, create, remove, reveal } = props;
			const snapshot = useStore(defaults);
			const [pending, setPending] = react.useState(null);
			react.useEffect(() => {
				defaults.refresh();
			}, [defaults]);
			const notice = snapshot.actionError ?? snapshot.error;
			const rows = snapshot.roster.presets.map((row) => {
				const labels = presetLabels(row);
				const actions = pending === row.id ? [react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "confirm",
					variant: "outline",
					size: "sm",
					className: "dsh-sp-danger",
					"data-dsh-soul-preset-confirm": "",
					onClick: () => {
						setPending(null);
						remove(row.id);
					}
				}, t("confirmRemove")), react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "cancel",
					variant: "outline",
					size: "sm",
					"data-dsh-soul-preset-cancel": "",
					onClick: () => {
						setPending(null);
					}
				}, t("cancel"))] : [react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "remove",
					variant: "outline",
					size: "sm",
					className: "dsh-sp-danger",
					"data-dsh-soul-preset-remove": "",
					onClick: () => {
						setPending(row.id);
					}
				}, t("remove"))];
				return react.createElement("li", {
					key: row.id,
					"data-dsh-soul-preset-row": row.id
				}, react.createElement("span", { "data-dsh-soul-preset-row-text": "" }, react.createElement("button", {
					type: "button",
					"data-dsh-soul-preset-select": "",
					"aria-current": row.id === snapshot.roster.active ? "true" : void 0,
					disabled: row.broken !== void 0,
					onClick: () => {
						select(row.id);
					}
				}, labels.name), labels.description === "" ? null : react.createElement("span", { "data-dsh-soul-preset-row-desc": "" }, labels.description), labels.model === "" ? null : react.createElement("span", { "data-dsh-soul-preset-row-model": "" }, `${t("modelPrefix")}：${labels.model}`), row.broken === void 0 ? null : react.createElement("span", { "data-dsh-soul-preset-broken": "" }, `${t("brokenPrefix")}：${row.broken}`)), react.createElement("span", { "data-dsh-soul-preset-actions": "" }, ...actions));
			});
			return react.createElement("section", { "data-dsh-soul-preset-settings": "" }, react.createElement("p", { "data-dsh-soul-preset-root": "" }, `${t("rootLabel")}：${snapshot.roster.root}`), notice === null ? null : react.createElement("p", { "data-dsh-soul-preset-error": "" }, notice), snapshot.roster.presets.length === 0 ? react.createElement("p", null, t("empty")) : react.createElement("ul", null, rows), react.createElement("span", { "data-dsh-soul-preset-toolbar": "" }, react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "new",
				variant: "primary",
				"data-dsh-soul-preset-new": "",
				onClick: () => {
					const id = window.prompt(t("newPrompt"), "");
					if (id !== null && id !== "") create(id);
				}
			}, t("newPreset")), react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "reveal",
				variant: "outline",
				"data-dsh-soul-preset-reveal": "",
				onClick: () => {
					reveal();
				}
			}, t("openFolder")), react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "reload",
				variant: "outline",
				"data-dsh-soul-preset-reload": "",
				onClick: () => {
					defaults.refresh();
				}
			}, t("reload"))));
		}
		/**
		* Register the stylesheet, the dictionary, and the three surfaces.
		* @param ctx - client root context, with `slots`, `configForms` and `locale` live.
		*/
		function apply(ctx) {
			ctx.effect(() => installStyles(), "dsh-soul-presets: stylesheet");
			createSeats(ctx).registerSurfaces({
				chip: PresetChip,
				dock: PresetDock,
				settings: ManagementSection
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map