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
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createModelApplier, isFreshSession, modelLabel } from './src/models.mjs'
import { createPresetStore } from './src/presets.mjs'
import { PRESET_ID } from './src/presets.mjs'
import { revealDirectory } from './src/reveal.mjs'
import { createRoutes } from './src/routes.mjs'
import { seedPresets } from './src/seed.mjs'
import { createSelectionStore, SESSION_ID } from './src/selection.mjs'
import { SoulPresetSettings } from './src/settings.mjs'

/** Bundle id, as the profile's cordis patch row names it. */
export const name = 'dsh-soul-presets'

/** The active-preset selection, projected into the settings form for this entry. */
export const Config = SoulPresetSettings

/**
 * Services this Host half needs before it applies. The model-default half needs
 * the Agent runtime (to find the live session), the Session Controller (its
 * session-local selection entry point), the LLM registry (route validation),
 * and the projection registry (whether a session has a model history yet).
 */
export const inject = ['webServer', 'agents', 'llm', 'sessionController', 'sessionProjections']

/**
 * Resolve the preset directory.
 * @param env - the process environment.
 * @param home - the user's home directory.
 * @returns the absolute preset directory.
 */
export function resolvePresetRoot(env = process.env, home = homedir()) {
  const dshHome = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(home, '.dsh')
  return join(dshHome, 'soul-presets')
}

/**
 * Serve the routes and provide the preset service.
 * @param ctx - the plugin context, with `webServer` live.
 * @param config - the resolved Config, whose `active` reference follows writes.
 */
export function apply(ctx, config) {
  const root = resolvePresetRoot()
  const store = createPresetStore(root)
  const log = message => { ctx.logger.warn(message) }
  const selection = createSelectionStore({
    file: join(root, '.selections.json'),
    presetId: id => PRESET_ID.test(id),
    log,
  })
  const selectionDep = config.active
  let active = selectionDep.get() === '' ? null : selectionDep.get()

  // Loader commits a new value into the reference before it announces the
  // update, and the prompt row's text provider is synchronous: refresh the
  // cache here so the provider never awaits anything.
  ctx.on('loader/volatile-update', () => {
    const next = selectionDep.get()
    active = next === '' ? null : next
  })

  // The id one assembly runs under: the session's own override when it names a
  // usable preset, otherwise the global default. A stale override degrades to
  // the default — never to "no selection".
  const effective = sessionId => {
    const override = selection.get(sessionId)
    return override !== undefined && store.has(override) ? override : active
  }

  const models = createModelApplier({
    agents: ctx.agents,
    controller: ctx.sessionController,
    llm: ctx.llm,
    projections: ctx.sessionProjections,
    log,
  })

  // A session that starts with no model history adopts its preset's `[Model]`
  // before its first request. Only creation is hooked: a preset file edited
  // later, or the global default moved later, never re-routes a conversation
  // that is already running — the same rule that governs the prompt text.
  // Subagent children are excluded by their identity shape: they are created
  // with a bare UUID and own their model policy elsewhere.
  ctx.on('agent/created', async ({ agent }) => {
    const sessionId = agent.session.header.id
    if (!SESSION_ID.test(sessionId)) return
    if (!isFreshSession(ctx.sessionProjections, agent.session)) return
    const id = effective(sessionId)
    const spec = store.model(id)
    if (spec === undefined) return
    try {
      const outcome = await models.apply(sessionId, spec, { force: true })
      if (outcome.status !== 'applied') {
        log(`soul-presets: preset "${String(id)}" model ${modelLabel(spec)} was not applied (${outcome.status})`)
      }
    } catch (error) {
      // A preset naming an unroutable model must not take session creation
      // down with it: the session stays on the deployment default and the log
      // names the bad route.
      log(`soul-presets: preset "${String(id)}" model ${modelLabel(spec)} is unusable: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.provide('soulPresets', {
    /**
     * The roster, resolved for one session when asked: its `active` echo is the
     * session's effective preset and `overridden` says whether that comes from
     * the session's own choice or the global default. Stale override rows are
     * pruned here, where the live preset ids are already in hand.
     * @param sessionId - the session id, when resolving for one.
     * @returns the rows, the effective selection, and the override flag.
     */
    roster(sessionId) {
      const base = store.roster(active)
      const validIds = new Set(base.presets.filter(row => row.broken === undefined).map(row => row.id))
      selection.pruneWith(validIds)
      return {
        ...base,
        active: effective(sessionId),
        overridden: sessionId !== undefined && selection.has(sessionId),
      }
    },
    /**
     * The composed prompt text for one session directory.
     * @param cwd - the session's working directory.
     * @param sessionId - the session whose preset resolves, when known.
     * @returns the text, or null when nothing is selected and the workspace file
     * carries nothing either.
     */
    promptText: (cwd, sessionId) => store.text(cwd, effective(sessionId)),
  })

  for (const route of createRoutes({
    root,
    store,
    active: () => active,
    selection,
    effective,
    applyModel: (sessionId, spec) => models.apply(sessionId, spec),
    reveal: revealDirectory,
    log,
  })) {
    ctx.effect(
      () => ctx.webServer.register({ kind: route.kind, path: route.path, handler: route.handler }),
      `${name}: ${route.id}`,
    )
  }

  // The directory is created on apply: the create route needs it to exist, and
  // an unusable root degrades to an empty roster rather than failing the fiber.
  // A directory that holds no .toml of its own then receives the bundled
  // example presets once — a fresh install starts with a usable menu instead
  // of an empty one.
  ctx.effect(() => {
    try {
      mkdirSync(root, { recursive: true })
    } catch {
      // A read-only or missing parent leaves an empty roster; a write attempt
      // reports the failure through its own route.
      return
    }
    try {
      seedPresets({ root, log })
    } catch {
      // Seeding is an amenity: any failure here leaves the empty roster the
      // deployment would have had anyway.
    }
  }, `${name}: preset root`)
}
