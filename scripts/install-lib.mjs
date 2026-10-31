/**
 * Pure helpers behind `scripts/install.mjs` (the one-click installer).
 *
 * The installer edits a profile's `cordis.patch.yml` as text instead of
 * re-serializing YAML: that file is the user's own layer — comments, blank
 * lines, ordering and layout included — and this package cannot take a YAML
 * dependency on an install machine (a bare checkout has only `smol-toml`, and
 * a git install has no build step). Every transform here is conservative:
 * insert the `preset-qa` declaration row, add `presets: true` to its
 * `soul-prompt` plugin, and rewrite a `file://` name whose target is gone.
 * A shape this module does not understand yields a `manual` reason and the
 * text is left byte-identical, because a half-written patch stops the profile
 * from booting.
 */

import { fileURLToPath, pathToFileURL } from 'node:url'

/** Loader entry id of the preset row that carries the system prompt. */
export const ROW_ID = 'preset-qa'
/** Plugin entry id inside that row which asks the harness for the preset text. */
export const SOUL_PROMPT_ID = 'soul-prompt'

/**
 * Render an absolute path as the `file://` URL a preset row's `name` needs.
 * `file:///C:/…` on Windows, `file:///home/…` elsewhere; characters that would
 * confuse YAML or the ESM loader (spaces and friends) are percent-encoded.
 * @param {string} absolutePath - Path on this machine.
 * @returns {string} URL written into the patch and compared against it later.
 */
export function toFileUrl(absolutePath) {
  return pathToFileURL(absolutePath).href
}

/**
 * Decode the local path of a `file:` URL, or undefined when it is not one.
 * @param {string} value - Field value from a preset row.
 * @returns {string | undefined} Local path, best effort.
 */
export function fromFileUrl(value) {
  if (!value.startsWith('file:')) return undefined
  try {
    return fileURLToPath(value)
  } catch {
    return undefined
  }
}

/**
 * Build the declaration row the installer appends, from `deploy/preset-qa.row.yml`.
 * The template's comment header is documentation for a human reader and is
 * dropped; its placeholder soul-prompt URL is replaced with this machine's.
 * @param {string} templateText - Contents of `deploy/preset-qa.row.yml`.
 * @param {string} fileUrl - URL of the copied `soul-prompt.mjs`.
 * @returns {string[]} Row lines, no trailing newline.
 */
export function buildPresetRow(templateText, fileUrl) {
  const lines = templateText.replace(/\r\n/g, '\n').split('\n')
  const first = lines.findIndex(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
  if (first < 0) throw new Error('preset row template is empty')
  const body = lines.slice(first).join('\n').trimEnd()
  if (!new RegExp(`^\\s*-\\s+id:\\s*${ROW_ID}\\s*$`, 'mu').test(body)) {
    throw new Error(`preset row template has no "id: ${ROW_ID}" row`)
  }
  const withUrl = body.replace(/file:\/\/\/\S*soul-prompt\.mjs/u, () => fileUrl)
  if (!withUrl.includes(fileUrl)) throw new Error('preset row template has no soul-prompt.mjs placeholder')
  return withUrl.split('\n')
}

/**
 * Inspect a profile patch as the installer and `--check` need to see it.
 * @param {string} text - Contents of `cordis.patch.yml`.
 * @param {{ fileExists?: (path: string) => boolean }} [options] - Used to tell a
 *   stale soul-prompt path from one that still resolves.
 * @returns {{
 *   present: boolean, duplicates: number, soulPrompt: boolean, presetsTrue: boolean,
 *   name?: string, nameFile?: string, nameExists?: boolean, ok: boolean, problem?: string
 * }} State, with `problem` set whenever `ok` is false.
 */
export function inspectProfilePatch(text, options = {}) {
  const fileExists = options.fileExists ?? (() => false)
  const { lines } = splitLines(text)
  const state = {
    present: false,
    duplicates: 0,
    soulPrompt: false,
    presetsTrue: false,
    name: undefined,
    nameFile: undefined,
    nameExists: undefined,
    ok: false,
    problem: undefined,
  }
  state.duplicates = countRows(lines)
  if (state.duplicates === 0) {
    state.problem = `补丁里没有 ${ROW_ID} 声明行`
    return state
  }
  state.present = true
  if (state.duplicates > 1) {
    state.problem = `补丁里有 ${state.duplicates} 个 ${ROW_ID} 声明行，请只留一个`
    return state
  }
  const row = locateItem(lines, ROW_ID)
  const soul = row === undefined ? undefined : locateItem(lines, SOUL_PROMPT_ID, row.start + 1, row.end)
  if (soul === undefined) {
    state.problem = `${ROW_ID} 行里没有 id: ${SOUL_PROMPT_ID} 的插件行`
    return state
  }
  state.soulPrompt = true
  const nameLine = findKey(lines, soul.start, soul.end, 'name')
  if (nameLine === undefined) {
    state.problem = `${SOUL_PROMPT_ID} 行没有 name`
    return state
  }
  state.name = unquote(nameLine.value)
  state.nameFile = fromFileUrl(state.name)
  if (state.nameFile !== undefined) state.nameExists = fileExists(state.nameFile)
  const presetsLine = findKey(lines, soul.start, soul.end, 'presets')
  state.presetsTrue = presetsLine !== undefined && unquote(presetsLine.value) === 'true'
  if (state.nameFile === undefined) {
    state.problem = state.name.startsWith('file:')
      ? `${SOUL_PROMPT_ID} 的 name 在本机解不出路径：${state.name}`
      : `${SOUL_PROMPT_ID} 的 name 不是 file:// URL：${state.name}`
  } else if (!state.presetsTrue) {
    state.problem = `${SOUL_PROMPT_ID} 的 config 里没有 presets: true`
  } else {
    state.ok = true
  }
  return state
}

/**
 * Apply the installer's edits to a profile patch.
 *
 * Four outcomes, in order: the row already there and complete (no change); the
 * row absent, so it is appended (or the profile template's bare `[]` is
 * replaced); the row present but incomplete, so `presets: true` and a dead
 * `name` are fixed in place; a shape this module declines to edit, reported as
 * `manual` with the text returned unchanged.
 * @param {string} text - Contents of `cordis.patch.yml`.
 * @param {{
 *   fileUrl: string, template: string, fileExists?: (path: string) => boolean
 * }} options - `template` is `deploy/preset-qa.row.yml`, needed only when the
 *   row must be added; `fileExists` decides whether an existing `file://` name
 *   still resolves.
 * @returns {{
 *   text: string, changed: boolean,
 *   actions: {kind: string, detail: string}[], manual?: string
 * }} New text (the input itself when unchanged) and what was done.
 */
export function patchProfilePatch(text, options) {
  const { fileUrl, template } = options
  const fileExists = options.fileExists ?? (() => false)
  const { eol, lines } = splitLines(text)

  if (countRows(lines) === 0) {
    const rowLines = buildPresetRow(template, fileUrl)
    const emptyIndex = findBareEmptyArray(lines)
    if (emptyIndex === undefined) {
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      lines.push('', ...rowLines, '')
    } else {
      lines.splice(emptyIndex, 1, ...rowLines)
      if (lines[lines.length - 1] !== '') lines.push('')
    }
    const patched = lines.join(eol)
    return confirm(patched, text, fileExists, [{
      kind: emptyIndex === undefined ? 'appended-row' : 'replaced-empty',
      detail: emptyIndex === undefined
        ? '在补丁末尾追加了 preset-qa 声明行'
        : '把补丁里的空数组 [] 换成了 preset-qa 声明行',
    }])
  }

  const row = locateItem(lines, ROW_ID)
  if (row === undefined) {
    return { text, changed: false, actions: [], manual: `找不到可编辑的 ${ROW_ID} 声明行` }
  }
  if (countRows(lines) > 1) {
    return { text, changed: false, actions: [], manual: `补丁里有 ${countRows(lines)} 个 ${ROW_ID} 声明行，请只留一个` }
  }
  const soul = locateItem(lines, SOUL_PROMPT_ID, row.start + 1, row.end)
  if (soul === undefined) {
    return {
      text,
      changed: false,
      actions: [],
      manual: `${ROW_ID} 行里没有 id: ${SOUL_PROMPT_ID} 的插件行，请手动核对`,
    }
  }

  const actions = []
  let changed = false

  const nameLine = findKey(lines, soul.start, soul.end, 'name')
  if (nameLine === undefined) {
    return { text, changed: false, actions: [], manual: `${SOUL_PROMPT_ID} 行没有 name，请手动核对` }
  }
  const name = unquote(nameLine.value)
  if (!name.startsWith('file:')) {
    return {
      text,
      changed: false,
      actions: [],
      manual: `${SOUL_PROMPT_ID} 的 name 不是 file:// URL（当前为 ${name}），请手动改成 bundled soul-prompt.mjs 的 file:// 地址`,
    }
  }
  const nameFile = fromFileUrl(name)
  if (nameFile === undefined) {
    // A file: URL this platform cannot decode — a POSIX URL on Windows, for
    // example — is as unusable as a missing file, so it is repointed.
    lines[nameLine.index] = `${' '.repeat(nameLine.indent)}name: ${fileUrl}`
    changed = true
    actions.push({ kind: 'fixed-name', detail: `name 的 file:// URL 在本机解不出路径，已改为 ${fileUrl}` })
  } else if (!fileExists(nameFile)) {
    lines[nameLine.index] = `${' '.repeat(nameLine.indent)}name: ${fileUrl}`
    changed = true
    actions.push({ kind: 'fixed-name', detail: `name 指向的文件不存在，已改为 ${fileUrl}` })
  } else {
    actions.push({ kind: 'kept-name', detail: `name 仍指向 ${name}` })
  }

  const presetsLine = findKey(lines, soul.start, soul.end, 'presets')
  if (presetsLine !== undefined) {
    if (unquote(presetsLine.value) !== 'true') {
      lines[presetsLine.index] = `${' '.repeat(presetsLine.indent)}presets: true`
      changed = true
      actions.push({ kind: 'enabled-presets', detail: '把 presets 改成了 true' })
    } else {
      actions.push({ kind: 'kept-presets', detail: 'presets: true 已存在' })
    }
  } else {
    const configLine = findKey(lines, soul.start, soul.end, 'config')
    if (configLine === undefined) {
      return {
        text,
        changed: false,
        actions: [],
        manual: `${SOUL_PROMPT_ID} 行没有 config 块，请手动添加 presets: true`,
      }
    }
    if (unquote(configLine.value) !== '') {
      return {
        text,
        changed: false,
        actions: [],
        manual: `${SOUL_PROMPT_ID} 的 config 写在一行里（${configLine.value.trim()}），请改成块写法并加上 presets: true 后重试`,
      }
    }
    const indent = childIndent(lines, configLine.index + 1, soul.end, configLine.indent)
    lines.splice(configLine.index + 1, 0, `${' '.repeat(indent)}presets: true`)
    changed = true
    actions.push({ kind: 'added-presets', detail: '在 config 块第一行插入了 presets: true' })
  }

  if (!changed) return { text, changed: false, actions }
  return confirm(lines.join(eol), text, fileExists, actions)
}

/**
 * Re-read the patched text and refuse to return a patch that would not boot.
 * @param {string} patched - Candidate text.
 * @param {string} original - Input text, returned when the candidate fails.
 * @param {(path: string) => boolean} fileExists - Name-resolution probe.
 * @param {{kind: string, detail: string}[]} actions - Edits to report on success.
 * @returns {{text: string, changed: boolean, actions: {kind: string, detail: string}[], manual?: string}}
 */
function confirm(patched, original, fileExists, actions) {
  const state = inspectProfilePatch(patched, { fileExists })
  if (!state.ok) {
    return {
      text: original,
      changed: false,
      actions: [],
      manual: `改完自检不通过（${state.problem}），补丁未改动`,
    }
  }
  return { text: patched, changed: true, actions }
}

/**
 * Split text into lines, remembering which newline it used so an edited file
 * keeps its line endings.
 * @param {string} text - File contents.
 * @returns {{ eol: string, lines: string[] }} Lines without CR, and the original EOL.
 */
function splitLines(text) {
  return {
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    lines: text.replace(/\r\n/g, '\n').split('\n'),
  }
}

/**
 * Count declaration rows with this id, at any indentation.
 * @param {string[]} lines - Patch lines.
 * @returns {number} Occurrences.
 */
function countRows(lines) {
  const pattern = new RegExp(`^\\s*-\\s+id:\\s*${ROW_ID}\\s*$`, 'u')
  return lines.filter(line => pattern.test(line)).length
}

/**
 * Locate one `- id: <id>` list item and its extent.
 *
 * The extent ends at the next list item indented no deeper than this one, at
 * the first column-0 line, or at the range's end — enough to treat an item's
 * nested keys and nested lists as one block without parsing YAML.
 * @param {string[]} lines - Patch lines.
 * @param {string} id - Entry id to find.
 * @param {number} [from] - First line to inspect.
 * @param {number} [to] - Line to stop before.
 * @returns {{ start: number, end: number, indent: number } | undefined} Block.
 */
function locateItem(lines, id, from = 0, to = lines.length) {
  const pattern = new RegExp(`^(\\s*)-\\s+id:\\s*${id}\\s*$`, 'u')
  for (let index = from; index < to; index++) {
    const match = pattern.exec(lines[index])
    if (match === null) continue
    const indent = match[1].length
    let end = to
    for (let next = index + 1; next < to; next++) {
      const line = lines[next]
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue
      const item = /^(\s*)-\s/u.exec(line)
      if (item !== null && item[1].length <= indent) {
        end = next
        break
      }
      if (/^\S/u.test(line)) {
        end = next
        break
      }
    }
    return { start: index, end, indent }
  }
  return undefined
}

/**
 * Find a `key:` line inside a block and read its value.
 * @param {string[]} lines - Patch lines.
 * @param {number} from - First line to inspect.
 * @param {number} to - Line to stop before.
 * @param {string} key - Key to find.
 * @returns {{ index: number, indent: number, value: string } | undefined} Line.
 */
function findKey(lines, from, to, key) {
  const pattern = new RegExp(`^(\\s*)${key}:[ \\t]*(.*?)[ \\t]*$`, 'u')
  for (let index = from; index < to; index++) {
    const match = pattern.exec(lines[index])
    if (match === null) continue
    return { index, indent: match[1].length, value: match[2] }
  }
  return undefined
}

/**
 * Strip quotes from a YAML scalar the way the installer compares values.
 * @param {string} value - Captured scalar.
 * @returns {string} Scalar without surrounding quotes.
 */
function unquote(value) {
  const trimmed = value.trim()
  if (trimmed === '') return trimmed
  const quote = trimmed[0]
  if ((quote === "'" || quote === '"') && trimmed[trimmed.length - 1] === quote) {
    return quote === "'" ? trimmed.slice(1, -1).replaceAll("''", "'") : trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * The indent to use for a new first child of a block-style mapping.
 * @param {string[]} lines - Patch lines.
 * @param {number} from - First line after the `key:` line.
 * @param {number} to - Block end.
 * @param {number} parentIndent - Indent of the `key:` line.
 * @returns {number} Indent of the existing first child, or two more than the parent.
 */
function childIndent(lines, from, to, parentIndent) {
  for (let index = from; index < to; index++) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = /^\s*/u.exec(line)[0].length
    return indent > parentIndent ? indent : parentIndent + 2
  }
  return parentIndent + 2
}

/**
 * Index of a line that is the profile template's bare empty array, if the file
 * holds nothing else (`[]` is the whole document, comments aside).
 * @param {string[]} lines - Patch lines.
 * @returns {number | undefined} That line's index.
 */
function findBareEmptyArray(lines) {
  const content = lines
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
  if (content.length !== 1 || content[0] !== '[]') return undefined
  return lines.findIndex(line => line.trim() === '[]')
}
