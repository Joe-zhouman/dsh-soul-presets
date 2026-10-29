/**
 * Preset discovery, parsing, and the synchronous snapshot every reader shares.
 *
 * Parsing is total: a malformed file yields a row carrying `broken` instead of
 * throwing, because discovery must keep listing what the directory holds — a
 * preset hidden on a parse error is a directory that occupies its id while
 * being invisible and undeletable from the UI.
 * @module dsh-soul-presets/src/presets
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { MAX_ASSEMBLED_BYTES, assemblePrompt, withinCap } from './assemble.mjs'

/**
 * Ids a preset file may carry. The id becomes a path segment in the file
 * operations the routes perform, so this is a containment boundary rather than
 * a style rule.
 */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** The file suffix a preset file must have. */
const SUFFIX = '.toml'

/**
 * Read one field that must be a non-empty string when present.
 * @param record - the parsed table.
 * @param key - the field name.
 * @returns the value, or undefined when the field is absent.
 * @throws {Error} when the field is present but not a non-empty string.
 */
function optionalString(record, key) {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} must be a non-empty string`)
  return value
}

/**
 * The file name's id, or null when the name is not a preset file.
 * @param fileName - one directory entry name.
 * @returns the id, or null.
 */
export function presetIdFromFile(fileName) {
  return fileName.endsWith(SUFFIX) ? fileName.slice(0, -SUFFIX.length) : null
}

/**
 * Read the optional `[Model]` table: the model a session starts on when this
 * preset takes effect. Both halves of a route are required together — a lone
 * provider or model is always a typo, and accepting it would silently leave the
 * session on whatever model it had.
 * @param table - the parsed top-level table.
 * @returns the model spec, or undefined when the preset names none.
 * @throws {Error} when the table is present but malformed.
 */
function parseModel(table) {
  const model = table['Model']
  if (model === undefined) return undefined
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    throw new Error('Model must be a table')
  }
  const provider = optionalString(model, 'provider')
  const id = optionalString(model, 'model')
  if (provider === undefined || id === undefined) {
    throw new Error('Model must set both provider and model')
  }
  const reasoningEffort = optionalString(model, 'reasoningEffort')
  return {
    provider,
    model: id,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

/**
 * Parse one preset file.
 * @param id - the id taken from the file name.
 * @param source - the file's text.
 * @returns a row with `text`, or a row carrying `broken` and no text.
 */
export function parsePreset(id, source) {
  try {
    const table = parseToml(source)
    const name = optionalString(table, 'preset')
    if (name === undefined) throw new Error('preset must name the preset (a non-empty string)')
    const description = optionalString(table, 'description')
    const hint = optionalString(table, 'hint')
    const model = parseModel(table)
    const prompt = table['Prompt']
    if (prompt !== undefined && (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt))) {
      throw new Error('Prompt must be a table')
    }
    const blocks = {
      system: optionalString(prompt ?? {}, 'System') ?? '',
      user: optionalString(prompt ?? {}, 'User') ?? '',
      assistant: optionalString(prompt ?? {}, 'Assistant') ?? '',
    }
    if (blocks.system === '' && blocks.user === '' && blocks.assistant === '') {
      throw new Error('Prompt must carry at least one of System, User, Assistant')
    }
    const text = assemblePrompt(blocks)
    if (!withinCap(text)) throw new Error(`assembled prompt exceeds the ${String(MAX_ASSEMBLED_BYTES)}-byte ceiling`)
    return {
      id,
      name,
      ...description === undefined ? {} : { description },
      ...hint === undefined ? {} : { hint },
      ...model === undefined ? {} : { model },
      text,
    }
  } catch (error) {
    return { id, broken: error instanceof Error ? error.message : String(error) }
  }
}

/** The workspace prompt file a session's working directory may carry. */
const WORKSPACE_FILE = 'SOUL.md'

/**
 * Read the session workspace's prompt file. Empty when the file is absent,
 * empty, or over the ceiling — the same silent degrade the prompt row has
 * always had.
 * @param cwd - the session's working directory.
 * @returns the trimmed text, or `''`.
 */
function readWorkspaceFile(cwd) {
  try {
    const raw = readFileSync(join(cwd, WORKSPACE_FILE), 'utf8')
    if (!withinCap(raw)) return ''
    return raw.trim()
  } catch {
    // Absent or unreadable both mean "this workspace adds nothing".
    return ''
  }
}

/**
 * Read the directory's entries and their per-file change signature.
 *
 * The signature is per file, not per directory: a directory's mtime moves only
 * when an entry is added, removed, or renamed, so an editor rewriting an
 * existing preset in place would be invisible to a directory-level signature.
 * @param root - the preset directory.
 * @returns the entries and the signature they currently produce.
 */
function scan(root) {
  let names
  try {
    names = readdirSync(root)
  } catch {
    // An absent directory is an empty roster, not an error.
    return { files: [], signature: '' }
  }
  const files = []
  for (const name of names) {
    const id = presetIdFromFile(name)
    if (id === null || !PRESET_ID.test(id)) continue
    const path = join(root, name)
    let stat
    try {
      stat = statSync(path)
    } catch {
      // The entry vanished between readdir and stat (a rename or a delete), or
      // it is unreadable. Either way it is not a preset file this snapshot can
      // offer; the next read rebuilds from whatever the directory holds then.
      continue
    }
    if (!stat.isFile()) continue
    files.push({ id, path, mtimeMs: stat.mtimeMs, size: stat.size })
  }
  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { files, signature: files.map(file => `${file.id}:${String(file.mtimeMs)}:${String(file.size)}`).join('|') }
}

/**
 * Create the store every reader shares: one synchronous snapshot of the preset
 * directory, rebuilt when any file's mtime or size moved.
 * @param root - the preset directory.
 * @returns roster and text readers over that snapshot.
 */
export function createPresetStore(root) {
  let cache = { signature: null, presets: [], byId: new Map() }

  function load() {
    const { files, signature } = scan(root)
    if (signature === cache.signature) return cache
    const presets = files.map(file => {
      try {
        return parsePreset(file.id, readFileSync(file.path, 'utf8'))
      } catch (error) {
        return { id: file.id, broken: error instanceof Error ? error.message : String(error) }
      }
    })
    cache = { signature, presets, byId: new Map(presets.map(preset => [preset.id, preset])) }
    return cache
  }

  return {
    /**
     * Whether an id currently names a usable preset: present in the directory
     * and not broken. The per-session selection resolves against this, so an
     * override whose preset vanished degrades to the default instead of to
     * nothing.
     * @param id - a preset id.
     * @returns true when the id is selectable right now.
     */
    has(id) {
      const preset = load().byId.get(id)
      return preset !== undefined && preset.broken === undefined
    },
    /**
     * The roster plus the requested active id, echoed back so the caller can
     * tell a stale selection from a live one.
     * @param active - the id the caller holds, or null.
     * @returns the rows and the active id.
     */
    roster(active) {
      const { presets } = load()
      return {
        presets: presets.map(preset => preset.broken === undefined
          ? {
            id: preset.id,
            name: preset.name,
            ...preset.description === undefined ? {} : { description: preset.description },
            ...preset.hint === undefined ? {} : { hint: preset.hint },
            ...preset.model === undefined ? {} : { model: preset.model },
          }
          : { id: preset.id, broken: preset.broken }),
        active: active ?? null,
      }
    },
    /**
     * The model spec one usable preset carries.
     * @param id - a preset id, or null.
     * @returns the spec, or undefined when the preset is absent, broken, or
     * names no model.
     */
    model(id) {
      if (id === null) return undefined
      const preset = load().byId.get(id)
      return preset === undefined || preset.broken !== undefined ? undefined : preset.model
    },
    /**
     * The composed prompt text for one session directory.
     * @param cwd - the session's working directory.
     * @param active - the id the settings hold, or null.
     * @returns the text, or null when no usable preset is selected — the caller
     * then falls back to the workspace file alone, which is today's behavior.
     */
    text(cwd, active) {
      const preset = active === null ? undefined : load().byId.get(active)
      const workspace = readWorkspaceFile(cwd)
      const usable = preset === undefined || preset.broken !== undefined ? null : preset.text
      if (usable === null) return workspace === '' ? null : workspace
      return workspace === '' ? usable : `${usable}\n\n${workspace}`
    },
  }
}
