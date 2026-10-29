/**
 * The browser half's stylesheet.
 *
 * It is one `<style>` tag injected at apply time rather than a CSS module
 * import: this package builds with its own tsdown config, which has no
 * stylesheet pipeline, while the module system already owns injected tags —
 * `data-plugin` is the disposal key (`removeOwnedStyles`) and `data-plugin-css`
 * names the sheet, the same convention the shell's own client bundles use.
 *
 * Class names carry a `dsh-sp-` prefix because they live in the page's global
 * stylesheet, unlike the hashed classes of a bundled module. The chip's
 * geometry copies the mode selector's trigger (`PermissionSelect.module.css`
 * `.trigger`) rather than approximating it, since the two sit in one composer
 * row; every other value is a `--dsw-*` token so both themes are covered.
 * @module dsh-soul-presets/src/client-styles
 */

/** Bundle id; also the `data-plugin` value disposal removes tags by. */
export const STYLE_PLUGIN_ID = 'dsh-soul-presets'

/** Names this sheet inside the page, for the duplicate guard and HMR bookkeeping. */
export const STYLE_TAG_ID = `${STYLE_PLUGIN_ID}/client-styles.css`

export const CSS_TEXT = `
/* Composer chip. font-family is deliberately unset: the sibling mode trigger
   does not set it either, so both keep whatever the shell gives a button. */
.dsh-sp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: 24px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.dsh-sp-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-sp-chip:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.dsh-sp-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* inline-flex, not inline: an inline glyph reserves baseline descent under the
   svg and floats off-center in the 28px trigger. */
.dsh-sp-chevron {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}

.dsh-sp-chevron-open {
  transform: rotate(180deg);
}

/* Switch-list row body, rendered inside the shared menu card: the name on the
   first line, then the description and hint (or the reason it is unusable).
   The card, row fill, selected check, and the capped scrolling body all come
   from the primitive, which is the same menu the mode selector opens. */
.dsh-sp-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dsh-sp-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-sp-row-note {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-sp-row-part {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-sp-row-broken {
  color: var(--dsw-alias-state-error-primary);
}

/* The 「跟随默认」 row sits above the roster once a session carries its own
   override. Muted like a caption: it is an action, not a preset to pick. */
.dsh-sp-row-follow .dsh-sp-row-name {
  color: var(--dsw-alias-label-tertiary);
}

/* The switch list scrolls well before the shared card's viewport-fit cap. That
   native limit is near the full screen, so a long roster stands fully open and
   covers the page; this class narrows the card and the primitive's .viewport
   keeps scrolling it (its overflow rule keys off the card, not the class).
   min() keeps the viewport-fit expression as the lower bound, so a window
   shorter than the cap still fits the card. Appended after the shell's own
   sheet, so the tie on class specificity with .scrollable goes to this rule. */
.dsh-sp-menu-cap {
  max-height: min(320px, calc(100vh - 12px - max(12px, var(--dsh-frame-top-clearance, 12px))));
}

/* The line above the composer card: the current preset's name and hint, or the
   notice that the selection no longer resolves. */
[data-dsh-soul-preset-dock] {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0 16px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-soul-preset-line] {
  display: flex;
  align-items: baseline;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
}

[data-dsh-soul-preset-line] > span,
[data-dsh-soul-preset-stale] {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A failed action or a failed roster read, in either the dock or the page. */
[data-dsh-soul-preset-dock] [data-dsh-soul-preset-error],
[data-dsh-soul-preset-settings] [data-dsh-soul-preset-error] {
  max-width: 100%;
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}

/* Management page body. It carries no heading of its own: the Settings shell
   renders the registration's label, as it does for every other section. */
[data-dsh-soul-preset-settings] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}

[data-dsh-soul-preset-settings] p {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-soul-preset-root] {
  overflow-wrap: anywhere;
}

[data-dsh-soul-preset-settings] ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

[data-dsh-soul-preset-row] {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
}

[data-dsh-soul-preset-row]:hover {
  background: var(--dsw-alias-bg-layer-1);
}

[data-dsh-soul-preset-row-text] {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* The name is the row's switch action, so it reads as the row title rather than
   as a second capsule beside the row's buttons. */
[data-dsh-soul-preset-select] {
  align-self: flex-start;
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

[data-dsh-soul-preset-select]:hover:not(:disabled) {
  text-decoration: underline;
}

[data-dsh-soul-preset-select]:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

[data-dsh-soul-preset-row-desc],
[data-dsh-soul-preset-row-model],
[data-dsh-soul-preset-broken] {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-soul-preset-broken] {
  color: var(--dsw-alias-state-error-primary);
}

[data-dsh-soul-preset-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Destructive row action: the shared outline capsule, error-tinted. Appended
   after the shell's own sheet, so the tie on class specificity goes to it. */
.dsh-sp-danger {
  color: var(--dsw-alias-state-error-primary);
}
`

/**
 * Put the sheet in the page, unless it is already there.
 *
 * The duplicate guard covers a re-apply that did not go through disposal (an
 * HMR replacement removes the tag before the new instance runs, but a second
 * `apply` on the live plugin would not).
 * @returns the disposer that removes the tag this call owns.
 */
export function installStyles() {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
  if (existing !== null) return () => { existing.remove() }
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS_TEXT
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
