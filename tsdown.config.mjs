/**
 * Package-local tsdown config for the local soul-presets bundle. The repository
 * presets are workspace-only; this file restates the two artifact contracts the
 * package needs. Two passes in order, one lib/ directory: host ESM from
 * index.mjs, then the client CJS factory for the browser module loader.
 * `clean` is true only on the first pass — a default clean on the second would
 * wipe the host half.
 */

/** Package name; the loader handoff id and the client config's filter name. */
const ID = 'dsh-soul-presets'

/**
 * Module-table specifiers this bundle imports at runtime and must not inline.
 * `@deepseek-ai/dsh-client-ui-primitives` is a platform seed word: inlining it
 * would bundle a second copy of `Menu` instead of the shell's, which is what
 * keeps the switch list identical to the mode selector's.
 */
const MODULE_TABLE_KEYS = ['react', '@deepseek-ai/dsh-client-ui-primitives']

const isModuleTableKey = specifier => MODULE_TABLE_KEYS.includes(specifier)

const host = {
  name: ID,
  entry: { index: 'index.mjs' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
}

const client = {
  name: `${ID}/client`,
  entry: { client: 'src/client.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isModuleTableKey,
    alwaysBundle: specifier => !isModuleTableKey(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [host, client]
