/**
 * Behavior of the per-session selection store: the durable half of "the preset
 * follows the session".
 * @module dsh-soul-presets/test/selection
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_ENTRIES, createSelectionStore } from '../src/selection.mjs'

/** ids the fixtures treat as live presets. */
const live = new Set(['translate', 'math-proof'])

/** Build a store over a real temp file, with the live-preset filter applied. */
function harness({ presetId } = {}) {
  const file = join(mkdtempSync(join(tmpdir(), 'soul-select-')), '.selections.json')
  const logged = []
  const store = createSelectionStore({
    file,
    presetId: presetId ?? (id => live.has(id)),
    log: message => { logged.push(message) },
  })
  return {
    file,
    store,
    logged,
    onDisk: () => readFileSync(file, 'utf8'),
    cleanup: () => rmSync(join(file, '..'), { recursive: true, force: true }),
  }
}

test('set 与 get：会话覆盖能写进、读出，并持久化到文件', () => {
  const h = harness()
  assert.equal(h.store.set('session-a', 'translate'), true)
  assert.equal(h.store.get('session-a'), 'translate')
  assert.equal(h.store.has('session-a'), true)
  assert.equal(JSON.parse(h.onDisk())['session-a'], 'translate')
  h.cleanup()
})

test('空串与 null 都表示清除覆盖，未写过的会话清除是空操作', () => {
  const h = harness()
  h.store.set('session-a', 'translate')
  assert.equal(h.store.set('session-a', null), true)
  assert.equal(h.store.get('session-a'), undefined)
  assert.equal(h.store.set('session-a', 'translate'), true)
  assert.equal(h.store.set('session-a', ''), true)
  assert.equal(h.store.has('session-a'), false)
  assert.equal(h.store.set('session-never', null), false)
  h.cleanup()
})

test('非法会话 id 与非字符串值一律拒绝，不动文件', () => {
  const h = harness()
  for (const bad of ['not-a-session', '../escape', 'sess_../../x', '', null, 42]) {
    assert.equal(h.store.set(bad, 'translate'), false, String(bad))
  }
  assert.equal(h.store.set('session-a', 42), false)
  let threw = null
  try { h.onDisk() } catch (error) { threw = error }
  assert.notEqual(threw, null, '没有发生过写入，文件不应存在')
  h.cleanup()
})

test('重载后覆盖仍在；指向已不存在预设的条目在加载时被滤掉', () => {
  const h = harness()
  h.store.set('session-a', 'translate')
  h.store.set('session-b', 'gone-preset')
  const second = createSelectionStore({
    file: h.file,
    presetId: id => live.has(id),
    log: () => {},
  })
  assert.equal(second.get('session-a'), 'translate')
  assert.equal(second.get('session-b'), undefined)
  h.cleanup()
})

test('pruneWith 清掉死条目并落盘，无变化时不写', () => {
  const h = harness()
  h.store.set('session-a', 'translate')
  h.store.set('session-b', 'gone-preset')
  h.store.pruneWith(new Set(['translate']))
  assert.deepEqual(h.store.entries(), [['session-a', 'translate']])
  const after = h.onDisk()
  h.store.pruneWith(new Set(['translate']))
  assert.equal(h.onDisk(), after, '无变化不得重复写盘')
  h.cleanup()
})

test('同键重设原地更新不改变插入序；上限挤出最旧条目', () => {
  const h = harness({ presetId: id => id.startsWith('p') })
  h.store.set('session-old', 'p1')
  h.store.set('session-keep', 'p2')
  h.store.set('session-old', 'p3')
  assert.deepEqual(h.store.entries(), [['session-old', 'p3'], ['session-keep', 'p2']])
  for (let i = 0; i < MAX_ENTRIES - 2; i += 1) h.store.set(`session-fill-${String(i)}`, 'p1')
  let entries = h.store.entries()
  assert.equal(entries.length, MAX_ENTRIES)
  assert.equal(entries.some(([session]) => session === 'session-old'), true)
  h.store.set('session-newest', 'p1')
  entries = h.store.entries()
  assert.equal(entries.length, MAX_ENTRIES, '超限后仍守住上限')
  assert.equal(entries.some(([session]) => session === 'session-old'), false, '挤掉的是最旧条目')
  assert.equal(entries.some(([session]) => session === 'session-keep'), true)
  h.cleanup()
})

test('损坏或非对象的文件：置空并记日志，而不是抛错', () => {
  for (const text of ['{broken', 'null', '"str"', '[["session-a","translate"]]']) {
    const file = join(mkdtempSync(join(tmpdir(), 'soul-select-')), '.selections.json')
    writeFileSync(file, text)
    const logged = []
    const store = createSelectionStore({ file, presetId: () => true, log: message => { logged.push(message) } })
    assert.deepEqual(store.entries(), [], text)
    assert.equal(logged.length, 1, text)
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('写盘失败记日志，不影响内存态', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'soul-select-')), '.selections.json')
  const logged = []
  const store = createSelectionStore({
    file,
    presetId: () => true,
    log: message => { logged.push(message) },
    write: () => { throw new Error('EACCES: permission denied') },
  })
  assert.equal(store.set('session-a', 'translate'), true)
  assert.equal(store.get('session-a'), 'translate')
  assert.match(logged[0], /EACCES/)
  rmSync(join(file, '..'), { recursive: true, force: true })
})
