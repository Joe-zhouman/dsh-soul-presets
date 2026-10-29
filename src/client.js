/**
 * The React half of the browser bundle: three components and the wiring call.
 * Every React-free behavior — the roster store, the seat, the dictionary, the
 * registrations — lives in `./client-seats.mjs`, which is what makes the
 * registration shape testable without React resolvable.
 *
 * The switch list and the row actions are the shell's own primitives, fetched
 * from the module table: `Menu` is the card the mode selector opens, so the two
 * dropdowns in one composer row cannot drift apart, and it is what caps a long
 * list and scrolls it. `./client-styles.mjs` carries the rest of the styling.
 *
 * Each component receives the seat's fields as props plus the framework-seated
 * `t` (from the registration's `locale:`); it must not expect a `t` on the seat.
 * @module dsh-soul-presets/src/client
 */
import * as React from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSeats } from './client-seats.mjs'
import { installStyles } from './client-styles.mjs'
import { FOLLOW_DEFAULT, activeRow, presetLabels } from './client-state.mjs'

export { inject } from './client-seats.mjs'

/**
 * Subscribe a component to one external store.
 * @param store - the snapshot store.
 * @returns the current snapshot.
 */
function useStore(store) {
  return React.useSyncExternalStore(
    React.useCallback(listener => store.subscribe(listener), [store]),
    React.useCallback(() => store.getSnapshot(), [store]),
  )
}

/**
 * Read the agent preset selected for this session-scoped composer.
 * @param props - the slot's session props.
 * @returns whether this session is in qa mode.
 */
function useQaMode({ sessionId, useSessions }) {
  return useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === 'qa')
}

/**
 * The current preset as one line, or the stale-selection notice. A selection
 * that comes from the deployment default rather than the session's own choice
 * is marked as such, so "默认" reads as "inherited", not "chosen here".
 * @param props - the injected `t` and the decoded roster.
 * @returns the line, the notice, or null when nothing is selected.
 */
function SelectionHint({ t, roster }) {
  const current = activeRow(roster)
  if (roster.active !== null && current === null) {
    return React.createElement('div', { 'data-dsh-soul-preset-stale': '' }, t('stale'))
  }
  if (current === null) return null
  const labels = presetLabels(current)
  const label = roster.overridden ? t('currentLabel') : `${t('currentLabel')}（${t('defaultMark')}）`
  return React.createElement('div', { 'data-dsh-soul-preset-line': '' },
    React.createElement('span', null, `${label}：${labels.name}`),
    labels.hint === '' ? null : React.createElement('span', null, ` · ${labels.hint}`),
  )
}

/**
 * One switch-list row's body: the name, then whatever else identifies the
 * preset — its description and hint, or the reason it cannot be selected.
 * @param t - the seat's dictionary.
 * @param row - one roster row.
 * @returns the label node the menu row renders.
 */
function presetRowLabel(t, row) {
  const labels = presetLabels(row)
  const parts = row.broken === undefined
    ? [
      labels.description === '' ? null : React.createElement('span', {
        key: 'description', className: 'dsh-sp-row-part', 'data-dsh-soul-preset-description': '',
      }, labels.description),
      labels.hint === '' ? null : React.createElement('span', {
        key: 'hint', className: 'dsh-sp-row-part', 'data-dsh-soul-preset-hint': '',
      }, labels.hint),
      labels.model === '' ? null : React.createElement('span', {
        key: 'model', className: 'dsh-sp-row-part', 'data-dsh-soul-preset-model': '',
      }, `${t('modelPrefix')} ${labels.model}`),
    ].filter(part => part !== null)
    : [React.createElement('span', {
      key: 'broken', className: 'dsh-sp-row-part dsh-sp-row-broken', 'data-dsh-soul-preset-broken': '',
    }, `${t('brokenPrefix')}：${row.broken}`)]
  const note = parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))
  return React.createElement('span', { className: 'dsh-sp-row' },
    React.createElement('span', {
      className: 'dsh-sp-row-name', 'data-dsh-soul-preset-name': '',
    }, labels.name),
    note.length === 0 ? null : React.createElement('span', { className: 'dsh-sp-row-note' }, note),
  )
}

/**
 * The composer chip and, while open, the switch list. Selecting a row sets THIS
 * session's own preset; a session that has done so also sees the 「跟随默认」
 * row, which clears the override and returns it to the deployment default.
 * @param props - seat fields plus `t` and the session-scoped slot props.
 * @returns the chip element.
 */
function PresetChip(props) {
  const { t, roster, selectSession, resetSession, refresh } = props
  const qa = useQaMode(props)
  const sessionId = props.sessionId
  const [open, setOpen] = React.useState(false)
  const snapshot = useStore(roster)
  const active = snapshot.roster.active
  const current = activeRow(snapshot.roster)
  const label = active !== null && current === null
    ? t('chipStale')
    : current === null
      ? t('chipEmpty')
      : snapshot.roster.overridden ? presetLabels(current).name : `${t('defaultMark')}·${presetLabels(current).name}`

  React.useEffect(() => { if (qa) void refresh(sessionId) }, [qa, refresh, sessionId])

  const items = snapshot.roster.presets.length === 0
    ? [{ type: 'label', id: 'empty', text: t('empty') }]
    : [
      ...snapshot.roster.overridden
        ? [{
          id: FOLLOW_DEFAULT,
          label: React.createElement('span', { className: 'dsh-sp-row dsh-sp-row-follow', 'data-dsh-soul-preset-follow': '' },
            React.createElement('span', { className: 'dsh-sp-row-name' }, t('followDefault'))),
        }]
        : [],
      ...snapshot.roster.presets.map(row => ({
        id: row.id,
        disabled: row.broken !== undefined,
        label: presetRowLabel(t, row),
      })),
    ]

  if (!qa) return null
  return React.createElement(Menu, {
    open,
    items,
    selectedId: active ?? undefined,
    onSelect: id => {
      setOpen(false)
      void (id === FOLLOW_DEFAULT ? resetSession(sessionId) : selectSession(sessionId, id))
    },
    onClose: () => { setOpen(false) },
    // Upward from the composer and out of its clipping card, which is how the
    // mode selector next to it opens.
    side: 'top',
    portal: true,
    // The shared card scrolls only at its viewport-fit cap (near the full
    // screen), so a long roster stands fully open and covers the page. This is
    // the primitive's one style hook that reaches a portaled list: the class
    // narrows the card and its own .viewport keeps scrolling the rows.
    listClassName: 'dsh-sp-menu-cap',
    anchor: React.createElement('button', {
      type: 'button',
      className: 'dsh-sp-chip',
      'data-dsh-soul-preset-chip': '',
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      title: t('switchTitle'),
      onClick: () => { setOpen(value => !value); if (!open) void refresh(sessionId) },
    },
      React.createElement('span', { className: 'dsh-sp-chip-label' }, label),
      React.createElement('span', {
        className: open ? 'dsh-sp-chevron dsh-sp-chevron-open' : 'dsh-sp-chevron',
        'aria-hidden': true,
      }, React.createElement(IconChevronDownOutlineRegular)),
    ),
  })
}

/**
 * The name-and-hint line above the composer card.
 * @param props - seat fields plus `t` and the session-scoped slot props.
 * @returns the dock line.
 */
function PresetDock(props) {
  const { t, roster, refresh } = props
  const qa = useQaMode(props)
  const snapshot = useStore(roster)
  React.useEffect(() => { if (qa) void refresh(props.sessionId) }, [qa, refresh, props.sessionId])
  const notice = snapshot.actionError ?? snapshot.error
  if (!qa) return null
  return React.createElement('div', { 'data-dsh-soul-preset-dock': '' },
    React.createElement(SelectionHint, { t, roster: snapshot.roster }),
    notice === null
      ? null
      : React.createElement('div', { 'data-dsh-soul-preset-error': '' }, notice),
  )
}

/**
 * The management section: list, create, delete with confirmation, reveal. This
 * surface reads the deployment's DEFAULT view and its select action sets the
 * default — the per-session choice lives in the composer chip. The section
 * carries no heading — the Settings shell renders the registration's label in
 * its navigation, as it does for every other section.
 * @param props - seat fields plus `t`.
 * @returns the settings section element.
 */
function ManagementSection(props) {
  const { t, defaults, select, create, remove, reveal } = props
  const snapshot = useStore(defaults)
  const [pending, setPending] = React.useState(null)
  React.useEffect(() => { void defaults.refresh() }, [defaults])
  const notice = snapshot.actionError ?? snapshot.error

  const rows = snapshot.roster.presets.map(row => {
    const labels = presetLabels(row)
    const actions = pending === row.id
      ? [
        React.createElement(Button, {
          key: 'confirm', variant: 'outline', size: 'sm', className: 'dsh-sp-danger',
          'data-dsh-soul-preset-confirm': '',
          onClick: () => { setPending(null); void remove(row.id) },
        }, t('confirmRemove')),
        React.createElement(Button, {
          key: 'cancel', variant: 'outline', size: 'sm',
          'data-dsh-soul-preset-cancel': '',
          onClick: () => { setPending(null) },
        }, t('cancel')),
      ]
      : [React.createElement(Button, {
        key: 'remove', variant: 'outline', size: 'sm', className: 'dsh-sp-danger',
        'data-dsh-soul-preset-remove': '',
        onClick: () => { setPending(row.id) },
      }, t('remove'))]
    return React.createElement('li', { key: row.id, 'data-dsh-soul-preset-row': row.id },
      React.createElement('span', { 'data-dsh-soul-preset-row-text': '' },
        React.createElement('button', {
          type: 'button',
          'data-dsh-soul-preset-select': '',
          'aria-current': row.id === snapshot.roster.active ? 'true' : undefined,
          disabled: row.broken !== undefined,
          onClick: () => { void select(row.id) },
        }, labels.name),
        labels.description === ''
          ? null
          : React.createElement('span', { 'data-dsh-soul-preset-row-desc': '' }, labels.description),
        labels.model === ''
          ? null
          : React.createElement('span', { 'data-dsh-soul-preset-row-model': '' }, `${t('modelPrefix')}：${labels.model}`),
        row.broken === undefined
          ? null
          : React.createElement('span', { 'data-dsh-soul-preset-broken': '' }, `${t('brokenPrefix')}：${row.broken}`),
      ),
      React.createElement('span', { 'data-dsh-soul-preset-actions': '' }, ...actions),
    )
  })

  return React.createElement('section', { 'data-dsh-soul-preset-settings': '' },
    React.createElement('p', { 'data-dsh-soul-preset-root': '' }, `${t('rootLabel')}：${snapshot.roster.root}`),
    notice === null
      ? null
      : React.createElement('p', { 'data-dsh-soul-preset-error': '' }, notice),
    snapshot.roster.presets.length === 0
      ? React.createElement('p', null, t('empty'))
      : React.createElement('ul', null, rows),
    React.createElement('span', { 'data-dsh-soul-preset-toolbar': '' },
      React.createElement(Button, {
        key: 'new', variant: 'primary', 'data-dsh-soul-preset-new': '',
        onClick: () => {
          const id = window.prompt(t('newPrompt'), '')
          if (id !== null && id !== '') void create(id)
        },
      }, t('newPreset')),
      React.createElement(Button, {
        key: 'reveal', variant: 'outline', 'data-dsh-soul-preset-reveal': '',
        onClick: () => { void reveal() },
      }, t('openFolder')),
      React.createElement(Button, {
        key: 'reload', variant: 'outline', 'data-dsh-soul-preset-reload': '',
        onClick: () => { void defaults.refresh() },
      }, t('reload')),
    ),
  )
}

/**
 * Register the stylesheet, the dictionary, and the three surfaces.
 * @param ctx - client root context, with `slots`, `configForms` and `locale` live.
 */
export function apply(ctx) {
  ctx.effect(() => installStyles(), 'dsh-soul-presets: stylesheet')
  createSeats(ctx).registerSurfaces({
    chip: PresetChip,
    dock: PresetDock,
    settings: ManagementSection,
  })
}
