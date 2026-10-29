/**
 * Behavior of the React-free browser half: what each user action actually sends,
 * what it does to shared state, and how failures surface.
 *
 * These drive the seat's real operations against a stubbed `fetch` and a stub
 * settings scope, so a no-op implementation, a wrong method or path, a missed
 * error, a stale post-mutation read, or a duplicate read all fail here.
 * @module dsh-soul-presets/test/client-seats
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRESETS_ROUTE, REVEAL_ROUTE, ROSTER_ROUTE, SELECT_ROUTE } from '../src/client-state.mjs'
import { createSeats, inject } from '../src/client-seats.mjs'
import { guardServices } from './support/fake-client-ctx.mjs'

/** Stub faces: this module is React-free, so the test supplies them. */
const STUBS = { chip: () => null, dock: () => null, settings: () => null }

const ROSTER_BODY = { presets: [{ id: 'translate', name: '翻译助手' }], active: 'translate', root: 'L:\\x' }
const ROSTER_WITH_DRAFT = {
  presets: [{ id: 'translate', name: '翻译助手' }, { id: 'draft', name: 'draft' }],
  active: 'translate',
  root: 'L:\\x',
}

/** A gate a held response waits on, so a read can be kept in flight. */
function gate() {
  let open
  const promise = new Promise(resolve => { open = resolve })
  return { promise, open }
}

/**
 * A client context plus a stubbed global fetch that records every call.
 * @param options - `respond` shapes each response; `hold` keeps a read in flight.
 * @returns the context, the recordings, and a restore function.
 */
function harness({ respond = null } = {}) {
  const calls = []
  const writes = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    }
    calls.push(call)
    const response = respond === null
      ? { ok: true, status: 200, json: async () => ROSTER_BODY }
      : respond(call)
    if (response.hold !== undefined) await response.hold.promise
    return response
  }
  const registrations = []
  const dictionaries = []
  const bound = []
  const listeners = new Map()
  return {
    ctx: guardServices({
      effect: factory => { factory() },
      locale: { register: (ns, dict) => { dictionaries.push({ ns, dict }) }, bind: ns => key => `${ns}.${key}` },
      configForms: {
        get: entryId => {
          bound.push(entryId)
          return {
            getSnapshot: () => ({ status: 'ready', value: { active: 'translate' }, writable: true, revision: 1 }),
            subscribe: () => () => {},
            set: async (field, value) => { writes.push({ field, value }) },
          }
        },
      },
      slots: {
        inject: (slot, factory) => { factory() },
        register: (options, component) => { registrations.push({ options, component }); return () => {} },
      },
      on: (event, handler) => { listeners.set(event, handler); return () => {} },
      remote: { $on: (event, handler) => { listeners.set(event, handler); return () => {} } },
    }, inject),
    calls, writes, registrations, dictionaries, bound, listeners,
    restore: () => { globalThis.fetch = original },
  }
}

/**
 * Mount the surfaces and hand back the shared seat.
 * @param h - the harness.
 * @returns the seat every surface receives.
 */
function mount(h) {
  createSeats(h.ctx).registerSurfaces(STUBS)
  return h.registrations[0].options.inject()
}

/** Count the roster reads a harness observed (the session view appends ?session=). */
function reads(h) {
  return h.calls.filter(call => call.url.startsWith(ROSTER_ROUTE)).length
}

test('声明需要的服务', () => {
  // `remote` 在这里是因为 cordis 对未声明服务的读取直接抛错——调用点的
  // 可选链替代不了声明。
  assert.deepEqual(inject, ['slots', 'configForms', 'locale', 'remote'])
})

test('注册三个界面到约定的 list 槽，每个注册都带真的组件与对象座位', () => {
  const h = harness()
  try {
    const seat = mount(h)
    assert.deepEqual(h.registrations.map(r => r.options.name), [
      'conversation.input.left', 'conversation.input.dock', 'settings.section',
    ])
    for (const registration of h.registrations) {
      assert.equal(typeof registration.component, 'function', registration.options.id)
      assert.equal(typeof registration.options.id, 'string')
      assert.equal(registration.options.locale, 'localSoulPreset')
      const attached = registration.options.inject()
      assert.equal(typeof attached, 'object', registration.options.id)
      assert.equal('t' in attached, false, `${registration.options.id} must not carry its own t`)
    }
    assert.equal(seat.roster, h.registrations[2].options.inject().roster)
  } finally {
    h.restore()
  }
})

test('select（设置页）写 settings 的 active 并刷新两个 roster 视图', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    await seat.select('draft')
    assert.deepEqual(h.writes, [{ field: 'active', value: 'draft' }])
    assert.equal(reads(h), 2, '默认视图与会话视图都要重读一次')
  } finally {
    h.restore()
  }
})

test('selectSession 只 POST select 路由与会话键，重置不带 id，都只刷新会话视图', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    await seat.selectSession('session-a', 'draft')
    assert.deepEqual(h.calls[0], { url: SELECT_ROUTE, method: 'POST', body: { session: 'session-a', id: 'draft' } })
    assert.equal(reads(h), 1, '会话内的选择不碰默认视图')
    h.calls.length = 0
    await seat.resetSession('session-a')
    assert.deepEqual(h.calls[0], { url: SELECT_ROUTE, method: 'POST', body: { session: 'session-a' } })
    assert.equal(reads(h), 1)
    assert.deepEqual(h.writes, [], '会话选择不再写全局 settings')
  } finally {
    h.restore()
  }
})

test('切换成功但模型没切过去时，把原因显示出来，预设切换仍算完成', async () => {
  const h = harness({
    respond: call => call.method === 'POST'
      ? {
        ok: true,
        status: 200,
        json: async () => ({ active: 'translate', overridden: true, modelError: 'provider "p" has no model "gone"' }),
      }
      : { ok: true, status: 200, json: async () => ROSTER_BODY },
  })
  try {
    const seat = mount(h)
    await seat.refresh()
    await seat.selectSession('session-a', 'translate')
    assert.match(seat.roster.getSnapshot().actionError, /预设已切换.*no model "gone"/u)
    assert.equal(seat.roster.getSnapshot().roster.active, 'translate', '预设本身照常切过去了')
  } finally {
    h.restore()
  }
})

test('会话视图的读取带 ?session=，并记住最近一次会话', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    await seat.refresh('session-a')
    assert.equal(h.calls[0].url, `${ROSTER_ROUTE}?session=session-a`)
    await seat.refresh('session-b')
    assert.equal(h.calls[1].url, `${ROSTER_ROUTE}?session=session-b`)
    h.calls.length = 0
    await seat.create('draft')
    assert.ok(h.calls.some(call => call.url === `${ROSTER_ROUTE}?session=session-b`),
      '不知道会话的动作（create）重读时沿用最近的会话视图，而不是退回默认视图')
    assert.ok(h.calls.some(call => call.url === ROSTER_ROUTE), '默认视图也要重读')
  } finally {
    h.restore()
  }
})

test('create 用 POST 送 id，remove 用 DELETE 送 id，两者随后都重读两个视图', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    await seat.create('draft')
    assert.deepEqual(h.calls.map(call => call.method), ['POST', 'GET', 'GET'])
    assert.deepEqual(h.calls[0].body, { id: 'draft' })
    assert.equal(h.calls[0].url, PRESETS_ROUTE)
    h.calls.length = 0
    await seat.remove('draft')
    assert.deepEqual(h.calls.map(call => call.method), ['DELETE', 'GET', 'GET'])
    assert.deepEqual(h.calls[0].body, { id: 'draft' })
  } finally {
    h.restore()
  }
})

test('reveal 只发一次 POST，不动 roster', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    await seat.reveal()
    assert.deepEqual(h.calls.map(call => call.method), ['POST'])
    assert.equal(h.calls[0].url, REVEAL_ROUTE)
  } finally {
    h.restore()
  }
})

test('三个界面共用一份 roster，纯并发刷新只读一次', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    assert.deepEqual(await Promise.all([seat.refresh(), seat.refresh()]).then(() => null), null)
    assert.equal(reads(h), 1, '并发刷新必须共用一次请求')
    assert.deepEqual(seat.roster.getSnapshot().roster.presets.map(p => p.id), ['translate'])
  } finally {
    h.restore()
  }
})

test('改动与在途刷新并发时，会再读一次并拿到改动后的列表', async () => {
  const held = gate()
  let gets = 0
  const h = harness({
    respond: call => {
      if (call.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 'draft' }) }
      gets += 1
      const first = gets === 1
      return {
        ok: true,
        status: 200,
        json: async () => (first ? ROSTER_BODY : ROSTER_WITH_DRAFT),
        ...first ? { hold: held } : {},
      }
    },
  })
  try {
    const seat = mount(h)
    const inFlight = seat.refresh()
    const created = seat.create('draft')
    held.open()
    await Promise.all([inFlight, created])
    assert.equal(reads(h), 3, '在途的读取早于改动，会话视图补读一次，默认视图也要读一次')
    assert.deepEqual(seat.roster.getSnapshot().roster.presets.map(p => p.id), ['translate', 'draft'])
  } finally {
    h.restore()
  }
})

test('失败的动作不 reject，把服务端原因记进 actionError，且不刷新列表', async () => {
  const h = harness({
    respond: () => ({ ok: false, status: 409, json: async () => ({ error: 'preset "draft" already exists' }) }),
  })
  try {
    const seat = mount(h)
    await seat.create('draft')
    assert.equal(seat.roster.getSnapshot().actionError, 'preset "draft" already exists')
    assert.equal(reads(h), 0)
  } finally {
    h.restore()
  }
})

test('服务端拒绝且响应体不是 JSON 时，回退到状态码文案', async () => {
  const h = harness({
    respond: () => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } }),
  })
  try {
    const seat = mount(h)
    await seat.remove('draft')
    assert.equal(seat.roster.getSnapshot().actionError, 'request failed with 500')
  } finally {
    h.restore()
  }
})

test('开始下一个动作时清掉上一次的动作提示', async () => {
  const h = harness({
    respond: call => call.method === 'DELETE'
      ? { ok: false, status: 500, json: async () => ({ error: 'could not delete the preset' }) }
      : { ok: true, status: 200, json: async () => ROSTER_BODY },
  })
  try {
    const seat = mount(h)
    await seat.remove('draft')
    assert.equal(seat.roster.getSnapshot().actionError, 'could not delete the preset')
    await seat.reveal()
    assert.equal(seat.roster.getSnapshot().actionError, null)
  } finally {
    h.restore()
  }
})

test('动作成功但随后的读取失败时，读取失败仍然可见——不被当成成功清掉', async () => {
  const h = harness({
    respond: call => call.method === 'POST'
      ? { ok: true, status: 201, json: async () => ({ id: 'draft' }) }
      : { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) },
  })
  try {
    const seat = mount(h)
    await seat.create('draft')
    const snapshot = seat.roster.getSnapshot()
    assert.equal(snapshot.actionError, null)
    assert.match(snapshot.error, /503/, '读取失败必须留在 error 上')
    assert.equal(snapshot.status, 'error')
  } finally {
    h.restore()
  }
})

test('roster 读取失败时保留上一次的行，并记录原因', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    await seat.refresh()
    assert.deepEqual(seat.roster.getSnapshot().roster.presets.map(p => p.id), ['translate'])
    globalThis.fetch = async () => { throw new Error('offline') }
    await seat.refresh()
    assert.equal(seat.roster.getSnapshot().error, 'offline')
    assert.deepEqual(seat.roster.getSnapshot().roster.presets.map(p => p.id), ['translate'])
  } finally {
    h.restore()
  }
})

test('设置表单按 profile entry 名取用', () => {
  const h = harness()
  try {
    mount(h)
    assert.deepEqual(h.bound, ['local-soul-presets'])
  } finally {
    h.restore()
  }
})

test('注册中文文案字典，且覆盖界面用到的键', () => {
  const h = harness()
  try {
    mount(h)
    assert.equal(h.dictionaries[0].ns, 'localSoulPreset')
    const zh = h.dictionaries[0].dict.zh
    for (const key of ['nav', 'chipEmpty', 'chipStale', 'switchTitle', 'currentLabel', 'defaultMark', 'followDefault', 'stale', 'modelPrefix', 'modelFailed', 'newPreset', 'remove', 'confirmRemove', 'openFolder', 'rootLabel', 'reload', 'empty']) {
      assert.equal(typeof zh[key], 'string', key)
    }
  } finally {
    h.restore()
  }
})

test('订阅 settings 与连接重置来刷新 roster', () => {
  const h = harness()
  try {
    mount(h)
    assert.equal(typeof h.listeners.get('settings/document-updated'), 'function')
    assert.equal(typeof h.listeners.get('connection/reset'), 'function')
  } finally {
    h.restore()
  }
})

test('订阅者抛错不会把 store 卡死，其他订阅者照常收到通知', async () => {
  const h = harness()
  try {
    const seat = mount(h)
    let notified = 0
    const stopBad = seat.roster.subscribe(() => { throw new Error('subscriber blew up') })
    const stopGood = seat.roster.subscribe(() => { notified += 1 })
    await seat.refresh()
    assert.ok(notified > 0, '好的订阅者必须收到通知')
    assert.equal(reads(h), 1)
    await seat.refresh()
    assert.equal(reads(h), 2, '第二次刷新必须真的再读一次，而不是卡在已死的 promise 上')
    stopBad()
    stopGood()
  } finally {
    h.restore()
  }
})
