# Cnote Design System

This document is the visual contract for Cnote. It exists so new features extend the product instead of introducing a one-off visual language.

## Product Character

- Cnote is a quiet, work-focused canvas. The canvas and nodes carry the experience; controls stay compact and scannable.
- Use the existing neutral surface tokens (`--card`, `--muted`, `--border`, `--foreground`, `--muted-foreground`) and the established semantic accent colors for node types.
- Prefer one clear surface over nested cards. A bordered panel is reserved for a real tool or repeated item.
- Product text is short and operational. Do not put feature explanations inside menus or floating node toolbars.

## Menus

The preferred menu is the style shown in the node filter and add-node references:

- Floating surface: `cnote-menu-surface`, 12-14px radius, 6px internal padding, border, quiet shadow.
- Menu row: `cnote-menu-item`, minimum 40px height, 10px radius, left-aligned icon and label, muted hover state.
- Selected row: use the muted surface and a semibold label. Do not add a second description block unless the choice cannot be understood from its name.
- Separate groups with a 1px divider, not another card.
- Menus must render above node content. Do not place an open menu inside an ancestor with `overflow: hidden`; flip the menu upward when it is anchored near the bottom edge.
- Every icon-only control needs an `aria-label` and a tooltip (`title`).

## Node Toolbars

- A node toolbar is a compact capsule containing node identity and direct actions. It is not a feature banner.
- Keep actions icon-first, consistent at 32px, and use the same hover/selected states as the canvas menus.
- Browser nodes use a browser-like address bar and navigation controls inside the node. Do not add a second web-version capsule above the node.
- Native browser content occupies the viewport below the address bar. The viewport is mounted directly and starts at a predictable zoom baseline.

## Choice Controls

- For a small set of independently enabled scopes, use two-state buttons with `aria-pressed`, not nested checkbox panels.
- For protocol/model choices, use a single listbox menu. Keep the option list to names; put endpoint help in the field label or documentation, not repeated inside every row.
- Model IDs that are provider-specific are entered explicitly. Do not show guessed preset models as if they were available from the user's provider.

## Layout And Layering

- Keep node content in a flex column with one intentional scroll region.
- Menus, popovers, and reply actions need a higher stacking level than node content and must remain visible outside the content scroll region.
- Use stable node dimensions from `web/src/lib/flow/node-dimensions.ts`; do not let labels or hover states resize a node.

## Before Merging UI Changes

1. Compare the change with the node filter menu, add-node menu, and AI node toolbar.
2. Check the default, hover, selected, disabled, loading, and error states.
3. Verify that menus are not clipped at the node edges or by a scroll container.
4. Run the Web build and lint, then manually inspect the affected desktop node at its default size.
