/**
 * Behavior of the deployment-side prompt row (`soul-prompt.mjs`).
 *
 * This file is not part of the bundle, so the artifact test cannot reach it —
 * yet it holds the switch that decides whether a preset is consulted at all, and
 * the section flags that keep prompt text literal. A regression here would pass
 * every bundle test.
 * @module dsh-soul-presets/test/soul-prompt-row
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../../../.dsh-home/preset-plugins/soul-prompt.mjs'

/**
 * A row context that captures the section the row registers.
 * @param options - the `soulPresets` service, when the row should see one.
 * @returns the context and a reader for the captured section.
 */
function rowContext({ service } = {}) {
  let section
  return {
    ctx: {
      get: name => (name === 'soulPresets' ? service : undefined),
      systemPrompt: {
        section: definition => { section = definition },
        suppressRuntimeContext() {},
      },
    },
    section: () => section,
  }
}

/**
 * A temporary workspace carrying one prompt file.
 * @param fileName - the file to write, or undefined for an empty workspace.
 * @param text - the file's contents.
 * @returns the directory and its cleanup.
 */
function workspace(fileName, text) {
  const dir = mkdtempSync(join(tmpdir(), 'soul-row-'))
  if (fileName !== undefined) writeFileSync(join(dir, fileName), text)
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** One assembly context naming a session working directory (and id, optionally). */
const assemble = (dir, id) => ({
  agent: { session: { header: { cwd: dir, ...id === undefined ? {} : { id } } } },
})

test('开启 presets 时逐字采用服务给的文本', () => {
  // The workspace append belongs to the service (`promptText(cwd)` composes
  // preset + SOUL.md); the row hands back whatever it returns.
  const ws = workspace('SOUL.md', 'Answer in Chinese.')
  const { ctx, section } = rowContext({ service: { promptText: () => 'PRESET TEXT\n\nAnswer in Chinese.' } })
  apply(ctx, { mode: 'replace', presets: true, maxBytes: 65536 })
  assert.equal(section().text(assemble(ws.dir)), 'PRESET TEXT\n\nAnswer in Chinese.')
  ws.cleanup()
})

test('服务返回 null 时退回读工作区文件', () => {
  const ws = workspace('SOUL.md', 'ONLY SOUL')
  const { ctx, section } = rowContext({ service: { promptText: () => null } })
  apply(ctx, { mode: 'replace', presets: true })
  assert.equal(section().text(assemble(ws.dir)), 'ONLY SOUL')
  ws.cleanup()
})

test('服务缺席时退回读工作区文件——插件没装也不至于丢提示词', () => {
  const ws = workspace('SOUL.md', 'ONLY SOUL')
  const { ctx, section } = rowContext({})
  apply(ctx, { mode: 'replace', presets: true })
  assert.equal(section().text(assemble(ws.dir)), 'ONLY SOUL')
  ws.cleanup()
})

test('没开 presets 的行根本不问服务', () => {
  const ws = workspace('SOUL.md', 'ONLY SOUL')
  let asked = 0
  const { ctx, section } = rowContext({
    service: { promptText: () => { asked += 1; return 'PRESET TEXT' } },
  })
  apply(ctx, { mode: 'replace', maxBytes: 65536 })
  assert.equal(section().text(assemble(ws.dir)), 'ONLY SOUL')
  assert.equal(asked, 0)
  ws.cleanup()
})

test('append 模式在未开 presets 时是 persona 加文件，且不问服务——chat 行的实际配置', () => {
  const ws = workspace('CHAT.md', 'CHAT FILE')
  let asked = 0
  const { ctx, section } = rowContext({
    service: { promptText: () => { asked += 1; return 'PRESET TEXT' } },
  })
  apply(ctx, { mode: 'append', persona: 'PERSONA', file: 'CHAT.md' })
  assert.equal(section().text(assemble(ws.dir)), 'PERSONA\n\nCHAT FILE')
  assert.equal(asked, 0)
  ws.cleanup()
})

test('显式开了 presets 的行即使处于 append 模式也采用服务文本', () => {
  // The switch is the contract, not the mode: a row that asks for presets gets
  // them, and `mode` only decides the fallback once the service has nothing.
  const ws = workspace('CHAT.md', 'CHAT FILE')
  const { ctx, section } = rowContext({ service: { promptText: () => 'PRESET TEXT' } })
  apply(ctx, { mode: 'append', presets: true, persona: 'PERSONA', file: 'CHAT.md' })
  assert.equal(section().text(assemble(ws.dir)), 'PRESET TEXT')
  ws.cleanup()
})

test('服务收到会话 id 作为第二参，header 缺 id 时传 undefined', () => {
  const ws = workspace('SOUL.md', 'X')
  const calls = []
  const { ctx, section } = rowContext({
    service: { promptText: (cwd, sessionId) => { calls.push(sessionId); return 'PRESET TEXT' } },
  })
  apply(ctx, { mode: 'replace', presets: true })
  section().text(assemble(ws.dir, 'session-abc'))
  section().text(assemble(ws.dir))
  assert.deepEqual(calls, ['session-abc', undefined])
  ws.cleanup()
})

test('注册的 section 是完整提示词，且按字面量处理', () => {
  const { ctx, section } = rowContext({})
  apply(ctx, { mode: 'replace' })
  assert.equal(section().name, 'soul-prompt:complete')
  assert.equal(section().complete, true)
  assert.equal(section().interpolate, false)
})

test('工作区文件不存在时回落到该行的默认提示词', () => {
  const ws = workspace()
  const { ctx, section } = rowContext({})
  apply(ctx, { mode: 'replace', defaultPrompt: 'DEFAULT' })
  assert.equal(section().text(assemble(ws.dir)), 'DEFAULT')
  ws.cleanup()
})

test('append 模式的快照只取一次：同一 agent 之后读到第一次的内容', () => {
  // This is the mode's KV-cache contract: a long conversation's system prompt
  // must stay byte-stable, so the file is read once per agent.
  const ws = workspace('CHAT.md', 'FIRST')
  const { ctx, section } = rowContext({})
  apply(ctx, { mode: 'append', persona: 'PERSONA', file: 'CHAT.md' })
  const agent = { session: { header: { cwd: ws.dir } } }
  assert.equal(section().text({ agent }), 'PERSONA\n\nFIRST')
  writeFileSync(join(ws.dir, 'CHAT.md'), 'SECOND')
  assert.equal(section().text({ agent }), 'PERSONA\n\nFIRST')
  ws.cleanup()
})

test('replace 模式每次重读：改文件后同一个 agent 立刻看到新内容', () => {
  // The one-question-at-a-time mode has no prefix to protect, so it hot-reloads.
  const ws = workspace('SOUL.md', 'FIRST')
  const { ctx, section } = rowContext({})
  apply(ctx, { mode: 'replace', file: 'SOUL.md' })
  const agent = { session: { header: { cwd: ws.dir } } }
  assert.equal(section().text({ agent }), 'FIRST')
  writeFileSync(join(ws.dir, 'SOUL.md'), 'SECOND')
  assert.equal(section().text({ agent }), 'SECOND')
  ws.cleanup()
})
