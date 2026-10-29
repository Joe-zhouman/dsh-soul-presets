/**
 * Shared test doubles for the Host half.
 *
 * Both the source test and the artifact test use these, so the built entry is
 * judged by the same expectations as the source rather than by export names
 * alone.
 * @module dsh-soul-presets/test/support/fake-host-ctx
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A Host context whose services are real enough to catch misuse: `provide`/`get`
 * behave like cordis, `webServer.register` refuses a duplicate route the way the
 * real one does, and `loader/volatile-update` reaches the listener the plugin
 * registered.
 *
 * The Agent runtime, LLM registry, Session Controller, and projection registry
 * are plain injected doubles: absent ones default to a context where no session
 * is live and no model history exists.
 * @param options - the values the Config reference starts from, plus replacements
 * for the Host services the plugin reads.
 * @returns the context, the Config argument, and the recorded routes, effects,
 * listeners, and warnings.
 */
export function fakeCtx({
  settings = {},
  agents = { get: () => undefined },
  llm = { resolveCallConfig: async config => config },
  sessionController = {},
  sessionProjections = { stateOf: () => undefined },
} = {}) {
  const services = new Map()
  const routes = []
  const effects = []
  const listeners = new Map()
  const warnings = []
  let current = { active: '', ...settings }
  const ctx = {
    logger: { info() {}, warn(message) { warnings.push(message) } },
    webServer: {
      register: route => {
        const key = `${route.kind} ${route.path}`
        if (routes.some(existing => `${existing.kind} ${existing.path}` === key)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        }
        routes.push(route)
        return () => {}
      },
    },
    agents,
    llm,
    sessionController,
    sessionProjections,
    provide: (name, value) => { services.set(name, value); return () => { services.delete(name) } },
    get: name => services.get(name),
    effect: factory => { effects.push(factory()) },
    on: (event, handler) => { listeners.set(event, handler); return () => { listeners.delete(event) } },
  }
  // Loader commits the new values before it announces the update, so the
  // references move first and the listener follows.
  ctx.__set = next => {
    current = { ...current, ...next }
    listeners.get('loader/volatile-update')?.()
  }
  ctx.__emit = (event, payload) => listeners.get(event)?.(payload)
  return {
    ctx,
    config: { active: { get: () => current.active } },
    routes,
    effects,
    listeners,
    warnings,
  }
}

/**
 * Run one test body against a temporary DSH_HOME holding one preset.
 *
 * The body's completion is awaited before the cleanup: an async body that
 * suspends at its first `await` would otherwise resume after the `finally`
 * below has already deleted the directory, and the store's next scan would
 * find an empty world.
 * @param run - the test body.
 * @returns whatever the body returns.
 */
export async function withPresetRoot(run) {
  const home = mkdtempSync(join(tmpdir(), 'soul-home-'))
  // apply() scans $DSH_HOME/soul-presets, so the fixture must sit one level
  // BELOW the DSH_HOME this test injects. Writing translate.toml at the top
  // level would make apply() scan an empty directory and the assertions would
  // read an empty roster.
  const root = join(home, 'soul-presets')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'translate.toml'), 'preset = "翻译"\n[Prompt]\nSystem = "T"\n')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run(root)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}
