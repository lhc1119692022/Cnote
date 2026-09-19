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
- Show an individual capsule only when its node is the sole selected node, never on hover. Multiple selection shows only the group-selection capsule.
- Keep individual capsules above their nodes without viewport clamping or collision relocation. Right-align when narrower than the displayed node; center when wider.
- Keep actions icon-first, consistent at 32px, and use the same hover/selected states as the canvas menus.
- Browser nodes use a browser-like address bar and navigation controls inside the node. Do not add a second web-version capsule above the node.
- Native browser content occupies the viewport below the address bar. The viewport is mounted directly and starts at a predictable zoom baseline.

## Choice Controls

- For a small set of independently enabled scopes, use two-state buttons with `aria-pressed`, not nested checkbox panels.
- For protocol/model choices, use a single listbox menu. Keep the option list to names; put endpoint help in the field label or documentation, not repeated inside every row.
- Model IDs that are provider-specific are entered explicitly. Do not show guessed preset models as if they were available from the user's provider.

## Layout And Layering

- Canvas background dots use a 60-world-pixel base pitch and a 4-world-pixel diameter. Both scale continuously with canvas zoom, like a tiled image, while remaining CSS gradients rather than image assets. Hide the dots when screen-space pitch is below 20 CSS pixels; show them at or above 20 CSS pixels. Do not introduce stepped density changes or fixed screen-space dot sizes. At 95% zoom the pitch is 57 CSS pixels and the diameter is 3.8 CSS pixels. Keep the existing panning alignment, theme-aware dot color, and opacity.

- Canvas right-button drag cuts connections: use a scissors cursor and red dashed trail, preview crossed edges with red dashes, and remove them together on release in one undo step. Do not show the former canvas paste menu. Escape, focus loss, document/viewport changes, and pointer cancellation discard the preview; locked canvases cannot be cut. Text inputs retain their native editing menu.

- Keep node content in a flex column with one intentional scroll region.
- Menus, popovers, and reply actions need a higher stacking level than node content and must remain visible outside the content scroll region.
- Use stable node dimensions from `web/src/lib/flow/node-dimensions.ts`; do not let labels or hover states resize a node.
- Audio nodes default to 540 × 220 with a 420 × 200 minimum. Waveform bars keep a fixed thickness and pitch, with a bounded count that changes on resize; resizing never triggers audio decoding.
- Connection points appear on hover or while the node is the current connection target (valid or invalid). Preserve target feedback during connection gestures. Neither selection nor focus within the node keeps connection points visible after the pointer leaves.
- Audio trimming temporarily adds 48 world pixels of display height without modifying saved dimensions or undo history. The waveform and playback controls retain their original height; closing restores the original size. Other node editors retain their existing layout behavior.
- Audio trimming is a selected-node capsule action that only opens trimming. Close with the cancel button or a pointer press outside the node and its toolbar; repeated capsule clicks must not toggle it off. Use a thick rounded accent outline with solid thicker side handles and a short contrasting grip line at each midpoint. Round only the outer corners of each handle; keep the inner corners square to join the outline cleanly. Keep both endpoint handles inside padded waveform bounds and dim only unselected audio. Center the duration in a solid, theme-aware rounded badge over the waveform, with bold readable text, layered above the outline and handles, and no pointer interception. Use minutes:seconds for range inputs and duration, never decimal seconds or an unlabeled frame count. Provide cancel, time fields, and generate controls in both themes. Generate a visible WAV copy without replacing the original or changing its connections; creating the copy is one undo step.
- Audio waveforms currently accept source files up to 30 MB. Keep compact waveform samples and the compressed source, not a full decoded PCM buffer. Trimming decodes the selected range incrementally and writes a WAV copy; the 100 MB output limit applies to the selection, not the full recording. Normalize waveform amplitude across the recording while preserving relative dynamics and true silence. Show preparation or failure text rather than a fake flat waveform when decoding is unavailable.

## Before Merging UI Changes

1. Compare the change with the node filter menu, add-node menu, and AI node toolbar.
2. Check the default, hover, selected, disabled, loading, and error states.
3. Verify that menus are not clipped at the node edges or by a scroll container.
4. Run the Web build and lint, then manually inspect the affected desktop node at its default size.
