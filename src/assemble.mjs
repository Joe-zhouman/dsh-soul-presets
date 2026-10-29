/**
 * Assembly of one preset's model-visible prompt text. Pure: no fs, no clock, no
 * imports. The example block's exact bytes are the user's specification — the
 * separator on its own line, every tag on its own line, contents not indented —
 * so this module is the one place that layout is defined.
 * @module dsh-soul-presets/src/assemble
 */

/** Byte ceiling for one assembled preset, matching the prompt row's own file cap. */
export const MAX_ASSEMBLED_BYTES = 65536

/**
 * Whether one assembled text fits the byte ceiling. Counted in UTF-8 bytes, not
 * characters: a Chinese prompt hits it about three times sooner.
 * @param text - the assembled prompt text.
 * @returns true when the text fits.
 */
export function withinCap(text) {
  return Buffer.byteLength(text, 'utf8') <= MAX_ASSEMBLED_BYTES
}

/**
 * Render the example block exactly as specified.
 * @param user - the user half, already trimmed.
 * @param assistant - the assistant half, already trimmed.
 * @returns the block, starting at the separator line.
 */
function renderExample(user, assistant) {
  return ['===', '<example>', '<user>', user, '</user>', '<assistant>', assistant, '</assistant>', '</example>'].join('\n')
}

/**
 * Assemble the complete text for one preset. The example block appears only when
 * both halves carry text, so a preset that supplies one half renders the system
 * prompt alone rather than a half-built example.
 * @param prompt - the preset's three prompt blocks.
 * @returns the assembled text, or `''` when every block is empty.
 */
export function assemblePrompt(prompt) {
  const system = String(prompt.system ?? '').trim()
  const user = String(prompt.user ?? '').trim()
  const assistant = String(prompt.assistant ?? '').trim()
  const parts = system === '' ? [] : [system]
  if (user !== '' && assistant !== '') parts.push(renderExample(user, assistant))
  return parts.join('\n')
}
