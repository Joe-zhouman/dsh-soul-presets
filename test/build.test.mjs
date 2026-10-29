/**
 * Build regression, artifact wiring, and shipped interaction.
 *
 * Every other test imports `src/` directly, which is exactly what the deployed
 * package does NOT load: the profile loads `lib/index.js` and `lib/client.js`.
 * That leaves a whole class of failure invisible — a stale or broken build, a
 * client bundle the module loader rejects, a specifier the module table cannot
 * answer, `apply` that never registers the surfaces, or a callback that was
 * wired to nothing.
 *
 * So this file builds first and then judges the artifacts the deployment
 * actually receives: the built host entry is driven against the same fake
 * context the source test uses, the client factory is executed the way the
 * browser executes it, its components are rendered with a recording React, and
 * their event callbacks are fired.
 * @module dsh-soul-presets/test/build
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeCtx, withPresetRoot } from './support/fake-host-ctx.mjs'
import { guardServices } from './support/fake-client-ctx.mjs'
import { fakeUiPrimitives } from './support/fake-ui-primitives.mjs'
import { FOLLOW_DEFAULT, SELECT_ROUTE } from '../src/client-state.mjs'

/** The package root: this file lives in its test/ directory. */
const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** The platform module the bundle takes the shared menu and buttons from. */
const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'

const ROSTER_BODY = {
  presets: [{ id: 'translate', name: '翻译助手', description: '中英互译', hint: '贴段落' }],
  active: 'translate',
  root: 'L:\\x',
}

/** The build the assertions judge, so no test reads another run's artifacts. */
let built
function buildOnce() {
  built ??= spawnSync(process.execPath, [
    '../../node_modules/tsdown/dist/run.mjs',
    '--config', 'tsdown.config.mjs',
    '--config-loader', 'native',
  ], { cwd: root, encoding: 'utf8' })
  return built
}

/**
 * A recording React: elements become plain trees, and the store hook reads the
 * snapshot it is handed, so components can be invoked without a DOM.
 */
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useCallback: callback => callback,
  useState: initial => [initial, () => {}],
  useEffect: () => {},
}

/**
 * A recording React plus persistent hook state, so firing an event and
 * rendering again behaves the way React would.
 * @returns the React implementation and a render function.
 */
function createRenderer() {
  const slotsByComponent = new WeakMap()
  let current = null
  let cursor = 0
  return {
    react: {
      ...react,
      useState: initial => {
        const slots = slotsByComponent.get(current) ?? []
        if (slots[cursor] === undefined) slots[cursor] = initial
        const index = cursor
        cursor += 1
        slotsByComponent.set(current, slots)
        return [slots[index], value => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        }]
      },
    },
    /**
     * Render one component with its own hook state.
     * @param component - the component function.
     * @param props - the props to render with.
     * @returns the recorded element tree.
     */
    render(component, props) {
      current = component
      cursor = 0
      return component(props)
    },
  }
}

/**
 * Find the first element in a recorded tree matching a predicate.
 * @param node - a recorded element, or an array of them.
 * @param predicate - tested against each element.
 * @returns the element, or undefined.
 */
function findBy(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findBy(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  return findBy(node.children ?? [], predicate)
}

/** Find the first element carrying one prop. */
const findByProp = (node, key) => findBy(node, element => key in element.props)

/** Find the first element whose single child text is a dictionary key. */
const findButton = (node, label) => findBy(node, element => element.children?.[0] === label)

/** Session-scoped slot props, with a live agent preset projection. */
function sessionProps(seat, current) {
  return {
    t: key => key,
    ...seat,
    sessionId: 'current-session',
    useSessions: select => select({ byId: { 'current-session': {
      projectionValues: { agentPreset: current },
    } } }),
  }
}

/**
 * Render one recorded component element the way React would. The recording
 * React leaves a nested component as an element, so a test that needs its
 * output asks that element's own type for it — never a component with hooks.
 * @param element - the recorded element.
 * @returns what the component returns for its recorded props.
 */
const expand = element => element.type(element.props)

/**
 * Load the built client artifact the way the browser does and mount it.
 * @param reactImpl - the React implementation the artifact should receive.
 * @returns the exports, the registrations, the settings writes, and the seat.
 */
function loadClient(reactImpl = react) {
  const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const window = { __ModuleLoader__: { load(registration) { this.registration = registration } } }
  // eslint-disable-next-line no-new-func -- the artifact is a browser script, not a module
  new Function('window', client)(window)
  const registration = window.__ModuleLoader__.registration
  const primitives = fakeUiPrimitives(reactImpl)
  const exported = registration.factory(specifier => {
    if (specifier === 'react') return reactImpl
    if (specifier === PRIMITIVES) return primitives
    assert.fail(`the client bundle asked the module table for "${specifier}"`)
  })
  const registrations = []
  const writes = []
  exported.apply(guardServices({
    effect: factory => { factory() },
    locale: { register: () => {}, bind: () => key => key },
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { active: 'translate' }, writable: true, revision: 1 }),
        subscribe: () => () => {},
        set: async (field, value) => { writes.push({ field, value }) },
      }),
    },
    slots: {
      inject: (slot, factory) => { factory() },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
    on: () => () => {},
    remote: { $on: () => () => {} },
  }, exported.inject))
  const seat = registrations[0].options.inject()
  return { registration, exported, registrations, writes, seat, primitives }
}

/**
 * Run a body with a stubbed global fetch that records calls.
 * @param run - the body.
 * @returns whatever the body returns.
 */
async function withFetch(run) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', ...init.body === undefined ? {} : { body: JSON.parse(init.body) } })
    return { ok: true, status: 200, json: async () => ROSTER_BODY }
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

/**
 * Run a body with a document shallow enough for the style installer: it
 * records appended tags and answers the one selector that guards duplicates.
 * @param run - the body, which receives the recorded tags.
 * @returns whatever the body returns.
 */
async function withDocument(run) {
  const tags = []
  const original = globalThis.document
  globalThis.document = {
    head: { appendChild: tag => { tags.push(tag) } },
    createElement: () => {
      const tag = {
        dataset: {},
        textContent: '',
        remove() {
          const at = tags.indexOf(tag)
          if (at >= 0) tags.splice(at, 1)
        },
      }
      return tag
    },
    querySelector: (selector) => {
      const wanted = /^style\[data-plugin-css="(.*)"\]$/u.exec(selector)
      assert.ok(wanted !== null, `unexpected selector ${selector}`)
      return tags.find(tag => tag.dataset.pluginCss === wanted[1]) ?? null
    },
  }
  try {
    return await run(tags)
  } finally {
    delete globalThis.document
    if (original !== undefined) globalThis.document = original
  }
}

test('构建成功，且宿主产物导出插件面', async () => {
  const run = buildOnce()
  assert.equal(run.status, 0, `build exited ${String(run.status)}\n${run.stdout ?? ''}${run.stderr ?? ''}`)
  const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)
  assert.equal(host.name, 'dsh-soul-presets')
  assert.deepEqual(host.inject, ['webServer', 'agents', 'llm', 'sessionController', 'sessionProjections'])
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof host.resolvePresetRoot, 'function')
})

test('构建后的宿主入口行为与源码一致：配置、服务与四条路由', async () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)
  assert.equal(host.Config.dict.active.meta.volatile, true)
  withPresetRoot(() => {
    const { ctx, config, routes } = fakeCtx()
    host.apply(ctx, config)
    assert.deepEqual(routes.map(route => route.path), [
      '/plugins/soul-preset/roster',
      '/plugins/soul-preset/select',
      '/plugins/soul-preset/presets',
      '/plugins/soul-preset/reveal',
    ])
    const service = ctx.get('soulPresets')
    assert.deepEqual(service.roster().presets.map(preset => preset.id), ['translate'])
    assert.equal(service.promptText(join(tmpdir(), 'no-such-workspace')), null)
    ctx.__set({ active: 'translate' })
    assert.equal(service.promptText(join(tmpdir(), 'no-such-workspace')), 'T')
  })
})

test('客户端产物是模块加载器工厂，而不是 ESM 模块', () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const opening = client.slice(0, 400).replace(/\s+/gu, ' ')
  assert.ok(
    opening.startsWith('window.__ModuleLoader__.load({ id: "dsh-soul-presets", factory: (require) => {'),
    `lib/client.js opens with something other than the module-loader factory:\n${opening}`,
  )
  assert.match(client, /return module\.exports;\s*\}\s*\}\);/u, 'the factory must close with the module exports')
  assert.doesNotMatch(client, /^\s*(?:import|export)\s/mu, 'the client artifact is a CJS factory, not a module')
})

test('客户端产物真的注册三个界面，且只向模块表要两个平台模块', () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  const { registration, exported, registrations } = loadClient()
  assert.equal(registration.id, 'dsh-soul-presets')
  assert.deepEqual(exported.inject, ['slots', 'configForms', 'locale', 'remote'])
  assert.deepEqual(registrations.map(entry => entry.options.name), [
    'conversation.input.left', 'conversation.input.dock', 'settings.section',
  ])
  for (const entry of registrations) {
    assert.equal(typeof entry.component, 'function', `${entry.options.id} must register a component`)
    const seat = entry.options.inject()
    assert.equal(typeof seat, 'object', entry.options.id)
    assert.equal('t' in seat, false, `${entry.options.id} must not carry its own t`)
  }
  const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
  for (const specifier of ['react', PRIMITIVES]) {
    assert.match(
      client,
      new RegExp(`require\\("${specifier.replace(/[/@.]/gu, '\\$&')}"\\)`),
      `${specifier} 必须留给模块表`,
    )
  }
  // An inlined menu would drag its own `react-dom` along, and the require
  // handler above fails the whole file on a specifier the table cannot answer —
  // so bundling the primitive instead of sharing it cannot pass unnoticed.
})

/**
 * The export names of the harness build the deployed plugin runs against.
 *
 * This package is a repo-external plugin installed into a checkout's profile,
 * so the primitives module it shares with the harness is that checkout's build.
 * The built module is a browser bundle — it imports CSS modules — so it is read
 * as text and its final `export { … }` clause is the export list. A deployment
 * elsewhere has no such build and simply skips the check below.
 * @returns the exported names, or undefined when there is no build here.
 */
function harnessPrimitives() {
  const built = join(root, '..', '..', 'packages', 'client', 'ui-primitives', 'lib', 'index.js')
  let source
  try {
    source = readFileSync(built, 'utf8')
  } catch {
    return undefined
  }
  const clause = /export \{([^}]*)\};?\s*(?:\/\/# sourceMappingURL=.*)?$/u.exec(source.trimEnd())
  assert.notEqual(clause, null, `${built} must end with its export list`)
  return new Set(clause[1].split(',').map(entry => {
    const alias = entry.split(/\s+as\s+/u)
    return alias[alias.length - 1].trim()
  }))
}

// The chip renders a chevron through the shared primitives module. 0.1.7
// renamed that icon (`IconChevronDownOutline14` -> `...Regular`) and the
// bundle kept asking for the old name: `createElement(undefined)` threw, the
// slot's error boundary swallowed the whole chip, and nothing else failed —
// the dock and the settings section do not use an icon. This asserts every
// member the bundle reads off the shared module still exists.
test('共享原语里被引用的每个成员都还在', async () => {
  assert.equal(buildOnce().status, 0, 'the artifact is only judged from a successful build')
  const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const binding = /([A-Za-z_$][A-Za-z0-9_$]*) = require\("@deepseek-ai\/dsh-client-ui-primitives"\)/u.exec(client)
  assert.notEqual(binding, null, 'the bundle must take the primitives from the module table')
  const used = [...client.matchAll(new RegExp(`${binding[1]}\\.([A-Za-z0-9_$]+)`, 'gu'))]
    .map(match => match[1])
  assert.ok(used.length > 0, 'the bundle must actually use the shared module')

  const exported = harnessPrimitives()
  if (exported === undefined) {
    console.log('skip: no harness build at packages/client/ui-primitives/lib to check against')
    return
  }
  for (const name of new Set(used)) {
    assert.ok(exported.has(name), `${PRIMITIVES} 不再导出 ${name}（0.1.7 改过图标命名）`)
  }
})

test('样式表按插件标记注入一次，并带着 chip 与列表行的规则', async () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  await withDocument((tags) => {
    loadClient()
    assert.equal(tags.length, 1, '激活必须注入恰好一份样式表')
    assert.equal(tags[0].dataset.plugin, 'dsh-soul-presets')
    assert.equal(tags[0].dataset.pluginCss, 'dsh-soul-presets/client-styles.css')
    // The two surfaces the sheet owns: the composer chip, and the row body
    // rendered inside the shared menu card.
    assert.match(tags[0].textContent, /\.dsh-sp-chip\b/u)
    assert.match(tags[0].textContent, /\.dsh-sp-row-name\b/u)
    assert.match(tags[0].textContent, /\.dsh-sp-menu-cap\b[^}]*max-height:\s*min\(320px,/u, '切换列表必须有矮于视口适配上限的滚动上限')
    assert.match(tags[0].textContent, /\[data-dsh-soul-preset-dock\]\s*\{[^}]*padding:\s*0 16px 0;/u, '提示行不能再额外撑开输入框上方间距')
    loadClient()
    assert.equal(tags.length, 1, '再次激活不该插入第二份')
  })
})

test('预设界面只在当前会话的问答模式显示，切换模式无需刷新', () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  const { registrations, seat, primitives } = loadClient()
  let current = 'standard'
  const props = {
    ...sessionProps(seat, current),
    useSessions: select => select({ byId: { 'current-session': { projectionValues: { agentPreset: current } } } }),
  }
  const chip = registrations[0].component
  const dock = registrations[1].component
  for (const value of ['standard', 'chat', null]) {
    current = value
    assert.equal(chip(props), null, `${String(value)} should not expose a focusable chip`)
    assert.equal(dock(props), null, `${String(value)} should not show the preset hint`)
  }
  current = 'qa'
  assert.equal(chip(props).type, primitives.Menu)
  assert.ok(findByProp(dock(props), 'data-dsh-soul-preset-dock'))
  current = 'standard'
  assert.equal(chip(props), null)
  assert.equal(dock(props), null)
  assert.ok(registrations[2].component({ t: key => key, ...seat }), 'settings remains available')
})

test('失败提示真的会渲染出来：dock 与设置页都显示同一句原因', () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  const { registrations, seat } = loadClient()
  const reason = 'preset "draft" already exists'
  seat.roster.reportFailure(reason)
  seat.defaults.reportFailure(reason)
  const props = sessionProps(seat, 'qa')
  for (const [index, label] of [[1, 'dock'], [2, '设置页']]) {
    const element = findByProp(registrations[index].component(props), 'data-dsh-soul-preset-error')
    assert.ok(element !== undefined, `${label} 必须渲染失败提示`)
    assert.deepEqual(element.children, [reason], label)
  }
})

test('读取失败也会渲染出来，动作提示缺席时用读取失败顶上', () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  const { registrations, seat } = loadClient()
  const readFailure = 'roster request failed with 503'
  const failing = { ...seat.roster.getSnapshot(), error: readFailure, actionError: null }
  const reader = { ...seat.roster, getSnapshot: () => failing }
  const props = { ...sessionProps(seat, 'qa'), roster: reader }
  const element = findByProp(registrations[1].component(props), 'data-dsh-soul-preset-error')
  assert.ok(element !== undefined, '读取失败必须渲染出来')
  assert.deepEqual(element.children, [readFailure])
})

test('产物交互：chip 把切换列表交给共用菜单，选行 POST 本会话的 select 并刷新列表', async () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  await withFetch(async calls => {
    const renderer = createRenderer()
    const { registrations, writes, seat, primitives } = loadClient(renderer.react)
    await seat.refresh()
    const chip = registrations[0].component
    const props = sessionProps(seat, 'qa')
    const menuOf = tree => findBy(tree, element => element.type === primitives.Menu)
    const closed = menuOf(renderer.render(chip, props))
    assert.ok(closed !== undefined, 'chip 必须由共用菜单承载')
    assert.equal(closed.props.open, false, '未展开时列表必须关闭')
    assert.equal(closed.props.side, 'top', '列表朝上展开')
    assert.equal(closed.props.portal, true, '列表必须挂到 body，免得被 composer 卡片裁掉')
    assert.equal(closed.props.selectedId, 'translate', '菜单要知道哪一行是当前项')
    assert.equal(closed.props.listClassName, 'dsh-sp-menu-cap', '列表卡片要带上压低滚动上限的类，长列表才会提前出滚动条')
    // The trigger travels as the menu's anchor rather than as a child, so the
    // click reaches it through that prop.
    assert.equal(closed.props.anchor.props['data-dsh-soul-preset-chip'], '')
    closed.props.anchor.props.onClick()
    const opened = menuOf(renderer.render(chip, props))
    assert.equal(opened.props.open, true, '点过 chip 之后列表必须打开')
    const row = findBy(expand(opened), element => element.props['data-item-id'] === 'translate')
    assert.ok(row !== undefined, '展开后必须有可选的预设行')
    assert.deepEqual(findByProp(row, 'data-dsh-soul-preset-name').children, ['翻译助手'])
    assert.deepEqual(findByProp(row, 'data-dsh-soul-preset-description').children, ['中英互译'])
    assert.deepEqual(findByProp(row, 'data-dsh-soul-preset-hint').children, ['贴段落'])
    row.props.onClick()
    assert.deepEqual(writes, [], 'chip 选行写的是这个会话的选择，不再写全局 settings')
    const select = calls.find(call => call.method === 'POST' && call.url === SELECT_ROUTE)
    assert.ok(select !== undefined, '选行必须 POST select 路由')
    assert.deepEqual(select.body, { session: 'current-session', id: 'translate' })
    assert.ok(calls.filter(call => call.method === 'GET').length >= 2, '选择后必须重新读一次列表')
    assert.equal(menuOf(renderer.render(chip, props)).props.open, false, '选定后列表必须关闭')
  })
})

test('产物交互：会话带覆盖时菜单顶部出现「跟随默认」，点它发不带 id 的 select', async () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  await withFetch(async calls => {
    const renderer = createRenderer()
    const { registrations, seat, primitives } = loadClient(renderer.react)
    await seat.refresh('current-session')
    const overridden = {
      ...seat.roster.getSnapshot(),
      roster: { ...seat.roster.getSnapshot().roster, overridden: true },
    }
    const props = { ...sessionProps(seat, 'qa'), roster: { ...seat.roster, getSnapshot: () => overridden } }
    const chip = registrations[0].component
    const menuOf = tree => findBy(tree, element => element.type === primitives.Menu)
    menuOf(renderer.render(chip, props)).props.anchor.props.onClick()
    const opened = menuOf(renderer.render(chip, props))
    assert.equal(opened.props.items[0].id, FOLLOW_DEFAULT, '覆盖存在时第一行必须是跟随默认')
    assert.equal(opened.props.items[1].id, 'translate', '预设行紧随其后')
    assert.ok(findByProp(expand(opened), 'data-dsh-soul-preset-follow') !== undefined, '跟随默认行有自己的探针')
    const followRow = findBy(expand(opened), element => element.props['data-item-id'] === FOLLOW_DEFAULT)
    followRow.props.onClick()
    const select = calls.find(call => call.method === 'POST' && call.url === SELECT_ROUTE)
    assert.deepEqual(select.body, { session: 'current-session' }, '重置不带 id')
  })
})

test('空目录时切换列表给的是不可选的一行说明，而不是空菜单', async () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  await withFetch(() => {
    const renderer = createRenderer()
    const { registrations, seat, primitives } = loadClient(renderer.react)
    const empty = { ...seat.roster.getSnapshot(), roster: { presets: [], active: null, root: 'L:\\x' } }
    const props = { ...sessionProps(seat, 'qa'), roster: { ...seat.roster, getSnapshot: () => empty } }
    const chip = registrations[0].component
    const menuOf = tree => findBy(tree, element => element.type === primitives.Menu)
    menuOf(renderer.render(chip, props)).props.anchor.props.onClick()
    const menu = menuOf(renderer.render(chip, props))
    assert.deepEqual(menu.props.items, [{ type: 'label', id: 'empty', text: 'empty' }])
  })
})

test('产物交互：删除要先确认，确认后才真的发 DELETE', async () => {
  assert.equal(buildOnce().status, 0, 'the artifacts are only judged from a successful build')
  await withFetch(async calls => {
    const renderer = createRenderer()
    const { registrations, seat } = loadClient(renderer.react)
    await seat.refresh()
    await seat.defaults.refresh()
    const settings = registrations[2].component
    const props = sessionProps(seat, 'qa')
    const first = renderer.render(settings, props)
    assert.ok(findButton(first, 'remove') !== undefined, '每行都应有删除按钮')
    assert.equal(findButton(first, 'confirmRemove'), undefined, '未点删除前不该出现确认按钮')
    findButton(first, 'remove').props.onClick()
    const confirming = renderer.render(settings, props)
    const confirm = findButton(confirming, 'confirmRemove')
    assert.ok(confirm !== undefined, '点过一次之后必须出现确认按钮')
    await confirm.props.onClick()
    assert.equal(calls.filter(call => call.method === 'DELETE').length, 1)
  })
})
