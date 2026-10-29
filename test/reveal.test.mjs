/**
 * Behavior of the directory opener: which command each platform gets, and what
 * the caller is told when no desktop takes the request.
 * @module dsh-soul-presets/test/reveal
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { revealDirectory } from '../src/reveal.mjs'

/** A child-process stand-in that can emit either outcome. */
function fakeChild() {
  const child = new EventEmitter()
  child.unrefCalled = false
  child.unref = () => { child.unrefCalled = true }
  return child
}

test('没有 opener 的平台直接回 opened:false', async () => {
  assert.deepEqual(await revealDirectory('L:\\x', { platform: 'sunos' }), { opened: false })
})

test('spawn 同步抛错时回 opened:false', async () => {
  const outcome = await revealDirectory('L:\\x', {
    platform: 'win32',
    spawn: () => { throw new Error('ENOENT') },
  })
  assert.deepEqual(outcome, { opened: false })
})

test('子进程报错时回 opened:false，不谎报打开成功', async () => {
  const child = fakeChild()
  const outcome = await revealDirectory('L:\\x', {
    platform: 'win32',
    spawn: () => { setImmediate(() => child.emit('error', new Error('EPERM'))); return child },
  })
  assert.deepEqual(outcome, { opened: false })
})

test('子进程起来了就回 opened:true，并传对命令、目录与选项', async () => {
  const child = fakeChild()
  let argv
  const outcome = await revealDirectory('L:\\x', {
    platform: 'win32',
    spawn: (command, args, options) => {
      argv = { command, args, options }
      setImmediate(() => child.emit('spawn'))
      return child
    },
  })
  assert.deepEqual(outcome, { opened: true })
  assert.equal(argv.command, 'explorer.exe')
  assert.deepEqual(argv.args, ['L:\\x'])
  assert.equal(argv.options.detached, true)
  assert.equal(child.unrefCalled, true)
})

test('macOS 与 Linux 各用各自的 opener', async () => {
  const seen = []
  const spawnImpl = command => {
    seen.push(command)
    const child = fakeChild()
    setImmediate(() => child.emit('spawn'))
    return child
  }
  await revealDirectory('/x', { platform: 'darwin', spawn: spawnImpl })
  await revealDirectory('/x', { platform: 'linux', spawn: spawnImpl })
  assert.deepEqual(seen, ['open', 'xdg-open'])
})
