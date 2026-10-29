/**
 * The `soul-preset` plugin configuration: the deployment's global default
 * preset. Per-session overrides live in the selection store, not here.
 *
 * The default is this plugin entry's Config rather than a settings
 * namespace. `active` is volatile, so the settings form projects it, the
 * active profile's patch persists a change, and Loader commits the new id
 * into the running reference without remounting the plugin — which is what
 * lets the preset row read the current default at its next assembly.
 * @module dsh-soul-presets/src/settings
 */
import z from '@deepseek-ai/schemastery'
import { PRESET_ID } from './presets.mjs'

/** Profile entry id the settings form and the browser half address. */
export const SOUL_PRESET_ENTRY = 'local-soul-presets'

/**
 * The id rule with an empty value allowed, derived from the one source: the
 * selection becomes a file name, so this is the same containment boundary the
 * routes check.
 */
const ACTIVE_ID = new RegExp(`^(?:${PRESET_ID.source})?$`, PRESET_ID.flags)

/**
 * An empty string means "no preset selected"; anything else must be a preset
 * id, because the value is used to look up a file name.
 */
export const SoulPresetSettings = z.object({
  active: z.string().pattern(ACTIVE_ID).default('').volatile(),
})
