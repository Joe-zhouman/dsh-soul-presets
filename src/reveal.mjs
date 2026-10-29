/**
 * Reveal the preset directory on the host desktop.
 *
 * Deliberately not linked from the harness's native-command package: this
 * caller only ever wants "show me this folder", which needs neither that
 * package's cancellation plumbing nor its WSL handoff, while linking a harness
 * package from an out-of-repo bundle adds resolution risk (it carries a cordis
 * peer) for behavior this feature never uses.
 * @module dsh-soul-presets/src/reveal
 */
import { spawn } from 'node:child_process'

/**
 * The platform's folder opener, or null when there is none to call.
 * @param platform - the running platform.
 * @returns the command to spawn, or null.
 */
function openerFor(platform) {
  if (platform === 'win32') return 'explorer.exe'
  if (platform === 'darwin') return 'open'
  if (platform === 'linux') return 'xdg-open'
  return null
}

/**
 * Open one directory, reporting whether the desktop took it.
 * @param path - the absolute directory to reveal.
 * @param internals - platform and spawn implementation, injectable for tests.
 * @returns `{ opened }` — false when no opener exists or it failed, so the
 * caller shows the path instead.
 */
export function revealDirectory(path, internals = {}) {
  const { platform = process.platform, spawn: spawnImpl = spawn } = internals
  const command = openerFor(platform)
  if (command === null) return Promise.resolve({ opened: false })
  return new Promise(resolve => {
    let settled = false
    const done = opened => {
      if (settled) return
      settled = true
      resolve({ opened })
    }
    try {
      const child = spawnImpl(command, [path], { detached: true, stdio: 'ignore' })
      // No desktop took the request: a missing opener binary, a permission
      // failure, or a synchronous spawn throw. All three mean the same thing to
      // the caller, which then shows the path instead of claiming it opened.
      child.on('error', () => { done(false) })
      child.on('spawn', () => { child.unref(); done(true) })
    } catch {
      done(false)
    }
  })
}
