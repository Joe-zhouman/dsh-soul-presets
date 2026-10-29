/**
 * Client-context test doubles that behave like the real one where it matters.
 *
 * The real cordis context guards service access: reading a service the plugin
 * did not declare in `inject` THROWS (`cannot get property "x" without inject`),
 * which optional chaining cannot protect against. A plain object stub hides that
 * entirely — the shipped plugin once failed activation in the browser on exactly
 * that mistake while every test stayed green.
 * @module dsh-soul-presets/test/support/fake-client-ctx
 */

/** Client service names cordis guards on read. */
const GUARDED = [
  'slots', 'configForms', 'locale', 'remote', 'modelDirectories', 'sessions', 'uiWorkspace', 'connection',
]

/**
 * Wrap a stub context so an undeclared service read throws the way cordis does.
 * @param target - the plain stub context.
 * @param declared - the service names the plugin declared in `inject`.
 * @returns the guarded context.
 */
export function guardServices(target, declared) {
  return new Proxy(target, {
    get(object, key) {
      if (typeof key === 'string' && GUARDED.includes(key) && !declared.includes(key)) {
        throw new Error(`cannot get property "${key}" without inject`)
      }
      return object[key]
    },
  })
}
