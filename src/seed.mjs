/**
 * First-run seeding of the bundled example presets.
 *
 * A fresh install presents an empty directory, and an empty switch menu teaches
 * nothing about what a preset is — so the package ships a `presets/` directory
 * of example tool prompts, and the Host copies them into `$DSH_HOME/
 * soul-presets` once that directory holds no `.toml` of its own. The rule is
 * deliberately "no .toml present", not "directory absent": an upgrade onto a
 * deployment whose plugin already ran (and created an empty directory) seeds
 * too. The flip side — wiping every preset and restarting brings the examples
 * back — is the documented cost; keep one own file to stay unseeded.
 *
 * Seeding never overwrites (a same-named file cannot exist when the rule held,
 * but the copy stays guarded anyway) and never deletes; the files land as
 * ordinary user-owned presets, editable and removable through the same routes.
 * @module dsh-soul-presets/src/seed
 */
import { copyFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package's bundled example presets, relative to this module at runtime:
 * `src/` in the working copy and the repository checkout, `lib/` in a built or
 * installed package — both sit one level below the package root.
 * @returns the bundled presets directory.
 */
export function bundledPresetsDir() {
  return join(import.meta.dirname, '..', 'presets')
}

/**
 * Copy the bundled presets into the user's directory when it holds no `.toml`.
 * @param deps - the user's preset root, the bundled directory (injectable for
 * tests), `read`/`copy` implementations, and a logger.
 * @returns how many files were seeded.
 */
export function seedPresets({ root, bundle = bundledPresetsDir(), read = readdirSync, copy = copyFileSync, log = () => {} }) {
  let bundled
  try {
    bundled = read(bundle)
  } catch {
    // A package without the bundled directory (a source checkout trimmed of
    // data) has nothing to offer; an empty roster is then the honest state.
    return 0
  }
  let existing
  try {
    existing = read(root)
  } catch {
    // The caller creates the root before seeding; an unreadable root is the
    // create route's failure to report, not this pass's.
    return 0
  }
  if (existing.some(name => name.endsWith('.toml'))) return 0
  let seeded = 0
  for (const name of bundled) {
    if (!name.endsWith('.toml')) continue
    try {
      copy(join(bundle, name), join(root, name))
      seeded += 1
    } catch (error) {
      log(`soul-presets: seeding "${name}" failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (seeded > 0) log(`soul-presets: seeded ${seeded} bundled example preset(s) into the empty directory`)
  return seeded
}
