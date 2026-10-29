/**
 * The module-table row the client bundle asks for, faked at the element level.
 *
 * The deployed browser gives the bundle the shell's real `Menu`; node cannot
 * (it is TSX with a CSS module and a portal). What a test can still judge is
 * the wiring the bundle owns — which entries it hands over, which row is marked
 * selected, how it opens — so `Menu` here renders a recorded stand-in: the
 * anchor it was given, and one clickable row per entry while it is open.
 *
 * `Button` and the chevron icon are never called: the recording React keeps a
 * component element as an element, so a test reads their props and children
 * straight off it. They exist to satisfy the bundle's imports.
 * @module dsh-soul-presets/test/support/fake-ui-primitives
 */

/**
 * Build the fake primitive module for one React implementation.
 * @param react - the recording React the bundle also received.
 * @returns the exports `@deepseek-ai/dsh-client-ui-primitives` provides to this bundle.
 */
export function fakeUiPrimitives(react) {
  const h = react.createElement
  return {
    Menu: props => h('span', { 'data-stub-menu': '' },
      props.anchor,
      props.open
        ? h('div', { role: 'menu' }, props.items.map(item => (item.type === 'label'
          ? h('div', { key: item.id, role: 'presentation', 'data-item-label': item.text })
          : h('button', {
            key: item.id,
            role: 'menuitem',
            'data-item-id': item.id,
            disabled: item.disabled === true,
            onClick: () => { props.onSelect(item.id) },
          }, item.label))))
        : null),
    Button: () => null,
    IconChevronDownOutlineRegular: () => null,
  }
}
