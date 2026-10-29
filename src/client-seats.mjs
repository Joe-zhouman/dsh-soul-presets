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
import { PRESETS_ROUTE, REVEAL_ROUTE, ROSTER_ROUTE, SELECT_ROUTE, decodeRoster } from './client-state.mjs'

/** Bundle id, as the profile's cordis patch row names it. */
const ID = 'dsh-soul-presets'

/** The profile entry whose `active` field holds the selection; see the Host `Config`. */
export const SOUL_PRESET_ENTRY = 'local-soul-presets'

/** Locale namespace owned by this bundle's dictionary. */
export const NS = 'localSoulPreset'

/** Chinese copy. This is a single-user local deployment; see the spec. */
export const ZH = {
  nav: '预设提示词',
  chipEmpty: '选预设',
  chipStale: '预设已失效',
  switchTitle: '切换预设',
  currentLabel: '预设',
  defaultMark: '默认',
  followDefault: '跟随默认',
  stale: '当前选择指向的预设已不存在或已损坏，请重新选择。',
  brokenPrefix: '不可用',
  modelPrefix: '模型',
  modelFailed: '预设已切换，但模型没有切换',
  newPreset: '新建',
  newPrompt: '新预设的 id（小写字母、数字、连字符）',
  remove: '删除',
  confirmRemove: '确认删除',
  cancel: '取消',
  openFolder: '打开预设目录',
  rootLabel: '预设目录',
  reload: '重新载入',
  empty: '这个目录里还没有预设。新建一个，或手动放入 .toml 文件。',
}

/**
 * Services this browser half needs before it applies.
 *
 * `remote` is required even though the subscription below reads it with optional
 * chaining: cordis's service accessor THROWS on an undeclared service, so
 * `ctx.remote?.$on?.(...)` cannot protect against a missing declaration — it
 * only protects against a missing method.
 */
export const inject = ['slots', 'configForms', 'locale', 'remote']

/**
 * Read the roster from the Host, resolved for one session when asked.
 * @param sessionId - the session whose effective selection to read, or none for
 * the deployment's default view.
 * @returns the decoded roster.
 */
async function loadRoster(sessionId) {
  const query = sessionId === undefined ? '' : `?session=${encodeURIComponent(sessionId)}`
  const response = await fetch(`${ROSTER_ROUTE}${query}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`roster request failed with ${String(response.status)}`)
  return decodeRoster(await response.json())
}

/**
 * One error's message.
 * @param error - the thrown value.
 * @returns the message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
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
export function createRosterReader(load = loadRoster) {
  let state = {
    status: 'loading',
    roster: { presets: [], active: null, overridden: false, root: '' },
    error: null,
    actionError: null,
  }
  const listeners = new Set()
  // A subscriber that throws must not break the store: React's subscription
  // callback is a black box to us, and letting one bad listener escape would
  // skip the rest of the notification and — before the `finally` below — leave
  // the in-flight promise set forever, freezing every later read.
  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // Isolated on purpose; see above.
      }
    }
  }
  let inFlight = null
  let repeat = false
  const set = next => { state = { ...state, ...next }; emit() }

  async function read(arg) {
    try {
      set({ status: 'ready', roster: await load(arg), error: null })
    } catch (error) {
      // A failed read keeps the last rows on screen rather than blanking the
      // list, and records why.
      set({ status: 'error', error: messageOf(error) })
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /**
     * Read the roster, sharing the request with any concurrent caller.
     * @param arg - forwarded to the fetcher (the session to resolve for).
     * @returns the settled request.
     */
    refresh(arg) {
      if (inFlight === null) {
        inFlight = (async () => {
          try {
            do {
              repeat = false
              await read(arg)
            } while (repeat)
          } finally {
            // The promise must always be released, even if a future change to
            // `read` throws: a stuck in-flight promise freezes the store.
            inFlight = null
          }
        })()
      }
      return inFlight
    },
    /**
     * Announce that the roster changed. A read already in flight predates the
     * change, so the running loop performs one more read; a caller arriving with
     * no read in flight simply starts a fresh one.
     */
    invalidate() {
      if (inFlight !== null) repeat = true
    },
    /** The user started an action; the previous action's message no longer applies. */
    beginAction() {
      if (state.actionError !== null) set({ actionError: null })
    },
    /**
     * Record a failed user action (create, delete, reveal, switch) so the UI can
     * show it. Actions never reject; they report here instead.
     * @param message - what went wrong.
     */
    reportFailure(message) {
      set({ actionError: message })
    },
  }
}

/**
 * Register the dictionary, resolve the entry's config form, build the shared
 * seat, and expose the surface registration the React half calls.
 * @param ctx - client root context, with `slots`, `configForms` and `locale` live.
 * @returns the seat and the registrar that pairs surfaces with components.
 */
export function createSeats(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH }), `${ID}: dictionaries`)
  const selection = ctx.configForms.get(SOUL_PRESET_ENTRY)

  // The session view remembers the last session it resolved for: surfaces hand
  // their sessionId on every refresh, and a mutation that cannot know it (create,
  // delete, a default switch made on the settings page) still re-reads the same
  // session's view instead of swapping the chip to the default view mid-flight.
  const sessionLoader = (() => {
    let last
    return sessionId => {
      if (sessionId !== undefined) last = sessionId
      return loadRoster(last)
    }
  })()
  const roster = createRosterReader(sessionLoader)
  const defaults = createRosterReader(loadRoster)

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
      ...body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    })
    if (!response.ok) {
      // A refusal without a JSON body falls back to the status text; the body is
      // read best-effort and its absence is not itself worth reporting.
      const detail = await response.json().catch(() => null)
      throw new Error(detail?.error ?? `request failed with ${String(response.status)}`)
    }
    return response.json().catch(() => null)
  }

  /**
   * Surface a switch whose model half failed. The preset itself is already in
   * force, so this is a warning about the route rather than a failed action.
   * @param payload - the select route's parsed response.
   */
  const reportModelFailure = payload => {
    if (payload === null || typeof payload !== 'object' || typeof payload.modelError !== 'string') return
    roster.reportFailure(`${ZH.modelFailed}：${payload.modelError}`)
  }

  // User actions report into both readers instead of rejecting: the UI fires
  // them without awaiting, so a rejected promise would surface as an unhandled
  // rejection and the failure would be invisible. Both surfaces show their own
  // reader's failure line, and a failure anywhere is worth seeing everywhere.
  const runAction = async action => {
    roster.beginAction()
    defaults.beginAction()
    try {
      await action()
    } catch (error) {
      const message = messageOf(error)
      roster.reportFailure(message)
      defaults.reportFailure(message)
    }
  }

  // A mutation must also invalidate the reads of every reader it can move: a
  // read already in flight began before the change, so without this the caller
  // is handed the pre-mutation snapshot and the list stays wrong. `readers` is
  // the refresh scope — the session reader for a session-scoped switch, both
  // for directory or default changes.
  const runMutation = (action, readers = [roster, defaults]) =>
    runAction(async () => {
      await action()
      for (const reader of readers) reader.invalidate()
      await Promise.all(readers.map(reader => reader.refresh()))
    })

  const select = id => runMutation(() => selection.set('active', id))
  const selectSession = (sessionId, id) =>
    runMutation(async () => {
      reportModelFailure(await request('POST', SELECT_ROUTE, { session: sessionId, id }))
    }, [roster])
  const resetSession = sessionId =>
    runMutation(async () => {
      reportModelFailure(await request('POST', SELECT_ROUTE, { session: sessionId }))
    }, [roster])
  const create = id => runMutation(() => request('POST', PRESETS_ROUTE, { id }))
  const remove = id => runMutation(() => request('DELETE', PRESETS_ROUTE, { id }))
  const reveal = () => runAction(() => request('POST', REVEAL_ROUTE))

  // One seat object shared by all three surfaces: the same roster readers and
  // the same config form, so a switch made from either surface moves all of them.
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
    refresh: sessionId => roster.refresh(sessionId),
  }

  ctx.effect(() => {
    const disposers = [
      ctx.remote?.$on?.('settings/document-updated', ns => {
        if (ns === SOUL_PRESET_ENTRY) {
          void roster.refresh()
          void defaults.refresh()
        }
      }),
      ctx.on('connection/reset', () => {
        void roster.refresh()
        void defaults.refresh()
      }),
    ].filter(Boolean)
    return () => { for (const dispose of disposers) dispose() }
  }, `${ID}: roster invalidations`)

  return {
    seat,
    /**
     * Register the three surfaces with their React faces.
     * @param components - one component per surface.
     */
    registerSurfaces(components) {
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left', id: 'soul-preset-chip', order: 20, locale: NS, inject: () => seat,
      }, components.chip))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: 'soul-preset-dock', order: 20, locale: NS, inject: () => seat,
      }, components.dock))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'soul-presets',
        order: 25,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: () => seat,
      }, components.settings))
    },
  }
}
