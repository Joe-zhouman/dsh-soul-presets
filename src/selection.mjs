/**
 * Per-session preset selections: the durable half of "the preset follows the
 * session". One JSON object under the preset directory, session id -> preset id,
 * insertion-ordered so the entry cap drops the oldest rows first.
 *
 * The file is this plugin's own persistence, never a preset: roster discovery
 * lists only *.toml files whose stem matches the id rule, so .selections.json
 * cannot appear as a row.
 * @module dsh-soul-presets/src/selection
 */
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Session ids accepted from the wire. The store mints `session-<uuid>` for real
 * sessions and `session-<n>` in tests, so the rule covers both minted shapes.
 * A map key only, never a path segment.
 */
export const SESSION_ID = /^session-[A-Za-z0-9-]{1,64}$/

/** Upper bound on remembered rows; the oldest insertion drops first. */
export const MAX_ENTRIES = 500

/**
 * Parse the persisted map.
 * @param text - the file's text.
 * @returns the ordered entries, or null when the text is not such a map.
 */
function parseEntries(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const entries = []
  for (const [session, preset] of Object.entries(parsed)) {
    if (typeof preset !== 'string') continue
    if (!SESSION_ID.test(session)) continue
    entries.push([session, preset])
  }
  return entries
}

/**
 * Create the selection store.
 * @param deps - the file to persist to, `read`/`write` implementations
 * (injectable for tests), the preset-id rule for load-time filtering, and a
 * logger for the failures that must not stay silent.
 * @returns the store: `get`, `set`, `has`, `entries`, and `pruneWith`.
 */
export function createSelectionStore({ file, read = readFileSync, write = writeFileSync, presetId = () => true, log = () => {} }) {
  function load() {
    let text
    try {
      text = read(file, 'utf8')
    } catch {
      // An absent file is simply nothing remembered yet.
      return []
    }
    const entries = parseEntries(text)
    if (entries === null) {
      log('soul-presets: the session-selection file is not valid JSON; starting empty')
      return []
    }
    return entries.filter(([session, preset]) => presetId(preset))
  }

  let entries = load()

  function persist() {
    try {
      write(file, `${JSON.stringify(Object.fromEntries(entries))}\n`)
    } catch (error) {
      log(`soul-presets: persisting session selections failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    /**
     * The preset one session overrides with, when it has one.
     * @param sessionId - the session id.
     * @returns the preset id, or undefined.
     */
    get(sessionId) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined
      return entries.find(([session]) => session === sessionId)?.[1]
    },
    /**
     * Whether one session carries an override at all — the roster's
     * `overridden` flag, distinguishing "chose its own" from "follows the default".
     * @param sessionId - the session id.
     * @returns true when an entry exists.
     */
    has(sessionId) {
      return this.get(sessionId) !== undefined
    },
    /**
     * Set or clear one session's override.
     * @param sessionId - the session id.
     * @param presetIdValue - the preset id, or null/'' to follow the default again.
     * @returns true when the store changed and persisted.
     */
    set(sessionId, presetIdValue) {
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return false
      const next = presetIdValue === null || presetIdValue === '' ? null : presetIdValue
      if (next !== null && (typeof next !== 'string' || next === '')) return false
      const index = entries.findIndex(([session]) => session === sessionId)
      if (next === null) {
        if (index === -1) return false
        entries.splice(index, 1)
        persist()
        return true
      }
      if (index !== -1) {
        if (entries[index][1] === next) return false
        // In place, not moved to the end: a session that chose early keeps its
        // seniority, so the entry cap drops the oldest CHOICE, not the oldest
        // re-confirmation.
        entries[index] = [sessionId, next]
        persist()
        return true
      }
      entries.push([sessionId, next])
      while (entries.length > MAX_ENTRIES) entries.shift()
      persist()
      return true
    },
    /**
     * The current rows, oldest first.
     * @returns copies of the entries.
     */
    entries() {
      return entries.map(entry => [...entry])
    },
    /**
     * Drop rows whose preset no longer exists. Called from roster reads, where
     * the live preset ids are already in hand.
     * @param validIds - the ids that currently exist.
     */
    pruneWith(validIds) {
      const before = entries.length
      entries = entries.filter(([, preset]) => validIds.has(preset))
      if (entries.length !== before) persist()
    },
  }
}
