import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";
//#region src/selection.mjs
/**
* Per-session preset selections: the durable half of "the preset follows the
* session". One JSON object under the preset directory, session id -> preset id,
* insertion-ordered so the entry cap drops the oldest rows first.
*
* The file is this plugin's own persistence, never a preset: roster discovery
* lists only *.toml files whose stem matches the id rule, so .selections.json
* cannot appear as a row.
* @module dsh-soul-presets/src/selection
*/
/**
* Session ids accepted from the wire. The store mints `session-<uuid>` for real
* sessions and `session-<n>` in tests, so the rule covers both minted shapes.
* A map key only, never a path segment.
*/
const SESSION_ID = /^session-[A-Za-z0-9-]{1,64}$/;
/**
* Parse the persisted map.
* @param text - the file's text.
* @returns the ordered entries, or null when the text is not such a map.
*/
function parseEntries(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const entries = [];
	for (const [session, preset] of Object.entries(parsed)) {
		if (typeof preset !== "string") continue;
		if (!SESSION_ID.test(session)) continue;
		entries.push([session, preset]);
	}
	return entries;
}
/**
* Create the selection store.
* @param deps - the file to persist to, `read`/`write` implementations
* (injectable for tests), the preset-id rule for load-time filtering, and a
* logger for the failures that must not stay silent.
* @returns the store: `get`, `set`, `has`, `entries`, and `pruneWith`.
*/
function createSelectionStore({ file, read = readFileSync, write = writeFileSync, presetId = () => true, log = () => {} }) {
	function load() {
		let text;
		try {
			text = read(file, "utf8");
		} catch {
			return [];
		}
		const entries = parseEntries(text);
		if (entries === null) {
			log("soul-presets: the session-selection file is not valid JSON; starting empty");
			return [];
		}
		return entries.filter(([session, preset]) => presetId(preset));
	}
	let entries = load();
	function persist() {
		try {
			write(file, `${JSON.stringify(Object.fromEntries(entries))}\n`);
		} catch (error) {
			log(`soul-presets: persisting session selections failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return {
		/**
		* The preset one session overrides with, when it has one.
		* @param sessionId - the session id.
		* @returns the preset id, or undefined.
		*/
		get(sessionId) {
			if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return void 0;
			return entries.find(([session]) => session === sessionId)?.[1];
		},
		/**
		* Whether one session carries an override at all — the roster's
		* `overridden` flag, distinguishing "chose its own" from "follows the default".
		* @param sessionId - the session id.
		* @returns true when an entry exists.
		*/
		has(sessionId) {
			return this.get(sessionId) !== void 0;
		},
		/**
		* Set or clear one session's override.
		* @param sessionId - the session id.
		* @param presetIdValue - the preset id, or null/'' to follow the default again.
		* @returns true when the store changed and persisted.
		*/
		set(sessionId, presetIdValue) {
			if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return false;
			const next = presetIdValue === null || presetIdValue === "" ? null : presetIdValue;
			if (next !== null && (typeof next !== "string" || next === "")) return false;
			const index = entries.findIndex(([session]) => session === sessionId);
			if (next === null) {
				if (index === -1) return false;
				entries.splice(index, 1);
				persist();
				return true;
			}
			if (index !== -1) {
				if (entries[index][1] === next) return false;
				entries[index] = [sessionId, next];
				persist();
				return true;
			}
			entries.push([sessionId, next]);
			while (entries.length > 500) entries.shift();
			persist();
			return true;
		},
		/**
		* The current rows, oldest first.
		* @returns copies of the entries.
		*/
		entries() {
			return entries.map((entry) => [...entry]);
		},
		/**
		* Drop rows whose preset no longer exists. Called from roster reads, where
		* the live preset ids are already in hand.
		* @param validIds - the ids that currently exist.
		*/
		pruneWith(validIds) {
			const before = entries.length;
			entries = entries.filter(([, preset]) => validIds.has(preset));
			if (entries.length !== before) persist();
		}
	};
}
//#endregion
//#region src/models.mjs
/**
* Preset default models: resolving one preset's `[Model]` table against the
* live model registry, and installing it as the Session's own selection.
*
* The installation goes through the Session Controller's session-local entry
* point (`selectForNextRequest`): it appends the durable `model/selection`
* event the composer's model picker reads and moves the live Agent's selection,
* which is exactly what the model picker itself does — minus persisting the
* deployment default. `session.selectModel` is not used because it also writes
* the profile's default model, and a preset default must not move the
* deployment default for every other preset.
*
* That entry point is an internal field of the Session Controller rather than a
* published service method. A missing one is reported once at application time
* and leaves the session on its current model; nothing else breaks.
* @module dsh-soul-presets/src/models
*/
/**
* One preset's model route as the preset file declares it.
* @typedef {object} PresetModel
* @property {string} provider - registered provider route.
* @property {string} model - provider-owned model id.
* @property {string} [reasoningEffort] - adapter-owned effort, when the preset pins one.
*/
/**
* The one-line label the UI and logs use for a model spec.
* @param {PresetModel} spec - the declared route.
* @returns the `provider/model` label, with the effort appended when pinned.
*/
function modelLabel(spec) {
	const effort = spec.reasoningEffort === void 0 ? "" : ` (${spec.reasoningEffort})`;
	return `${spec.provider}/${spec.model}${effort}`;
}
/**
* Whether a session has neither used a model nor chosen one yet — the sessions a
* preset default may adopt. A logged request header means the conversation
* already ran on some model; a recorded selection means the user (or an earlier
* preset application) already had a say. Both are left alone.
* @param projections - the Session projection registry.
* @param session - the Session to inspect.
* @returns true only for a session with no model history at all.
*/
function isFreshSession(projections, session) {
	if (session.requestHeader() !== void 0) return false;
	const state = projections?.stateOf?.(session, "modelSelection");
	return state !== void 0 && state.pending === null && state.lastUsed === null;
}
/**
* Create the applier the host half and its routes share.
* @param deps - live Agent lookup, the Session Controller, the LLM registry,
* the Session projection registry, and a logger.
* @returns the applier with its `apply` operation.
*/
function createModelApplier({ agents, controller, llm, projections, log }) {
	/**
	* The Session's next selection, as the model picker would show it.
	* @param session - the Session to read.
	* @returns the selection, or null before any is recorded.
	*/
	const currentOf = (session) => {
		const state = projections?.stateOf?.(session, "modelSelection");
		return state === void 0 ? null : state.pending ?? state.lastUsed;
	};
	/**
	* Whether the recorded selection already names the resolved route. An effort
	* the preset does not pin never makes a route different.
	* @param current - the recorded selection, or null.
	* @param next - the resolved selection.
	* @returns true when applying would change nothing.
	*/
	const sameRoute = (current, next) => current !== null && current.provider === next.provider && current.model === next.model && (next.reasoningEffort === void 0 || current.reasoningEffort === next.reasoningEffort);
	return { 
	/**
	* Resolve one preset's model and install it on a live Session.
	* @param sessionId - the ordinary Session to switch.
	* @param spec - the preset's declared route.
	* @param options - `force` installs even when the route is already current
	* (a fresh Session records its starting model rather than merely matching it).
	* @returns what happened: `applied`, `unchanged`, `session-not-live`, or
	* `controller-unavailable`. Throws when the registry rejects the route.
	*/
async apply(sessionId, spec, { force = false } = {}) {
		if (!SESSION_ID.test(sessionId)) return { status: "not-an-ordinary-session" };
		const agent = agents?.get?.(sessionId);
		if (agent === void 0) return { status: "session-not-live" };
		const resolved = await llm.resolveCallConfig({
			provider: spec.provider,
			model: spec.model,
			...spec.reasoningEffort === void 0 ? {} : { reasoningEffort: spec.reasoningEffort }
		});
		const selection = {
			provider: resolved.provider,
			model: resolved.model,
			...resolved.reasoningEffort === void 0 ? {} : { reasoningEffort: resolved.reasoningEffort }
		};
		if (!force && sameRoute(currentOf(agent.session), selection)) return {
			status: "unchanged",
			selection
		};
		const entry = controller?.agents;
		if (typeof entry?.selectForNextRequest !== "function") {
			log("soul-presets: the Session Controller does not expose selectForNextRequest; preset model defaults are inert");
			return { status: "controller-unavailable" };
		}
		entry.selectForNextRequest(agent, selection);
		return {
			status: "applied",
			selection
		};
	} };
}
//#endregion
//#region src/assemble.mjs
/**
* Assembly of one preset's model-visible prompt text. Pure: no fs, no clock, no
* imports. The example block's exact bytes are the user's specification — the
* separator on its own line, every tag on its own line, contents not indented —
* so this module is the one place that layout is defined.
* @module dsh-soul-presets/src/assemble
*/
/** Byte ceiling for one assembled preset, matching the prompt row's own file cap. */
const MAX_ASSEMBLED_BYTES = 65536;
/**
* Whether one assembled text fits the byte ceiling. Counted in UTF-8 bytes, not
* characters: a Chinese prompt hits it about three times sooner.
* @param text - the assembled prompt text.
* @returns true when the text fits.
*/
function withinCap(text) {
	return Buffer.byteLength(text, "utf8") <= MAX_ASSEMBLED_BYTES;
}
/**
* Render the example block exactly as specified.
* @param user - the user half, already trimmed.
* @param assistant - the assistant half, already trimmed.
* @returns the block, starting at the separator line.
*/
function renderExample(user, assistant) {
	return [
		"===",
		"<example>",
		"<user>",
		user,
		"</user>",
		"<assistant>",
		assistant,
		"</assistant>",
		"</example>"
	].join("\n");
}
/**
* Assemble the complete text for one preset. The example block appears only when
* both halves carry text, so a preset that supplies one half renders the system
* prompt alone rather than a half-built example.
* @param prompt - the preset's three prompt blocks.
* @returns the assembled text, or `''` when every block is empty.
*/
function assemblePrompt(prompt) {
	const system = String(prompt.system ?? "").trim();
	const user = String(prompt.user ?? "").trim();
	const assistant = String(prompt.assistant ?? "").trim();
	const parts = system === "" ? [] : [system];
	if (user !== "" && assistant !== "") parts.push(renderExample(user, assistant));
	return parts.join("\n");
}
//#endregion
//#region src/presets.mjs
/**
* Preset discovery, parsing, and the synchronous snapshot every reader shares.
*
* Parsing is total: a malformed file yields a row carrying `broken` instead of
* throwing, because discovery must keep listing what the directory holds — a
* preset hidden on a parse error is a directory that occupies its id while
* being invisible and undeletable from the UI.
* @module dsh-soul-presets/src/presets
*/
/**
* Ids a preset file may carry. The id becomes a path segment in the file
* operations the routes perform, so this is a containment boundary rather than
* a style rule.
*/
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
/** The file suffix a preset file must have. */
const SUFFIX = ".toml";
/**
* Read one field that must be a non-empty string when present.
* @param record - the parsed table.
* @param key - the field name.
* @returns the value, or undefined when the field is absent.
* @throws {Error} when the field is present but not a non-empty string.
*/
function optionalString(record, key) {
	const value = record[key];
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
	return value;
}
/**
* The file name's id, or null when the name is not a preset file.
* @param fileName - one directory entry name.
* @returns the id, or null.
*/
function presetIdFromFile(fileName) {
	return fileName.endsWith(SUFFIX) ? fileName.slice(0, -5) : null;
}
/**
* Read the optional `[Model]` table: the model a session starts on when this
* preset takes effect. Both halves of a route are required together — a lone
* provider or model is always a typo, and accepting it would silently leave the
* session on whatever model it had.
* @param table - the parsed top-level table.
* @returns the model spec, or undefined when the preset names none.
* @throws {Error} when the table is present but malformed.
*/
function parseModel(table) {
	const model = table["Model"];
	if (model === void 0) return void 0;
	if (typeof model !== "object" || model === null || Array.isArray(model)) throw new Error("Model must be a table");
	const provider = optionalString(model, "provider");
	const id = optionalString(model, "model");
	if (provider === void 0 || id === void 0) throw new Error("Model must set both provider and model");
	const reasoningEffort = optionalString(model, "reasoningEffort");
	return {
		provider,
		model: id,
		...reasoningEffort === void 0 ? {} : { reasoningEffort }
	};
}
/**
* Parse one preset file.
* @param id - the id taken from the file name.
* @param source - the file's text.
* @returns a row with `text`, or a row carrying `broken` and no text.
*/
function parsePreset(id, source) {
	try {
		const table = parse(source);
		const name = optionalString(table, "preset");
		if (name === void 0) throw new Error("preset must name the preset (a non-empty string)");
		const description = optionalString(table, "description");
		const hint = optionalString(table, "hint");
		const model = parseModel(table);
		const prompt = table["Prompt"];
		if (prompt !== void 0 && (typeof prompt !== "object" || prompt === null || Array.isArray(prompt))) throw new Error("Prompt must be a table");
		const blocks = {
			system: optionalString(prompt ?? {}, "System") ?? "",
			user: optionalString(prompt ?? {}, "User") ?? "",
			assistant: optionalString(prompt ?? {}, "Assistant") ?? ""
		};
		if (blocks.system === "" && blocks.user === "" && blocks.assistant === "") throw new Error("Prompt must carry at least one of System, User, Assistant");
		const text = assemblePrompt(blocks);
		if (!withinCap(text)) throw new Error(`assembled prompt exceeds the ${String(MAX_ASSEMBLED_BYTES)}-byte ceiling`);
		return {
			id,
			name,
			...description === void 0 ? {} : { description },
			...hint === void 0 ? {} : { hint },
			...model === void 0 ? {} : { model },
			text
		};
	} catch (error) {
		return {
			id,
			broken: error instanceof Error ? error.message : String(error)
		};
	}
}
/** The workspace prompt file a session's working directory may carry. */
const WORKSPACE_FILE = "SOUL.md";
/**
* Read the session workspace's prompt file. Empty when the file is absent,
* empty, or over the ceiling — the same silent degrade the prompt row has
* always had.
* @param cwd - the session's working directory.
* @returns the trimmed text, or `''`.
*/
function readWorkspaceFile(cwd) {
	try {
		const raw = readFileSync(join(cwd, WORKSPACE_FILE), "utf8");
		if (!withinCap(raw)) return "";
		return raw.trim();
	} catch {
		return "";
	}
}
/**
* Read the directory's entries and their per-file change signature.
*
* The signature is per file, not per directory: a directory's mtime moves only
* when an entry is added, removed, or renamed, so an editor rewriting an
* existing preset in place would be invisible to a directory-level signature.
* @param root - the preset directory.
* @returns the entries and the signature they currently produce.
*/
function scan(root) {
	let names;
	try {
		names = readdirSync(root);
	} catch {
		return {
			files: [],
			signature: ""
		};
	}
	const files = [];
	for (const name of names) {
		const id = presetIdFromFile(name);
		if (id === null || !PRESET_ID.test(id)) continue;
		const path = join(root, name);
		let stat;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (!stat.isFile()) continue;
		files.push({
			id,
			path,
			mtimeMs: stat.mtimeMs,
			size: stat.size
		});
	}
	files.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	return {
		files,
		signature: files.map((file) => `${file.id}:${String(file.mtimeMs)}:${String(file.size)}`).join("|")
	};
}
/**
* Create the store every reader shares: one synchronous snapshot of the preset
* directory, rebuilt when any file's mtime or size moved.
* @param root - the preset directory.
* @returns roster and text readers over that snapshot.
*/
function createPresetStore(root) {
	let cache = {
		signature: null,
		presets: [],
		byId: /* @__PURE__ */ new Map()
	};
	function load() {
		const { files, signature } = scan(root);
		if (signature === cache.signature) return cache;
		const presets = files.map((file) => {
			try {
				return parsePreset(file.id, readFileSync(file.path, "utf8"));
			} catch (error) {
				return {
					id: file.id,
					broken: error instanceof Error ? error.message : String(error)
				};
			}
		});
		cache = {
			signature,
			presets,
			byId: new Map(presets.map((preset) => [preset.id, preset]))
		};
		return cache;
	}
	return {
		/**
		* Whether an id currently names a usable preset: present in the directory
		* and not broken. The per-session selection resolves against this, so an
		* override whose preset vanished degrades to the default instead of to
		* nothing.
		* @param id - a preset id.
		* @returns true when the id is selectable right now.
		*/
		has(id) {
			const preset = load().byId.get(id);
			return preset !== void 0 && preset.broken === void 0;
		},
		/**
		* The roster plus the requested active id, echoed back so the caller can
		* tell a stale selection from a live one.
		* @param active - the id the caller holds, or null.
		* @returns the rows and the active id.
		*/
		roster(active) {
			const { presets } = load();
			return {
				presets: presets.map((preset) => preset.broken === void 0 ? {
					id: preset.id,
					name: preset.name,
					...preset.description === void 0 ? {} : { description: preset.description },
					...preset.hint === void 0 ? {} : { hint: preset.hint },
					...preset.model === void 0 ? {} : { model: preset.model }
				} : {
					id: preset.id,
					broken: preset.broken
				}),
				active: active ?? null
			};
		},
		/**
		* The model spec one usable preset carries.
		* @param id - a preset id, or null.
		* @returns the spec, or undefined when the preset is absent, broken, or
		* names no model.
		*/
		model(id) {
			if (id === null) return void 0;
			const preset = load().byId.get(id);
			return preset === void 0 || preset.broken !== void 0 ? void 0 : preset.model;
		},
		/**
		* The composed prompt text for one session directory.
		* @param cwd - the session's working directory.
		* @param active - the id the settings hold, or null.
		* @returns the text, or null when no usable preset is selected — the caller
		* then falls back to the workspace file alone, which is today's behavior.
		*/
		text(cwd, active) {
			const preset = active === null ? void 0 : load().byId.get(active);
			const workspace = readWorkspaceFile(cwd);
			const usable = preset === void 0 || preset.broken !== void 0 ? null : preset.text;
			if (usable === null) return workspace === "" ? null : workspace;
			return workspace === "" ? usable : `${usable}\n\n${workspace}`;
		}
	};
}
//#endregion
//#region src/reveal.mjs
/**
* Reveal the preset directory on the host desktop.
*
* Deliberately not linked from the harness's native-command package: this
* caller only ever wants "show me this folder", which needs neither that
* package's cancellation plumbing nor its WSL handoff, while linking a harness
* package from an out-of-repo bundle adds resolution risk (it carries a cordis
* peer) for behavior this feature never uses.
* @module dsh-soul-presets/src/reveal
*/
/**
* The platform's folder opener, or null when there is none to call.
* @param platform - the running platform.
* @returns the command to spawn, or null.
*/
function openerFor(platform) {
	if (platform === "win32") return "explorer.exe";
	if (platform === "darwin") return "open";
	if (platform === "linux") return "xdg-open";
	return null;
}
/**
* Open one directory, reporting whether the desktop took it.
* @param path - the absolute directory to reveal.
* @param internals - platform and spawn implementation, injectable for tests.
* @returns `{ opened }` — false when no opener exists or it failed, so the
* caller shows the path instead.
*/
function revealDirectory(path, internals = {}) {
	const { platform = process.platform, spawn: spawnImpl = spawn } = internals;
	const command = openerFor(platform);
	if (command === null) return Promise.resolve({ opened: false });
	return new Promise((resolve) => {
		let settled = false;
		const done = (opened) => {
			if (settled) return;
			settled = true;
			resolve({ opened });
		};
		try {
			const child = spawnImpl(command, [path], {
				detached: true,
				stdio: "ignore"
			});
			child.on("error", () => {
				done(false);
			});
			child.on("spawn", () => {
				child.unref();
				done(true);
			});
		} catch {
			done(false);
		}
	});
}
//#endregion
//#region src/guard.mjs
/**
* The trust rule for this plugin's own routes.
*
* The shared `webServer` applies no authentication of its own: the process
* token and `dsh-auth-*` cookie fence lives in the browser-auth layer, which
* covers `GET /` and the `/api` channel only. A plugin route is therefore
* outside the fence and must decide for itself.
*
* The deciding check is the Host header, not `Sec-Fetch-Site`: under DNS
* rebinding the attacker's page resolves to a loopback address, so the browser
* reports a same-origin request and that header arrives normally. This mirrors
* the rule the harness uses for `/api` (client-connection's isTrustedApiRequest)
* with its non-loopback authority branch dropped — this deployment binds
* loopback only, and no seam exposes a trusted-host list to a plugin.
* @module dsh-soul-presets/src/guard
*/
/** Loopback authorities, with an optional port. */
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\]|::1)(?::\d{1,5})?$/i;
/**
* Whether every octet of a dotted-quad Host name is in range. The shape regex
* admits 1-3 digits per octet, so `127.999.999.999` would otherwise pass; the
* header is client-supplied even though a browser cannot forge it.
* @param host - the Host header value.
* @returns true for a non-dotted-quad authority or one with in-range octets.
*/
function octetsInRange(host) {
	const parts = (host.split(":")[0] ?? "").split(".");
	if (parts.length !== 4) return true;
	return parts.every((part) => Number(part) <= 255);
}
/**
* Whether one request may reach this plugin's routes.
* @param headers - the request headers (`host` and optional `origin`).
* @returns true only for a loopback Host whose Origin, when present, matches it.
*/
function isTrustedLocalRequest(headers) {
	const host = headers.host;
	if (typeof host !== "string" || !LOOPBACK.test(host) || !octetsInRange(host)) return false;
	const origin = headers.origin;
	if (origin === void 0) return true;
	if (typeof origin !== "string") return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/template.mjs
/**
* The template a new preset is created from. Its prompt bodies use TOML's
* multi-line literal form, so whatever is written inside — quotes, braces,
* JSON, `{{` — needs no escaping and cannot collide with the file's syntax.
* @module dsh-soul-presets/src/template
*/
/**
* Render the starting text for a new preset.
* @param id - the preset id, used as the starting display name.
* @returns TOML text that parses and validates.
*/
function presetTemplate(id) {
	return `preset = ${JSON.stringify(id)}
description = "一句话说明这套预设是做什么的"
hint = "给用户的提示：这套预设该问什么"

# 可选：这套预设的默认模型。新会话启动、或会话切到本预设时生效；
# 改这里不会动已经在跑的会话。去掉注释即启用，provider 与 model 必须同时写。
# [Model]
# provider = "paratera"
# model = "AZ-GPT-5.6-Luna"
# reasoningEffort = "high"

[Prompt]
System = '''
你是……
'''
User = '''
示例提问（与下面一段必须同时填写，示例块才会生效）
'''
Assistant = '''
示例回答
'''
`;
}
//#endregion
//#region src/routes.mjs
/**
* The plugin's four same-origin routes. Handlers are built from injected
* dependencies so tests drive them without a socket, and every one of them runs
* the loopback guard first.
*
* Create and delete share one route: `webServer` throws on a duplicate
* (kind, path), and a throw there kills the host fiber, so two exact routes on
* the same path would take the whole preset down. The method picks the action
* and the id travels in the JSON body for both.
* @module dsh-soul-presets/src/routes
*/
/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 4096;
/**
* Answer one request with JSON.
* @param res - the response.
* @param status - the HTTP status.
* @param payload - the JSON payload.
*/
function send(res, status, payload) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(payload));
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
* Read a bounded request body.
* @param req - the request.
* @returns the text, or null when the body exceeds the ceiling.
*/
async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/**
* Read and validate the `id` field of a request body.
* @param req - the request.
* @returns the id, or a status describing why it was refused.
*/
async function readId(req) {
	const body = await readBody(req);
	if (body === null) return { status: 413 };
	let parsed;
	try {
		parsed = JSON.parse(body === "" ? "{}" : body);
	} catch {
		return { status: 400 };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { status: 400 };
	const id = parsed.id;
	if (typeof id !== "string" || !PRESET_ID.test(id)) return { status: 400 };
	return { id };
}
/**
* Read and validate a selection body: `{session, id}` sets one session's
* override, `{session}` (or an empty/absent id) clears it back to the default.
* @param req - the request.
* @returns the session and the preset id (null for the reset), or a status.
*/
async function readSelection(req) {
	const body = await readBody(req);
	if (body === null) return { status: 413 };
	let parsed;
	try {
		parsed = JSON.parse(body === "" ? "{}" : body);
	} catch {
		return { status: 400 };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { status: 400 };
	const session = parsed.session;
	if (typeof session !== "string" || !SESSION_ID.test(session)) return { status: 400 };
	const raw = parsed.id;
	if (raw === void 0 || raw === null || raw === "") return {
		session,
		id: null
	};
	if (typeof raw !== "string" || !PRESET_ID.test(raw)) return { status: 400 };
	return {
		session,
		id: raw
	};
}
/**
* The validated `session` query parameter of a request URL, when it carries one.
* A GET read stays lenient: absent or malformed simply means the default view.
* @param url - the request's URL.
* @returns the session id, or null.
*/
function sessionParam(url) {
	if (typeof url !== "string" || url === "") return null;
	let parsed;
	try {
		parsed = new URL(url, "http://localhost");
	} catch {
		return null;
	}
	const value = parsed.searchParams.get("session");
	return value !== null && SESSION_ID.test(value) ? value : null;
}
/**
* Build the route table.
* @param deps - root directory, preset store, per-session selection store,
* global-default reader, effective-selection resolver, preset-model applier,
* reveal action, logger, and (for tests) the unlink implementation.
* @returns route entries carrying an `id` for tests plus the webserver's fields.
*/
function createRoutes(deps) {
	const { root, store, active, selection, effective, applyModel, reveal, log, unlink = unlinkSync, write = writeFileSync } = deps;
	const guarded = (handler) => async (req, res) => {
		if (!isTrustedLocalRequest(req.headers)) {
			log("soul-presets: refused a request whose Host is not loopback");
			send(res, 403, { error: "this route is reachable from loopback only" });
			return;
		}
		await handler(req, res);
	};
	return [
		{
			id: "roster",
			kind: "exact",
			path: "/plugins/soul-preset/roster",
			handler: guarded((req, res) => {
				if (req.method !== "GET") {
					send(res, 405, { error: "use GET" });
					return;
				}
				const session = sessionParam(req.url);
				const echo = session === null ? active() : effective(session);
				send(res, 200, {
					...store.roster(echo),
					root,
					overridden: session !== null && selection.has(session)
				});
			})
		},
		{
			id: "select",
			kind: "exact",
			path: "/plugins/soul-preset/select",
			handler: guarded(async (req, res) => {
				if (req.method !== "POST") {
					send(res, 405, { error: "use POST" });
					return;
				}
				const request = await readSelection(req);
				if (request.session === void 0) {
					send(res, request.status, { error: "body must be {session, id?} with ids matching their rules" });
					return;
				}
				selection.set(request.session, request.id);
				const target = effective(request.session);
				let model;
				let modelError;
				const spec = store.model(target);
				if (spec !== void 0) try {
					const outcome = await applyModel(request.session, spec);
					if (outcome.selection !== void 0) model = outcome.selection;
				} catch (error) {
					modelError = messageOf(error);
					log(`soul-presets: preset "${String(target)}" model ${modelLabel(spec)} is unusable: ${modelError}`);
				}
				send(res, 200, {
					active: target,
					overridden: selection.has(request.session),
					...model === void 0 ? {} : { model },
					...modelError === void 0 ? {} : { modelError }
				});
			})
		},
		{
			id: "presets",
			kind: "exact",
			path: "/plugins/soul-preset/presets",
			handler: guarded(async (req, res) => {
				if (req.method === "POST") {
					const request = await readId(req);
					if (request.id === void 0) {
						send(res, request.status, { error: "id must match ^[a-z0-9][a-z0-9-]*$" });
						return;
					}
					try {
						write(join(root, `${request.id}.toml`), presetTemplate(request.id), { flag: "wx" });
					} catch (error) {
						const exists = error instanceof Error && "code" in error && error.code === "EEXIST";
						if (!exists) log(`soul-presets: creating "${request.id}" failed: ${messageOf(error)}`);
						send(res, exists ? 409 : 500, { error: exists ? `preset "${request.id}" already exists` : "could not create the preset" });
						return;
					}
					send(res, 201, { id: request.id });
					return;
				}
				if (req.method === "DELETE") {
					const request = await readId(req);
					if (request.id === void 0) {
						send(res, request.status, { error: "id must match ^[a-z0-9][a-z0-9-]*$" });
						return;
					}
					try {
						unlink(join(root, `${request.id}.toml`));
					} catch (error) {
						const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
						if (!missing) log(`soul-presets: deleting "${request.id}" failed: ${messageOf(error)}`);
						send(res, missing ? 404 : 500, { error: missing ? `preset "${request.id}" is not there` : "could not delete the preset" });
						return;
					}
					send(res, 200, { id: request.id });
					return;
				}
				send(res, 405, { error: "use POST to create or DELETE to remove" });
			})
		},
		{
			id: "reveal",
			kind: "exact",
			path: "/plugins/soul-preset/reveal",
			handler: guarded(async (req, res) => {
				if (req.method !== "POST") {
					send(res, 405, { error: "use POST" });
					return;
				}
				send(res, 200, {
					opened: (await reveal(root)).opened === true,
					path: root
				});
			})
		}
	];
}
//#endregion
//#region src/seed.mjs
/**
* First-run seeding of the bundled example presets.
*
* A fresh install presents an empty directory, and an empty switch menu teaches
* nothing about what a preset is — so the package ships a `presets/` directory
* of example tool prompts, and the Host copies them into `$DSH_HOME/
* soul-presets` once that directory holds no `.toml` of its own. The rule is
* deliberately "no .toml present", not "directory absent": an upgrade onto a
* deployment whose plugin already ran (and created an empty directory) seeds
* too. The flip side — wiping every preset and restarting brings the examples
* back — is the documented cost; keep one own file to stay unseeded.
*
* Seeding never overwrites (a same-named file cannot exist when the rule held,
* but the copy stays guarded anyway) and never deletes; the files land as
* ordinary user-owned presets, editable and removable through the same routes.
* @module dsh-soul-presets/src/seed
*/
/**
* The package's bundled example presets, relative to this module at runtime:
* `src/` in the working copy and the repository checkout, `lib/` in a built or
* installed package — both sit one level below the package root.
* @returns the bundled presets directory.
*/
function bundledPresetsDir() {
	return join(import.meta.dirname, "..", "presets");
}
/**
* Copy the bundled presets into the user's directory when it holds no `.toml`.
* @param deps - the user's preset root, the bundled directory (injectable for
* tests), `read`/`copy` implementations, and a logger.
* @returns how many files were seeded.
*/
function seedPresets({ root, bundle = bundledPresetsDir(), read = readdirSync, copy = copyFileSync, log = () => {} }) {
	let bundled;
	try {
		bundled = read(bundle);
	} catch {
		return 0;
	}
	let existing;
	try {
		existing = read(root);
	} catch {
		return 0;
	}
	if (existing.some((name) => name.endsWith(".toml"))) return 0;
	let seeded = 0;
	for (const name of bundled) {
		if (!name.endsWith(".toml")) continue;
		try {
			copy(join(bundle, name), join(root, name));
			seeded += 1;
		} catch (error) {
			log(`soul-presets: seeding "${name}" failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (seeded > 0) log(`soul-presets: seeded ${seeded} bundled example preset(s) into the empty directory`);
	return seeded;
}
//#endregion
//#region src/settings.mjs
/**
* The `soul-preset` plugin configuration: the deployment's global default
* preset. Per-session overrides live in the selection store, not here.
*
* The default is this plugin entry's Config rather than a settings
* namespace. `active` is volatile, so the settings form projects it, the
* active profile's patch persists a change, and Loader commits the new id
* into the running reference without remounting the plugin — which is what
* lets the preset row read the current default at its next assembly.
* @module dsh-soul-presets/src/settings
*/
/**
* The id rule with an empty value allowed, derived from the one source: the
* selection becomes a file name, so this is the same containment boundary the
* routes check.
*/
const ACTIVE_ID = new RegExp(`^(?:${PRESET_ID.source})?$`, PRESET_ID.flags);
/**
* An empty string means "no preset selected"; anything else must be a preset
* id, because the value is used to look up a file name.
*/
const SoulPresetSettings = z.object({ active: z.string().pattern(ACTIVE_ID).default("").volatile() });
//#endregion
//#region index.mjs
/**
* Host half of the local soul-presets bundle.
*
* It owns six things and nothing else: the preset directory as a synchronous
* snapshot (`soulPresets`), the `active` Config field holding the global
* default, the per-session selection store (`.selections.json`), the
* same-origin routes that read the roster, write per-session selections, and
* create, delete, and reveal preset files, the service the preset-scoped
* prompt row reads, and the preset default model a session adopts when it
* starts or when its preset is switched.
*
* The active id is cached in a plain variable rather than read from the Config
* reference on demand because the prompt row's text provider is a SYNCHRONOUS
* contract (system-prompt calls it and interpolates the result as a string),
* while a write settles through Loader asynchronously. The
* `loader/volatile-update` listener refreshes the cache; the text provider only
* reads memory.
* @module dsh-soul-presets
*/
/** Bundle id, as the profile's cordis patch row names it. */
const name = "dsh-soul-presets";
/** The active-preset selection, projected into the settings form for this entry. */
const Config = SoulPresetSettings;
/**
* Services this Host half needs before it applies. The model-default half needs
* the Agent runtime (to find the live session), the Session Controller (its
* session-local selection entry point), the LLM registry (route validation),
* and the projection registry (whether a session has a model history yet).
*/
const inject = [
	"webServer",
	"agents",
	"llm",
	"sessionController",
	"sessionProjections"
];
/**
* Resolve the preset directory.
* @param env - the process environment.
* @param home - the user's home directory.
* @returns the absolute preset directory.
*/
function resolvePresetRoot(env = process.env, home = homedir()) {
	return join(env.DSH_HOME !== void 0 && env.DSH_HOME !== "" ? env.DSH_HOME : join(home, ".dsh"), "soul-presets");
}
/**
* Serve the routes and provide the preset service.
* @param ctx - the plugin context, with `webServer` live.
* @param config - the resolved Config, whose `active` reference follows writes.
*/
function apply(ctx, config) {
	const root = resolvePresetRoot();
	const store = createPresetStore(root);
	const log = (message) => {
		ctx.logger.warn(message);
	};
	const selection = createSelectionStore({
		file: join(root, ".selections.json"),
		presetId: (id) => PRESET_ID.test(id),
		log
	});
	const selectionDep = config.active;
	let active = selectionDep.get() === "" ? null : selectionDep.get();
	ctx.on("loader/volatile-update", () => {
		const next = selectionDep.get();
		active = next === "" ? null : next;
	});
	const effective = (sessionId) => {
		const override = selection.get(sessionId);
		return override !== void 0 && store.has(override) ? override : active;
	};
	const models = createModelApplier({
		agents: ctx.agents,
		controller: ctx.sessionController,
		llm: ctx.llm,
		projections: ctx.sessionProjections,
		log
	});
	ctx.on("agent/created", async ({ agent }) => {
		const sessionId = agent.session.header.id;
		if (!SESSION_ID.test(sessionId)) return;
		if (!isFreshSession(ctx.sessionProjections, agent.session)) return;
		const id = effective(sessionId);
		const spec = store.model(id);
		if (spec === void 0) return;
		try {
			const outcome = await models.apply(sessionId, spec, { force: true });
			if (outcome.status !== "applied") log(`soul-presets: preset "${String(id)}" model ${modelLabel(spec)} was not applied (${outcome.status})`);
		} catch (error) {
			log(`soul-presets: preset "${String(id)}" model ${modelLabel(spec)} is unusable: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	ctx.provide("soulPresets", {
		/**
		* The roster, resolved for one session when asked: its `active` echo is the
		* session's effective preset and `overridden` says whether that comes from
		* the session's own choice or the global default. Stale override rows are
		* pruned here, where the live preset ids are already in hand.
		* @param sessionId - the session id, when resolving for one.
		* @returns the rows, the effective selection, and the override flag.
		*/
		roster(sessionId) {
			const base = store.roster(active);
			const validIds = new Set(base.presets.filter((row) => row.broken === void 0).map((row) => row.id));
			selection.pruneWith(validIds);
			return {
				...base,
				active: effective(sessionId),
				overridden: sessionId !== void 0 && selection.has(sessionId)
			};
		},
		/**
		* The composed prompt text for one session directory.
		* @param cwd - the session's working directory.
		* @param sessionId - the session whose preset resolves, when known.
		* @returns the text, or null when nothing is selected and the workspace file
		* carries nothing either.
		*/
		promptText: (cwd, sessionId) => store.text(cwd, effective(sessionId))
	});
	for (const route of createRoutes({
		root,
		store,
		active: () => active,
		selection,
		effective,
		applyModel: (sessionId, spec) => models.apply(sessionId, spec),
		reveal: revealDirectory,
		log
	})) ctx.effect(() => ctx.webServer.register({
		kind: route.kind,
		path: route.path,
		handler: route.handler
	}), `${name}: ${route.id}`);
	ctx.effect(() => {
		try {
			mkdirSync(root, { recursive: true });
		} catch {
			return;
		}
		try {
			seedPresets({
				root,
				log
			});
		} catch {}
	}, `${name}: preset root`);
}
//#endregion
export { Config, apply, inject, name, resolvePresetRoot };
