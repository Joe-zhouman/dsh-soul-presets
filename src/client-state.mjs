/**
 * Everything the browser half can decide without a renderer: decoding the
 * roster the Host serves, mapping one row to the three labels the UI shows, and
 * deciding whether the stored selection still points at a usable preset.
 *
 * Kept free of React so the name/description/hint mapping is mechanically
 * assertable — the visibility of those three strings is the feature's stated
 * pain, and it should not depend on a browser to verify.
 * @module dsh-soul-presets/src/client-state
 */

/** The route the Host serves the roster on. */
export const ROSTER_ROUTE = '/plugins/soul-preset/roster'

/** The route that creates and deletes presets, and the one that reveals the directory. */
export const PRESETS_ROUTE = '/plugins/soul-preset/presets'
export const REVEAL_ROUTE = '/plugins/soul-preset/reveal'

/** The route that sets or clears one session's own preset selection. */
export const SELECT_ROUTE = '/plugins/soul-preset/select'

/**
 * The menu row id that means "stop overriding; follow the default again". Not a
 * preset id shape on purpose, so it can never collide with a roster row.
 */
export const FOLLOW_DEFAULT = '__follow_default__'

/**
 * Decode one roster response.
 * @param payload - the parsed JSON, of unknown shape.
 * @returns the rows, the active id, the override flag, and the directory path;
 * empty when malformed.
 */
export function decodeRoster(payload) {
  const source = payload !== null && typeof payload === 'object' ? payload : {}
  const rows = Array.isArray(source.presets) ? source.presets : []
  const presets = rows.flatMap(row => {
    if (row === null || typeof row !== 'object' || typeof row.id !== 'string') return []
    const model = row.model !== null && typeof row.model === 'object'
      && typeof row.model.provider === 'string' && typeof row.model.model === 'string'
      ? {
        provider: row.model.provider,
        model: row.model.model,
        ...typeof row.model.reasoningEffort === 'string' ? { reasoningEffort: row.model.reasoningEffort } : {},
      }
      : undefined
    return [{
      id: row.id,
      ...typeof row.name === 'string' ? { name: row.name } : {},
      ...typeof row.description === 'string' ? { description: row.description } : {},
      ...typeof row.hint === 'string' ? { hint: row.hint } : {},
      ...model === undefined ? {} : { model },
      ...typeof row.broken === 'string' ? { broken: row.broken } : {},
    }]
  })
  return {
    presets,
    active: typeof source.active === 'string' && source.active !== '' ? source.active : null,
    overridden: source.overridden === true,
    root: typeof source.root === 'string' ? source.root : '',
  }
}

/**
 * The four strings one row contributes to the UI.
 * @param row - one roster row.
 * @returns the display name (falling back to the id), description, hint, and
 * the `provider/model[ (effort)]` label of the row's default model (empty when
 * it names none).
 */
export function presetLabels(row) {
  const spec = row.model
  return {
    name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id,
    description: typeof row.description === 'string' ? row.description : '',
    hint: typeof row.hint === 'string' ? row.hint : '',
    model: spec === undefined
      ? ''
      : `${spec.provider}/${spec.model}${spec.reasoningEffort === undefined ? '' : ` (${spec.reasoningEffort})`}`,
  }
}

/**
 * The usable row the stored selection points at.
 * @param roster - a decoded roster.
 * @returns the row, or null when nothing is selected or the selection is stale
 * or broken — the UI shows "已失效" for that case.
 */
export function activeRow(roster) {
  if (roster.active === null) return null
  const row = roster.presets.find(candidate => candidate.id === roster.active)
  return row === undefined || row.broken !== undefined ? null : row
}
