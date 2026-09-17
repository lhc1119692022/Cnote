# Canvas Compatibility Matrix

Baseline: `97d15d4a90c982c7bc67e4fc7c734be44befd7c2`
Last desktop verification: 2026-09-17
Scope: Electron desktop canvas, with the current domain/runtime/storage/self-built canvas architecture preserved.

## Status Legend

- **Verified (scoped)**: only the particular observation described in the evidence column passed; this is not sign-off for the complete row or plan. Historical unqualified Verified labels below must be read with this restriction.
- **Automated evidence only**: a focused check passed; native input, appearance, and restart acceptance remain separate.
- **Partial desktop evidence**: at least one actual Electron scenario passed, but required variants remain open.
- **Implemented, desktop evidence pending**: code path exists, but the full desktop scenario still needs a repeatable record.
- **Open**: not yet demonstrated or known to need further compatibility work.

## Matrix

The requirement-level ledger below is the completion authority. This older summary table is an evidence index, not a completed-requirements count. Neither source presence, DOM measurement alone, nor a green script proves a full desktop workflow.

| Baseline behavior | Current implementation | Status | Evidence / next check |
| --- | --- | --- | --- |
| Flow opens with toolbar, node panel entry, controls, and minimap | `CanvasToolbar`, `CanvasControls`, `CanvasNodePanel`, `CanvasMinimap` | Verified | Electron Flow opened and controls were inspected. Repeat at narrow and maximized window sizes. |
| Canvas and content use separate coordinate layers | `CanvasViewport` world layer plus content overlay | Verified | Content remains readable while canvas zoom changes. |
| Node hover and selected chrome remain stable across content, handles, and toolbar | Canvas interaction state plus `data-node-*` attributes and CSS | Implemented, desktop evidence pending | Check hover-to-toolbar travel, resize, and handle entry with real pointer movement. |
| Content and menu scrolling do not zoom the canvas | event-target guards in `CanvasProvider` | Verified | Sticky/content scroll and panel scroll were checked; repeat for AI, Request, and Browser. |
| Empty canvas wheel zoom is continuous and cursor anchored | `zoomAt`, canvas wheel boundary handling | Verified | Electron wheel test passed; verify the `0.1-4` limits at both extremes. |
| Edges render accurately after viewport changes | screen-coordinate SVG edge layer in `EdgeLayer` | Verified | Edge path coordinates and visible alignment inspected after reload. |
| Edge hit testing works in blank segments | transparent stroke hit layer | Verified | Real mouse selected an edge in a blank segment. |
| Selected edge can be deleted and restored with undo | document-level delete, history, fixed-position delete control | Verified | Real mouse deleted an edge; visible undo restored it. |
| Locked canvas protects edge deletion | delete button disabled from graph lock state | Verified | Electron lock test showed disabled delete control; unlock restored it. |
| Invalid, self, and duplicate connections are rejected with visible release feedback | `canConnect`, `addEdge` guards, and transient `data-connection-feedback` status | Implemented, desktop evidence pending | Run the complete pointer sequence for each rejection case and confirm the status clears on the next canvas action. |
| Empty-space connection release creates the follow-up node | connection menu and `addConnectedNode` | Implemented, desktop evidence pending | Verify menu placement and the resulting edge in Electron. |
| Minimap size, navigation, viewport frame, and panel avoidance | `CanvasMinimap` plus overlay insets | Implemented, desktop evidence pending | Verify click, drag, wheel isolation, and both panels at all window widths. |
| Single and multi-node copy use a 40px outline gap | `outlineGapOffset`, `pasteNodes`, duplicate actions | Implemented, desktop evidence pending | Measure the resulting world-space bounding boxes for single and multi-selection. |
| Group, ungroup, move, and drop-into-group preserve absolute coordinates and edges | `canvas/grouping.ts` and graph store actions | Implemented, desktop evidence pending | Complete the multi-node group workflow in Electron. |
| Sticky, Browser, Content, AI, Request, and Group core flows | migrated node contents and conditional toolbars | Implemented, desktop evidence pending | Complete one continuous desktop scenario per node kind, including restart where applicable. |
| Graph, runtime, capture, and generated-result persistence across restart | storage and runtime persistence modules | Verified by focused checks | Full Electron close/reopen with a generated result remains open. |
| Legacy behavior differences are documented | this matrix and migration notes | Open | Add confirmed intentional differences as they are discovered during desktop comparison. |

## Native desktop check — 2026-09-17

The bundled `@oai/sky` controller successfully discovered and operated the existing Cnote Electron window. The earlier unified-control discovery error does not block this native input route. These observations are from Windows mouse input and screenshots, not CDP synthetic pointer events. Screenshots remain in the tool transcript, not repository fixtures.

- QA Flow: `Canvas compatibility QA`; light theme, panels closed, approximately 1442 x 962 window capture.
- At displayed 149% zoom, dragged AI output from (796, 513) to blank space (946, 295). The follow-up menu appeared with AI, Content, and Request choices.
- Selected Content at (1009, 383). The menu closed; a selected content-type node and a new edge from AI appeared. One test node and edge were added to the QA Flow; existing content was not deleted. Other creation choices and edge-of-window placement remain pending.
- Clicked fit-view at (47, 706). Displayed zoom became 136%, with node bounds and edges updated. This is not proof of overlay-safe fit in all configurations.
- Wheel over the minimap at (1253, 840) left displayed zoom at 136% and visible node positions unchanged.
- Minimap drag from (1257, 838) to (1285, 861) shifted the canvas left/up and moved its viewport frame without changing zoom. Click precision, clipping, stable bounds, and panel combinations remain pending.
- Initial AI hover toolbar appeared partly behind the global title area. Top-edge toolbar avoidance needs baseline comparison and a dedicated regression check. Content toolbar flipped below its node, which does not prove all-node avoidance.
- Overlapping node surfaces and edges need a layering review; no baseline-equivalence claim is made from this sequence.

These focused observations do not certify six-node workflows, other zoom tiers, themes, window sizes, restart persistence, or a fresh build. The broader matrix rows remain pending where their full scope has not been verified.

### Toolbar vertical placement correction

- Replaced the fixed 84px flip threshold with measured, zoom-aware toolbar height and a 72px top safe area. Vertical placement is clamped above the viewport bottom.
- Added geometry regression cases for 25%, 50%, 100%, 150%, 250%, and 400% zoom, including a node extending beyond both viewport edges.
- Fresh desktop build, typecheck, lint, the six planned focused verification scripts, and git diff whitespace check passed after this change.
- Reloaded the existing Electron renderer after its saved indicator appeared. QA nodes and edges remained visible. Native mouse selection of the top-edge AI node displayed its toolbar below the node, outside the global title region. This is renderer reload evidence, not full application restart evidence.
- The AI node was partially offscreen to the left: its toolbar also remained partly offscreen and overlapped the controls. Horizontal toolbar containment is still an open defect; vertical correction does not close the full toolbar acceptance row.

### Toolbar horizontal placement and connection checks

- Horizontal placement now clamps the toolbar to the working area after side-panel insets and the control-strip clearance. The toolbar uses its measured scaled width rather than aligning to an offscreen node edge.
- Added left/right offscreen cases and all four panel inset combinations across 25%, 50%, 100%, 150%, 250%, and 400% zoom to the navigation verifier.
- When a toolbar exceeds the available width, its action row permits horizontal scrolling instead of losing buttons outside the viewport. This constrained-width fallback is not yet baseline-certified and needs narrow-window keyboard/mouse acceptance.
- Fresh build:all, typecheck, lint, all six planned verification scripts, and git diff --check passed after the horizontal change.
- Native Electron check after reloading the saved QA Flow: the partially offscreen AI node toolbar was fully visible at approximately x=102..390, with the control strip at x=24..72. Opening the left panel relocated the toolbar to approximately x=366..654, beyond both panel and controls.
- Opening the right panel closed the left panel in this window. This verifies separate-panel behavior only, not simultaneous panels. With the right panel open, the AI toolbar remained fully visible at approximately x=82..370.
- Native drag from AI output (364,418) to the already-connected Content node (515,412) showed rejection feedback. Native drag from Content output (866,219) back into Content (699,403) also showed rejection feedback. No follow-up creation menu appeared for these rejected targets. Exact edge-count assertions and other invalid kinds remain pending.
- Newly observed: rejection feedback occupies the global toolbar band near y=55..85. Its safe-area placement needs correction and a desktop check.

### Dual-panel compatibility and rejection placement

- Compared `97d15d4:web/src/components/flow/FlowEditor.tsx`: baseline panel opening uses available toolbar width, 32px horizontal padding, and 40px group separation, allowing the center group to hide before closing panels. The migrated toolbar instead unconditionally closed the opposite panel.
- Removed that unconditional mutual exclusion. Candidate panel opening now checks measured side-group widths. Open panels retain an enabled close toggle. Window/width changes recheck safety after measurements match the current insets, closing the left panel first when space is insufficient.
- Added safe/unsafe dual-panel, single-panel, and exact boundary-width checks. Fresh build:all, typecheck, lint, all six planned verification scripts, and git diff --check passed.
- Native Electron acceptance at approximately 1442 x 962: opened left panel then right panel; both remained visible. Node toolbar, controls, and minimap occupied the remaining middle canvas area. This supersedes the earlier mutually exclusive-panel observation.
- Repeated the AI-to-Content duplicate connection with both panels open. The rejection message appeared below the global toolbar, around y=115..145, centered in the remaining canvas width. This verifies the corrected 72px canvas-relative top offset and panel-aware centering in this configuration.
- Attempted native border/menu resizing did not produce a changed window size; exited with Escape. Narrow-window resize acceptance remains unverified, not failed or passed.
- Compact toolbar currently hides save/export/import/template actions (also present in the baseline implementation). The requested plan explicitly asks to retain compact icon access; this requirement still needs implementation rather than being waived as baseline parity.

### Compact action access

- Save, template, export, and import buttons now remain mounted in compact mode. Only their text labels and hover-width expansion are suppressed; tooltip, aria-label, click handler, and saving-disabled behavior are preserved. A resumable task keeps an icon-only entry when present.
- Added a TypeScript syntax-tree regression check for the four labeled actions, required title/click attributes, and absence of a compactActions ancestor condition. This is a structural guard, not desktop input proof.
- Fresh build:all, typecheck, lint, all six planned verification scripts, and git diff --check passed.
- Native desktop check: reopened both side panels at the existing 1442 x 962 window size. All four action icons remained visible in the compact right toolbar, around x=826,870,914,958.
- Clicked the compact export icon at (914,76); the export dialog appeared with format selection, Cancel, and Export controls. Clicked Cancel and returned to the canvas without writing a file. File roundtrip behavior is not certified by this dialog-opening check.
- Remaining layout acceptance includes an actually resized narrow window, compact title/add-node access when the center group is hidden, maximum zoom toolbars, and keyboard traversal. No full toolbar sign-off is claimed.

### Layering correction — 2026-09-17

- Confirmed in source that the edge display and hit-test layer used z-20 above lifted content at z-15, allowing edge strokes to intercept node-body clicks.
- Split lifted content into stable group and ordinary-node layers: group backgrounds at z-5, edges at z-10, ordinary content at z-15. Both content layers retain screen-coordinate sizing and virtualization exceptions. Runtime objects and document coordinates are unchanged.
- Added structural regression guards for both content-layer mounts, disjoint filtering, and layer order. These are source checks, not native hit-test evidence.
- Fresh desktop build:all, web typecheck, lint, all six planned verification scripts, and git diff --check passed. Build retained its large-chunk advisory.
- Still awaiting desktop checks: selecting edges in group whitespace, editing node bodies over edges, dragging group whitespace, and retaining active offscreen content. Shell-versus-foreground-content overlap is separately unresolved; this change does not certify all overlap behavior.

### Shared node stacking and native overlap check — 2026-09-17

- Reloaded the newly built Electron renderer in the existing QA Flow. Edges disappeared behind ordinary node bodies; clicking the exposed curve at (889,521) selected it in blue and displayed its delete control. No edge was deleted. Group-whitespace selection still needs a separate test.
- Reproduced the remaining shell conflict: the rear Sticky outline crossed the front Content body even though its actual content remained behind. Replaced the global shell plane with a stable, unscaled stacking wrapper per node, containing sibling lifted content and scaled shell. Hover raises that entire ordinary node, matching the baseline non-group hover-front behavior.
- Shells remain mounted when content is virtualized. Added AST guards that shell and content share the same wrapper, shell mounting is not conditional on content, and heavy content does not enter WorldLayer.
- Fresh desktop build:all, typecheck, lint, and all six verification scripts passed. Reloaded Electron again: the hidden Sticky outline no longer crossed Content. Clicked exposed Sticky body at (600,540): its content, outline, editor controls, and toolbar came forward together.
- Clicked the formerly overlapped green swatch at (498,379): Sticky changed from yellow to green, with no node drag or underlying Content activation observed. This modifies only the existing QA Sticky. It verifies this overlap case at 136% zoom, not all node kinds, zoom levels, or menu paths.
- Remaining: hover travel to toolbar, resize and connection across overlaps, group controls, active webview/editor retention, and all required window/zoom combinations.

### Active manipulation stacking — 2026-09-17

- Added shared drag IDs to the canvas interaction context; start, end (including locked end), and cancellation update that state. Toolbar suppression now checks actual dragging as well as resizing. Title editing keeps its toolbar visible independently of hover.
- Per-node stacking now prioritizes active resize/drag over hover, then keyboard focus, then document order. Groups remain in their background layer. Focused and dragged content is pinned against virtualization without changing stored node z values.
- Added executable stacking tests for idle, focus, hover over another focused node, resize, multi-drag, and group exclusion. Fresh typecheck, lint, all six regression scripts, and desktop build:all passed.
- Native Electron at 136%: QA Sticky retained the previous green color after renderer reload. Dragging its resize handle from (818,689) to (948,754) expanded both content and shell together; connection endpoint and minimap footprint changed accordingly. Then dragging its upper border from (850,366) to (935,405) moved the resized node, its toolbar, and handles together; canvas zoom remained 136%. These changes affect only the QA Sticky.
- These end-state captures do not prove every intermediate animation frame, focus-to-toolbar travel, pointer cancellation, or multi-node drag. Full close/reopen and all zoom/window combinations remain pending.

### Visual ordering and connection targeting — 2026-09-17

- Found a source-level mismatch after the stacking changes: connection preview and release still used only document z order, ignoring raised hover/focus/manipulation state and the separate background group plane. This could choose a covered node or group.
- Moved focused-node state to CanvasProvider and introduced a shared geometric hit test using the same nodeStackOrder and front-order calculation as rendering. Preview and release now call the same provider hit test. Ordinary nodes win over groups regardless of document z; later array entries break equal-order ties. Covered disabled targets are not skipped to silently connect behind them; existing connection validation still decides acceptance.
- Added executable tests for hover/focus/resize/drag priority, group-plane priority in both array orders, equal-order ties, document z, boundary and outside points, and a foreground disabled target.
- Fresh desktop build:all, typecheck, lint, six regression scripts, and git diff --check passed. Native overlap connection preview/release remains pending for this revision; previous native evidence covers earlier layering and manipulation revisions only.

### Desktop reopen, overlap connection and narrow editor — 2026-09-17

- Native window discovery showed the prior Cnote window absent. Ran the project desktop launch-dev entry (fresh build succeeded), obtained new Electron window 1707198, and reopened Canvas compatibility QA from the dashboard. The three-node Flow retained its green Sticky, enlarged dimensions, moved position, and 136% viewport. This proves those saved document properties survived an application restart; runtime jobs and captured/generated assets were not exercised.
- Fit view changed zoom to 127%. Dragged AI output (625,557) to the Content/Sticky overlap at (980,585), where Content was visually in front. Rejection feedback appeared below the global toolbar, consistent with the existing AI-to-Content edge. This is native rejection evidence, not an exact edge-count assertion or intermediate-frame preview check.
- Empty-canvas wheel input reduced zoom to 62%. Observed a concrete failure: the Sticky formatting toolbar wrapped across multiple rows and consumed the whole content area, leaving no visible note body.
- Changed the shared rich-text format row to non-wrapping horizontal overflow, retaining all sixteen 32px non-shrinking icon buttons and labels. No editor instance transform was introduced. This is a usability correction under the lifted-content constraint, not yet a full baseline visual sign-off at every zoom tier.
- Extended the existing rich-text DOM regression to assert the row overflow and preserved buttons. Rich-text tests, all six planned scripts, typecheck, lint, desktop build:all, and git diff --check passed.
- Reloaded Electron at 62%: the note placeholder and body are visible below the single-line format row. Horizontal scroll and a native scrollbar drag revealed later formatting actions without changing canvas zoom or moving the node. Link/table subpanels and 25%/50%/150%/250% cases still require acceptance.

### Sticky rich-text persistence repair — 2026-09-17

- Found an actual persistence omission: StickyContent discarded the rich-text document emitted by the editor and persisted only plain text. StickyNodeSpec and both legacy conversion directions also omitted the document, despite the legacy StickyNodeData supporting it.
- Added optional serializable author document data to StickyNodeSpec, passed it back to the editor, and saved both plain text and the author document on change. Removed duplicate local text state so format-only updates and restored node state follow the graph directly. No editor instance, cursor, or runtime handle is persisted.
- Legacy conversion preserves matching version-1 tiptap JSON documents; absent or stale documents fall back to plain text. Export includes the author document. Existing plain-text Sticky nodes remain readable.
- Extended rich-text regression using the actual StickyContent and graph store: apply bold, serialize graph, unmount, restore graph, remount, and assert bold text remains rendered. Extended autosave regression through legacy import, graph persistence/load, export, and reimport, including missing/stale document cases.
- Fresh typecheck, lint, rich-text test, six planned regression scripts, git diff --check, and desktop build:all passed. Actual desktop formatted-text close/reopen, copy, undo, and export-file roundtrip still need acceptance; the component and storage tests do not replace that gate.

### Sticky history, copy and pin compatibility — 2026-09-17

- Native discovery still returned Cnote, but its capture showed a different foreground application. No mouse or keyboard input was sent after detecting the mismatch. Desktop formatted-text acceptance was not performed in this pass.
- Extended actual StickyContent/store regression: format-only graph undo removes bold, redo restores it, duplicate keeps an independent author document and a 40px outline gap, modifying the duplicate does not change the original, and undo/redo of duplication preserves formatting. All assertions passed.
- Baseline StickyNode contains a 32px pin action; baseline FlowEditor blocks position changes for pinned Sticky nodes. Current migration stored pinned but neither exposed its action nor respected it during drag. Restored the pin/unpin toolbar action with pressed state and history commit. Direct drag still selects a pinned Sticky but does not capture/start a drag. Multi-node/group drag filters pinned Sticky members; copy expansion remains unchanged so pinned members are not lost during copying. Editing, resize and connections remain separate from pinning.
- Added drag-filter cases for pinned single selection, mixed multi-selection, group members, unpin, and copy expansion. Fresh typecheck, lint, rich-text and six planned scripts, git diff --check, and desktop build:all passed. Pin/unpin native interaction and formatted-text application restart remain pending.

### Group-drop wiring — 2026-09-17

- Audit found assignNodeToOverlappingGroup existed but was not called by the canvas drag lifecycle. Added a graph finishNodeDrag action and wired actual node-drag-end to it before the single history commit.
- Membership is resolved for all dragged nodes against one unchanged set of group bounds, using node centers and visible group z order with later-array tie breaking. This avoids changing hit regions between members of a multi-node drop. Nodes moving with their selected parent group retain membership; pinned Sticky nodes are excluded. Group dimensions/counts are reconciled after assignment, and coordinates stay absolute.
- Actual graph-store regression now exercises movement into a group, count update, unchanged edges, one-step undo of movement plus membership, redo, moving out, and undo back into the group. Fresh typecheck, lint, rich-text test, six planned scripts, git diff --check, and desktop build:all passed. Native group-drop acceptance is still pending.
- Separately confirmed Alt-drag has no copying input path in current CanvasProvider; this remains a required implementation item, not an implemented feature or merely a missing test.

### Alt-drag copy transaction — 2026-09-17

- Added Alt-drag input wiring with a 2 screen-pixel movement threshold: Alt-click alone does not create nodes. Copies start at source positions and follow the cumulative world delta; ordinary duplication still uses the 40px outline gap. Internal edges are independently cloned and remapped.
- Copy creation defers its history entry until drag completion, so duplication, movement and group assignment undo together. Escape/pointer cancellation removes temporary copies and their edges and restores source selection. Normal drag cancellation also restores starting positions. A lock detected during drag triggers cancellation instead of leaving temporary copies.
- Navigation regression executes the actual Provider event handler with the real graph store: Alt-click, original preservation, multi-node positions, internal edge remapping, deferred history, cancellation, one-step undo and redo pass. This handler-level test does not prove physical key/pointer dispatch or native rendering.
- Fresh typecheck, lint, navigation, rich-text, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer, desktop build:all and git diff --check passed. Native Alt-drag, group copying, pointer cancellation and edge-of-canvas acceptance remain pending. No complete-plan sign-off is claimed.

### Pan boundary and native pin acceptance — 2026-09-17

- Found that lifted content stopped pointer bubbling and the root rejected node hits, preventing middle/Space panning over nodes. Added capture-phase pan routing before node/content handlers, preserving menus/panels marked as canvas chrome and refusing to interrupt connection/resize gestures. Pan-origin clicks and auxiliary clicks are suppressed to avoid triggering underlying content actions.
- Regression executes the actual capture handler across middle/Space, ordinary clicks, chrome, connection, resize and right-button cases. Fresh typecheck, lint, navigation, rich-text, six planned regression scripts, desktop build:all and diff whitespace checks passed.
- Native desktop recovery succeeded by selecting and activating the returned Cnote window before observing; screenshot now matches the QA Flow. Refreshed the renderer after building. Verified Sticky pin button at 62%: fixed node stayed at approximately (1062,463) after a 50px/40px drag; unpinned node then followed a -50px/+200px drag to approximately (1012,663), with edge and minimap updating.
- Available native drag API exposes only start/end coordinates, without held modifiers or a mouse-button argument. Actual held-Space/middle drag and Alt-drag remain unverified; handler checks are not a substitute. Browser embedded webview event routing also remains a separate acceptance item. Overall plan remains incomplete.

### Interrupted resize and pointer boundary — 2026-09-17

- Confirmed finishResize(false) previously cleared the gesture without restoring the already-applied size. It now restores the starting size on cancellation or a lock detected at release, without adding history or changing manualSize. A successful changed resize sets manualSize and commits once; a no-op resize does not commit.
- Escape and window blur now cancel resize, drag/marquee and connection state together. Leaving the canvas while a pointer button remains held no longer finishes a captured gesture prematurely; release/cancel remains responsible for completing it.
- Regression executes the actual finishResize callback with the real graph store for cancellation, locked release, no-op and successful resize, including undo/redo and cleared moving state. Fresh navigation, typecheck, lint, rich-text, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer and desktop build:all passed. Physical Escape-during-resize, window-blur and cross-window pointer capture still require desktop acceptance.

### Minimap visible viewport parity — 2026-09-17

- The minimap viewport rectangle previously included canvas regions hidden behind side panels, whereas click navigation already centered in the unobscured work area. The rectangle now uses the same left/right overlay insets, with nonnegative dimensions when panels consume the available width.
- Minimap world bounds are memoized by node-array identity so panning/zooming no longer repeats the node-bounds reduction. Selection lookup uses a Set rather than a per-node linear search. Non-left pointer presses no longer unexpectedly recenter the viewport.
- Added direct geometry checks for 10%, 25%, 50%, 100%, 150%, 250%, 400% zoom across no/left/right/both panels, checking frame dimensions and agreement with navigation center, plus exhausted viewport width. All automatic gates, rich-text checks, desktop build:all and git diff --check passed. Native minimap panel/zoom acceptance remains pending; no visual parity claim is made from these geometry tests.

### Screen-sized node toolbar controls — 2026-09-17

- Audit confirmed NodeHoverToolbar sits inside the shell WorldLayer and inherited canvas scaling, making its 32px controls only 8px at 25% zoom. Added inverse scaling around the toolbar's top-left anchor while retaining world-relative positioning. Toolbar measurements and available-width limits now use screen pixels; top/bottom flip and horizontal avoidance remain in screen coordinates.
- Added scale/placement checks for 10%, 25%, 50%, 100%, 150%, 250%, 400%, plus source wiring guards for unscaled measurements and width constraint. Typecheck, lint, all planned scripts, rich-text, desktop build:all and git diff --check passed. Native hit testing, hover travel and visual comparison at all required zoom levels remain pending; shell/content scaling itself is not changed by this fix.

### Arrange preserves group geometry — 2026-09-17

- Native observation initially showed Cnote, but refresh input was rejected after user input; the subsequent screenshot showed another foreground window overlapping Cnote. Stopped native input rather than interfering. Toolbar/minimap native acceptance was not completed in this pass.
- Checked baseline CanvasControls: its focus/fit button calls fitView for all nodes. Retained that behavior rather than inferring selected-only focus from its label.
- Found arrangeDocumentNodes independently positioned group members, breaking group-relative geometry despite absolute-coordinate membership. Arrangement now places root nodes/groups, moves members by their group delta, preserves edges, and creates one undo entry. Pinned Sticky nodes remain stationary; a group containing a pinned Sticky is left stationary as a unit. Locked canvas rejects arrangement and disables its button.
- Actual store regression checks locked no-op, group/member offsets, pinned-node position, edges, one-step undo and redo. Fresh build:all, typecheck, lint, all planned verification scripts, rich-text and diff checks passed. Desktop arrange acceptance and dense-layout overlap assessment remain pending.

### Structural lock guards and edge keyboard deletion — 2026-09-17

- Found toolbar/keyboard paths could delete nodes, duplicate a single node, ungroup, group or paste while canvas lock was active. Added guards to the graph-store structural actions, including deleteEdge, rather than relying only on disabled UI buttons. Node copy/delete and media split toolbar actions now advertise disabled state while locked. Editing/runtime updateNode remains independent so ongoing work and gesture rollback still function.
- Delete/Backspace now dispatches to the selected edge when present, otherwise to selected nodes, while preserving editable-target exclusion and lock protection. Previously selecting an edge cleared node selection, so the shortcut did nothing.
- Actual graph-store tests cover nine locked structural paths without graph/history mutation and unlocked edge deletion with undo/redo. Fresh build:all, typecheck, lint, navigation, rich-text, the six planned scripts and diff checks passed. Physical keyboard edge deletion, locked toolbar presentation and the remaining full desktop matrix are not certified by these store tests.

### Clipboard group and internal-edge preservation — 2026-09-17

- Found copySelectedNodes copied only explicitly selected nodes (a selected group lost its members), while pasteNodes accepted no edges. Clipboard capture now expands selected groups, deep-clones internal edges, and pastes them with new edge/node IDs and remapped endpoints/group membership. External connections are deliberately excluded; absolute coordinates and 40px outline-gap placement are retained.
- Locked or documentless paste no longer consumes a paste-generation offset. Nodes and edges are added in one history transaction.
- Regression executes the actual clipboard copy/paste function bodies against the real store, covering selected-group expansion, lock rejection, first-paste spacing, remapped members/handles/internal edges, external-edge exclusion, undo and redo. Fresh typecheck, lint, all planned scripts, rich-text, desktop build:all and git diff --check passed. Native keyboard dispatch and cross-document clipboard acceptance remain pending.

### Native clipboard event routing — 2026-09-17

- Copy previously updated only an in-memory cache. The paste handler prioritized any system text/image, so stale system text could defeat Ctrl+C/Ctrl+V node duplication. Added a native copy-event handler that writes a per-copy custom MIME token plus plain node labels; matching token paste uses the captured nodes/edges before text import. New external text without the token still imports normally. Editable targets retain native editor copy/paste.
- Registered and cleaned up the copy listener alongside paste; removed the keydown-only copy path. Locked canvas paste exits before content import. The MIME token is intentionally session-local, not a serialized cross-application graph format.
- Regression executes actual copy/paste event handlers with a DataTransfer-like test object, verifying old system text replacement, node-token precedence, fresh external text import, lock rejection and editable-target exclusion. Fresh build:all, typecheck, lint, all planned scripts, rich-text and diff checks passed. Real Electron clipboard MIME transport and cross-document keyboard sequences remain pending desktop acceptance.

### Native clipboard/minimap acceptance and confirmed content scaling failure — 2026-09-17

- Refreshed the real Cnote Electron renderer to the latest built output. At 62% zoom, selected the green Sticky by its border, pressed actual Ctrl+C and Ctrl+V, and observed a new green Sticky to its right plus an extra minimap rectangle. Native clipboard token transport works for this single-node same-document case. No delete/undo action was performed; two QA copies now remain (one pasted, one toolbar-duplicated).
- Reduced to 50% with the canvas control, then clicked the copied Sticky's toolbar copy icon. Another Sticky appeared. The inverse-scaled toolbar is visibly larger than its former inherited-scale version and its copy action is physically hittable at 50%. This is not an exact pixel-size measurement or all-zoom sign-off.
- Opened the right extension panel. Minimap moved left clear of that panel. Clicking the middle Sticky rectangle in the minimap brought that Sticky to the unobscured canvas center while preserving 50% zoom. Wheel input over the minimap and over Sticky content left zoom and canvas position unchanged; wheel over blank canvas reduced zoom to a displayed 28%.
- **Confirmed high-priority failure, not merely pending evidence:** at 50%, Content's type selector is clipped and AI input wraps into a narrow column; at 28%, Content labels stack vertically, AI composer overflows below its shell, and Sticky formatting consumes the entire body. The lifted content box shrinks with size*zoom but its contents remain at unscaled layout dimensions. Toolbar inverse scaling does not address this.
- Next priority is proportional content presentation at 25/50/100/150/250 without reintroducing the old world-transform tree or scaling native guest views through that tree. Treat the current low-zoom content presentation as failed acceptance. Browser needs its own host/content zoom treatment; a generic transform rollback is not an acceptable fix.
- This pass changed only acceptance documentation and QA canvas state; no source/build change was made after the previously passing gates.

### Proportional lifted-content presentation — 2026-09-17

- Added an inner presentation box for non-Browser nodes: layout uses node world width/height and CSS layout zoom, while the outer lifted screen box remains size*zoom and translation-only. Content is still outside WorldLayer, without a scale transform ancestor. Browser remains on its existing direct-size path until native guest zoom is handled explicitly.
- Pure regression covers Sticky/AI/Request/Content/Group at 10/25/50/100/150/250/400%, equality between presented content extents and shell extents, stable layout dimensions, no scale transform and Browser exclusion. Fresh typecheck, lint, all planned scripts, rich-text, desktop build:all and diff checks passed.
- Native before/after at displayed 28% confirms the previous failure is corrected for visible AI/Content/Sticky: AI composer is inside its shell, the Content type grid is intact, and Sticky body space is visible. At displayed 80%, green Sticky content and selected shell align; clicking its body raises its shared toolbar/chrome. No text was typed because accessibility focus did not reliably identify the editor (RootWebArea was returned), so typing/caret behavior is still pending.
- Remaining acceptance: exact required zoom tiers, Request and Group native layout, Browser-specific proportional behavior, rich-text caret/selection, menu positioning under layout zoom, full six-node scenarios and restart. This improvement does not certify all scaled content interactions.

### Browser chrome proportional layout — 2026-09-17

- Browser address/navigation/capture bar now uses canvas layout zoom independently of the native guest. Its 48px world height scales with the node rather than consuming a fixed screen height at low zoom. The webview stays a sibling outside this zoomed form; its instance, partition and navigation are unchanged.
- Regression covers 10/25/50/100/150/250/400%, invalid zoom clamping and the actual JSX boundary between zoomed chrome and native guest. Typecheck, lint, navigation, rich-text, all six planned verification scripts and desktop build:all passed. Native address input and capture-button hit testing still require acceptance.
- Guest proportional rendering is NOT completed by this patch. Installed Electron API documentation explicitly describes same-origin zoom propagation; the current embedded views and persistent browser runtime share persist:cnote-browser. Directly calling setZoomFactor with canvas zoom requires a cross-view/capture review before use. Do not treat scaled chrome as restored webpage zoom.

### Browser guest viewport isolation — 2026-09-17

- A hidden, isolated Electron experiment confirmed the risk: setting one guest to 25% with setZoomFactor changed the second same-origin guest AND its same-partition popup to 25%. The real profile was not used.
- Replaced the proposed page-zoom approach with per-guest desktop device emulation: logical viewport dimensions come from measured guest bounds divided by canvas zoom, and the presentation scale follows canvas zoom. The native guest remains untransformed in the lifted content layer. Partition/cookies and graph declarations are unchanged. ResizeObserver and dom-ready reapply presentation on resize and navigation.
- Added a main/preload presentation bridge with numeric bounds and host ownership validation; an unrelated guest or non-main renderer is rejected. An older running preload gives a restart notice instead of crashing the renderer.
- New desktop/scripts/verify-browser-presentation.cjs launches isolated hidden Electron windows and exercises the production presentation helper at 10/25/50/100/150/250/400%. Logical width/height remain stable; native guest mouse input hits the test button at scaled coordinates; sibling/popup zoom stays at 100%; cookies remain shared; text extraction and navigation followed by resize work. Invalid inputs and foreign-host access are rejected. This is engine integration evidence, not full Cnote mouse/keyboard acceptance.
- Fresh desktop build:all, web typecheck/lint, navigation/rich-text and all six planned scripts passed, as did the new Electron regression and git diff --check. Existing bundle-size and line-ending warnings remain.
- Pending: restart the actual Cnote main process to load the bridge, verify the renderer-to-preload-to-main path in its Browser node, compare actual webpage/chrome visuals at all requested tiers, and exercise address input, scrolling, popout and capture-to-Content-to-AI. Full-plan acceptance remains open.

### Actual desktop Browser mount and capture — 2026-09-17

- Restarted the saved QA desktop through the normal close/flush path and launch-dev. The QA Flow reopened with its five existing nodes. Created a Browser through the actual add menu, then typed a local fixture URL into its address bar. This exposed a genuine blocker: loadURL was not a function and the browser remained loading.
- Root cause: createMainWindow no longer enabled webviewTag. The JSX element existed but was not a native Electron guest. The previous packaged-renderer smoke test checked only the popout API and could not detect this omission.
- Restored native guest support with explicit guest isolation: no preload, Node integration, nested webviews or insecure content; allowed persistent partition and HTTP(S)/about:blank initial navigation only; unsupported redirects/navigation are blocked. Allowed new-window targets navigate the same guest. Existing root process/preload isolation remains enabled.
- Added live smoke checks for the actual window native webview method and presentation bridge. The isolated seven-tier Electron test now installs the production guest policy and checks that guest require and cnoteDesktop are unavailable. Both tests passed; the full desktop build also passed.
- After another normal restart, reopened the six-node QA Flow. Google rendered in the Browser; actual address-bar click, Ctrl+A, typing and Enter navigated to a loopback-only long article. At displayed 80%, actual wheel input inside the page scrolled paragraphs without moving/scaling the surrounding canvas. Clicking the camera produced a titled Content node containing the article and a visible Browser-to-Content edge; minimap updated. No provider request or external account was used for the fixture.
- Still pending: connect this captured Content to AI and complete its full runtime chain; all exact zoom tiers, popout/navigation buttons, native Browser pointer/hover transitions, and persistence of the newly captured material on a further restart. The active QA now has seven nodes. Local fixture is served by the current node-repl HTTP server at 127.0.0.1:11337; it is temporary test content, not a production dependency.

### Captured Content to AI and native restart — 2026-09-17

- In the actual desktop, fit all nodes (displayed 54%), selected the captured Content border and dragged its output connector to the AI node body. AI immediately exposed Cnote Browser QA in its upstream list. Clicking that item inserted a named variable chip into the prompt. No model request was sent: the visible model selector is unconfigured and Send is disabled. This proves connection and reference insertion, not AI generation.
- Code inspection found Browser mount URLs came only from node.url/default, ignoring persisted runtime tab navigation. Changed both native initialSrcRef and iframe initial state to initialize from liveUrl, whose priority is saved tab URL then node URL then default. Added regression executing the actual initializer expressions for saved runtime URLs, missing declarations, fallback URLs and about:blank.
- Closed the saved desktop normally, waited for its launcher process to exit, rebuilt/relaunched, and reopened the seven-node QA Flow. The Browser reopened the local fixture without retyping its address; captured article Content, the AI upstream entry and inserted prompt chip all survived. Saved canvas viewport reopened at 54%. Browser page scroll position reset to the top; preservation of scroll position is not certified.
- Fresh typecheck/lint, six planned scripts, navigation/rich-text, desktop build:all, packaged-renderer smoke test, isolated Electron presentation test and diff check passed. Full AI streaming/cancel/retry, Request/Group continuous scenarios and exact visual zoom-tier acceptance remain open.

### Browser navigation failure and retry state — 2026-09-17

- Main-frame load errors now stop the loading overlay even before the first dom-ready event. Aborted navigations and failed subframes do not mark the whole Browser as failed. A new load clears the preceding error; Chromium error-document readiness does not overwrite a recorded navigation failure with ready. Capture is disabled while loading or when the tab is in error.
- Regression executes the actual component event handlers and loading expression: initial load, aborted navigation, subframe failure, main-frame failure before readiness, error-page readiness, and successful retry. All passed, along with typecheck/lint, navigation/rich-text, six planned scripts, desktop build:all, isolated Electron presentation and diff checks.
- This turn did not perform native offline/error/retry interaction. That desktop acceptance remains pending; the running renderer must reload the newly built output before testing this behavior.

### Request settings boundary placement and restart — 2026-09-17

- Confirmed model, video-mode and generation-parameter menus were always anchored below their summaries. Added shared placement that flips upward when necessary, clamps to the canvas/window working rectangle with side-panel insets, limits scroll height and width, and converts screen coordinates back through content layout zoom. Open menus follow canvas/window changes; closed menus and unmounted nodes have no pending measurement frame. Existing details-based outside-click/Escape behavior remains intact.
- Added executable placement regression at 10/25/50/100/150/250/400 percent, both alignments, offscreen anchors and panel boundaries. DOM binding tests cover toggle, upward placement, 50-percent coordinate conversion, moving anchors, panel avoidance, close and cleanup. These use synthetic layout measurements and do not prove browser layout or native hit testing.
- All planned automatic checks passed: desktop build:all, Web typecheck/lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer and diff check. Rich-text and isolated Electron Browser presentation checks also passed; only existing bundle-size/line-ending warnings were reported.
- Normally closed the saved eight-node QA desktop, confirmed its Electron process exited, rebuilt and launched the desktop, then reopened Canvas compatibility QA with native clicks. At 54 percent, the Request image variant and generation parameters survived: reopening its parameter menu showed High still selected. Browser fixture, captured Content and AI input reference remained visible. The packaged renderer/webview bridge smoke test passed after restart.
- Native bottom-edge placement acceptance remains open: two attempted border drags did not establish movement of the Request node (the second focused the overlapping Browser). Do not count those attempts as a passing drag or bottom-edge menu test. Native exact zoom tiers, panel combinations, Browser error/retry and real generation chains remain pending.

### Native bottom-edge menu layering and Browser recovery — 2026-09-17

- Reobserved the QA Flow at 54 percent and dragged the Request using the inside of its top border (screen y=389 rather than y=386). The node moved to the bottom edge and persisted there across a normal desktop restart. Earlier missed coordinates do not establish a stacking defect; low-zoom border usability remains a broader acceptance item.
- Opening the bottom-edge parameters menu did flip it upward, but native inspection revealed the node hover toolbar covered its aspect/quality rows. Fixed the lifted content order while a marked details menu is open: it is above its own shell/toolbar only for that open state, reverting when closed. The content remains outside the scaled WorldLayer and no document/runtime schema changed. Added a wiring guard to the navigation verifier; this guard alone is not visual proof.
- After saving, normal exit, a fresh build:all and desktop relaunch, reopened the Flow and repeated the bottom-edge menu test. All parameter rows were visible above the toolbar. A physical click on the previously covered Low quality option changed the selected state and dirtied/saved the document. Wheel input over the menu kept canvas zoom at 54 percent. Escape closed the menu; a physical border drag moved Request back into the visible area, verifying shell interaction was restored.
- Tested Browser failure through actual address click, Ctrl+A, local URL entry and Enter: 127.0.0.1:11338 returned ERR_CONNECTION_REFUSED, the loading overlay stopped, and a failure message appeared. Navigating back to the live loopback fixture on port 11337 restored the article and removed the error without restarting the app. This covers failure after a previously loaded page, not first-mount failure or same-URL service recovery. The raw Electron error string is still a presentation refinement item.
- Fresh Web typecheck/lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer, desktop build:all, packaged renderer smoke test and diff check passed. Full exact zoom-tier, panel/window matrix, six node chains and provider generation acceptance remain incomplete.

### AI model menu boundary and dismissal — 2026-09-17

- AI model selection still used an always-downward details menu and had no outside-pointer/Escape dismissal. Connected it to the same measured node-menu placement used by Request. Shared binding now dismisses only marked menus on outside pointer or Escape, preserves inside interaction and other keys, and removes document listeners during cleanup. Request keeps its prompt-mention dismissal behavior.
- Extended executable DOM regression for inside/outside pointers and Escape versus navigation keys. Fresh typecheck/lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer and diff checks passed. Normal exit/rebuild/relaunch completed build:all and the packaged-renderer smoke check passed.
- In the rebuilt Electron desktop at 54 percent, physically dragged AI to the bottom edge and opened its model selector. The empty-model menu flipped upward, remained readable above the node toolbar, closed with Escape, reopened, and closed with a physical click on the canvas. Then dragged AI back into the visible area; existing upstream entries and prompt variable chip remained visible. This validates the empty menu only: configured long model lists, populated selection and real AI execution still require acceptance.

### Native grouping, movement and drop-in membership — 2026-09-17

- In the live desktop at 54 percent, used a physical blank-canvas marquee around Content type selector and AI, then clicked Group. The group outline enclosed both nodes; dragging its exposed background moved both members together while the Browser and other external nodes stayed in place. Existing AI upstream chip remained visible.
- Physically dragged Request so its center landed inside the group, then dragged the group back. Request moved with the original two members, providing native evidence for drop-in membership and subsequent whole-group movement. This is visual evidence of the movement chain, not a complete persistence or edge-data audit.
- Inspection found GroupContent and NodeShell both rendered an unbind toolbar. Removed the duplicate content-layer toolbar; NodeShell remains the owner of group actions, and GroupContent retains its selectable appearance and background drag handler. Added a regression guard for single ownership. The active desktop in this entry still runs the pre-removal renderer; native verification of the single toolbar must follow a reload/restart. Its low-zoom size and edge positioning also remain open.
- Fresh build:all, typecheck, lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer and diff check passed. QA now contains nine nodes including one group with Content, AI and Request. Unbind, group restart persistence, exact world-coordinate/edge preservation audit and the complete remaining desktop matrix are not yet signed off.

### Group toolbar screen sizing and native lock/unbind — 2026-09-17

- Replaced the separate WorldLayer-scaled group capsule with the existing NodeHoverToolbar. Group identity and unbind now share measured placement, side-panel insets, viewport clamping, inverse canvas zoom and 32px action targets. Only the group-specific unbind action is shown; it explicitly disables while the canvas is locked. The shell retains its original drag, connection and resize hit regions.
- Extended the navigation verifier to guard single ownership, shared placement participation and lock-aware unbind. Typecheck, lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer, build:all, packaged renderer smoke and diff check passed.
- Normally closed the previous desktop (exit 0), rebuilt and reopened the QA Flow: eight nodes remained and the previously ungrouped state persisted. Native marquee and Group click created a group around Content, AI and Request at displayed 54 percent. The new capsule was visibly full-size rather than shrunk with the canvas. Physical lock click produced an accessibility-confirmed disabled unbind button; unlocking and physically clicking unbind removed the group outline while all three members remained at their visual positions. Browser, captured Content and the AI upstream chip remained visible. This is not an exact edge-ID/world-coordinate audit.
- Native evidence inherited from the preceding session also covered reopening the earlier nine-node group, unbind, undo and redo with members visually preserved. This turn independently confirmed persistence of the resulting eight-node ungrouped state, but did not repeat undo/redo.
- Still open: multi-selection node toolbars overlap the Group entry; exact zoom-tier and edge/panel placement acceptance, group rename interactions, six complete node chains and provider-backed generation acceptance. No full-plan sign-off.

### Multi-selection action separation and panel avoidance — 2026-09-17

- Compared baseline FlowEditor NodeToolbar: it includes a selected-node count followed by Group. Restored that count and a separate compact action surface instead of overlaying the Group button on a node toolbar. The selection bar now reserves a screen-space row above member toolbars, clamps horizontally using panel insets, stays inside the viewport, disables grouping while locked and hides during drag/resize. Member actions remain mounted and available; this does not resolve overlap between individual node toolbars when nodes themselves overlap.
- Added executable placement regression across 10/25/50/100/150/250/400 percent zoom, multiple window heights and selections above/below the viewport. Verified that the 40px selection row and 48px member toolbar do not intersect and remain inside the tested viewports. Typecheck, lint, navigation, all five persistence/generation/capture scripts, build:all and diff check passed.
- In the rebuilt Electron desktop at displayed 54 percent, physically marquee-selected Content, Request and AI. The separate bar showed three selected nodes above the Content toolbar, leaving its title and actions unobscured. Opened the left panel and then both panels: the bar and Group button stayed in the available region. A physical click on Group with both panels open created a three-member group, confirmed by the group outline and details panel member count. Native exact zoom-tier, narrow-window and other edge cases remain pending.
- The packaged-renderer smoke check initially falsely rejected the compact toolbar because Save had no body text. Changed its canvas readiness check to require the mounted canvas plus accessible Add and Save buttons, retaining all desktop bridge checks. Re-running against the same dual-panel desktop passed. Ctrl+R did not reload this desktop; used normal exit (0) and launcher rebuild/restart instead.
- QA currently has nine nodes including the three-member group, with both side panels open. Full-plan acceptance remains incomplete.

### Browser navigation, popout and same-URL recovery — 2026-09-17

- Native desktop at 54 percent with both panels open: clicked the local page link to /next, Back returned to /, Forward returned to /next. Clicked the popout icon, observed the separate Browser QA window, physically scrolled its page, then closed only that window. The main canvas browser remained at its own URL and scroll position. This proves the basic independent-window chain, not authenticated website or popup navigation equivalence.
- Navigating to inactive loopback port 11338 showed a full Electron IPC exception. Added a shared browser error formatter: navigation events and rejected requests produce the same short user-facing reason plus ERR code; remote-method wrappers, multiline errors and overly long messages use the action fallback. Security errors retain their code without offering bypass. Added executable formatting regression and supplied the formatter to the existing failure-state test.
- Typecheck, lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer, build:all, packaged renderer smoke and diff check passed. Normal desktop exit/rebuild/restart loaded the change. Repeated failed navigation now visibly shows the short Chinese connection-refused message without IPC internals or the URL.
- Started a loopback-only recovery fixture on the same port and physically clicked Refresh without editing the failed URL. The recovery page appeared and the error disappeared, proving same-URL recovery without app restart. No external service or paid request was used.
- First-mount failure is NOT accepted by this test: reopening after a failed navigation restored the last successful URL /next. Inspection confirmed BrowserSessionManager deliberately persists the successful URL, not an attempted failed address. This behavior requires baseline comparison and a separate first-mount failure fixture; do not count that restart as proof. QA currently retains nine nodes and the browser points to the live loopback recovery fixture; launcher session 76060 remains active. Full-plan acceptance remains open.

### Subframe navigation isolation — 2026-09-17

- Found that the shared did-navigate / did-navigate-in-page handler accepted child-frame events. Added a regression executing the actual handler body; before the fix it failed because a child hash URL replaced the main address. The handler now ignores explicit isMainFrame=false, preserving the main tab URL, error and status; top-level hash changes and did-navigate events without that field still update normally.
- Extended the isolated Electron presentation test with a real iframe and separate child/main hash navigations. It confirmed the guest emits isMainFrame=false for the child and true for the top-level page. This validates the real event contract alongside the handler regression, not a full native desktop user-flow acceptance.
- Build:all, typecheck, lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer, isolated Electron presentation test and diff check passed. The running QA desktop has not been restarted to load this handler change; no claim of a new manual desktop acceptance. Full-plan completion remains unproven.

### Payload-backed text actions — 2026-09-17

- Found that Copy Text read only node.content, whereas parsed/imported nodes can store their actual text exclusively in payload. Document/social/transcript nodes also omitted the action despite containing extractable text. Reparse for text sources likewise ignored payload-only text. These gaps break the Content operation chain without any missing component.
- Copy capability, copy callback and text-source reparse now reuse the existing text resolver. Explicit edited content keeps precedence; parsed text/document/social/video transcript fields provide fallback; image-only content does not gain an empty copy action.
- Added executable tests using actual source functions and the actual async copy callback. The pre-fix regression failed on parsed-content action availability; the fixed version verifies clipboard input, busy reset, empty-text feedback, reparse fallback and edited-text precedence. These tests stub the clipboard write; they do not prove native OS clipboard acceptance.
- Fresh build:all, typecheck, lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer and diff check passed. Native desktop copy/paste and reparse acceptance for these payload-only cases remain pending; current running desktop has not loaded this patch. Full-plan acceptance remains open.

### Native copy/paste persistence and failed reparse protection — 2026-09-17

- In the actual Electron QA canvas at 54.4367% zoom, physically clicked Content Copy Text, focused the visible empty green Sticky editor and pressed Ctrl+V. Accessibility showed paragraphs 1 through 35 in both nodes. A read-only desktop storage check confirmed exact text equality including the final End of test page marker. This captured Content has explicit content, so this does NOT sign off the payload-only clipboard case.
- Physically clicking Reidentify exposed a real failure: without the content parsing service, the parser returned a partial empty document preview, yet the toolbar reported success and changed the captured text node title/category. The localhost source itself returned HTTP 200; the failure was the configured parser path, not fixture availability. Undid that operation through the canvas Undo button and verified the original title/editor returned while pasted Sticky text remained.
- Added opt-in preserveOnFailure to the import adapter, enabled for both URL/text and file reparse paths. Failed partial parses now throw before applying a node patch, retaining resources or committing history; initial imports may still create retryable previews. PREVIEW_ONLY and REMOTE_PARSE_PARTIAL remain valid partial results and are reported as incomplete rather than full success.
- Added executable adapter regression covering failed-reparse no-write behavior, initial preview import and valid complete/partial results, plus wiring checks for both toolbar reparse branches. Build:all, typecheck, lint, navigation, autosave, session exit, runtime persistence, generation selection, capture materializer, packaged renderer smoke and diff check passed.
- Closed the desktop normally (launcher 60519 exited 0), rebuilt and reopened through launcher 95560. Native reopening restored the pasted Sticky body. Repeated Reidentify now reported failure with original content retained; original Cnote Browser QA title and rich editor remained. Read-only persisted QA verification confirmed nine nodes, four edges, text category, exact Sticky/Content body equality and unchanged zoom. This proves copy/paste persistence and this failure path, NOT successful URL reparse or the entire Content chain.
- Remaining: successful parsing-service reparse, payload-only native copy, download/split/resource restoration and the full zoom/window matrix. Toolbar status text is truncated at this width; full error discoverability and success/error styling still need review. No real provider request or unrelated user document was used. Full-plan acceptance remains open.

### Payload-only Content follow-through — 2026-09-17

- The preceding desktop session imported a synthetic three-line TXT document, copied its payload-backed text through the toolbar, pasted a second Content node, and reopened the Flow with both nodes retained. Read-only storage inspection recorded a file-backed document payload without an explicit content field. This evidence is scoped to that local TXT fixture, not every media category.
- That session exposed successful reidentify changing the document category to text. Current reparse calls now retain node.category and preserve clipboard-image source identity; executable callback regression covers URL, file and clipboard-image paths. Post-fix native reidentify remains pending; the earlier successful copy/paste does not certify this fix.
- Shared contentNodeText now supplies toolbar, AI and Request text inputs from parsed payloads, preserving explicit edits. Actual reader/adapter regressions cover payload-only documents, social body, video transcript, replacement cleanup and identity preservation. Real provider execution remains unverified.

### Toolbar operation feedback — 2026-09-17

- Removed unconditional error styling from toolbar messages. Informational and successful results use the existing neutral token; copy/download/refetch/reidentify/restore failures explicitly use error styling. Error messages remain for six seconds instead of 1.8 seconds.
- Truncated messages now expose the complete text through a native title, and the polite status region is atomic for accessibility. This retains the compact toolbar rather than adding a separate feature panel.
- Executable regression invokes the actual feedback callback to verify tone, replacement-timer cancellation, error duration and expiration. Source assertions cover the full-message title and conditional styling; these assertions do not prove native tooltip placement or appearance.
- Fresh navigation, generation-inputs, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer, typecheck, lint, build:all and diff checks passed. Build emitted the existing large-chunk advisory. Native visual acceptance of this feedback change remains pending; the full compatibility goal remains incomplete.

### Native document reidentify and feedback follow-up — 2026-09-17

- Physically clicked Reidentify on the original TXT document in QA sticky at 100% zoom. It displayed success and retained the monospaced document body instead of converting to the rich text editor. Read-only desktop storage confirmed node 1KcbFQLktUidhYtXXjZkt retained category document, file source and document payload, without an explicit content field; the pasted text node remained present.
- Closed Electron normally; launcher 43226 exited zero. Rebuilt and reopened through launcher 43111. Packaged renderer/webview bridge smoke passed. Opened QA sticky through the desktop dashboard and confirmed both nodes and their three-line bodies survived.
- Repeated Reidentify after the restart. The success message visibly used neutral styling instead of red, while the document body remained intact. This certifies the local TXT success case only; failed-result tooltip presentation and remote parser success are not certified here.
- Native wheel input over the document body left the displayed canvas zoom at 100%; the same 480 downward delta on blank canvas changed it to approximately 49%. The document shell/content stayed aligned in that snapshot and the minimap viewport expanded. This is not the full fixed-tier or long-document scrolling matrix. Current desktop is left open on this synthetic QA Flow.
- Full-plan acceptance remains open, including six-node-type fixed zoom tiers, window/panel combinations and real AI/Request provider chains.

### Native panel navigation exposed toolbar zoom interpolation — 2026-09-17

- Opened the left node panel and then the right detail panel in the desktop QA Flow at approximately 49%. The controls moved beside the left panel, the minimap moved left of the right panel, and the top toolbar compacted to icons without overlapping either panel in the observed 1442-by-962 window. Fit-view remained clickable and fitted the two nodes at approximately 71%. This is a two-Content-node, light-theme sample, not all panel/window combinations.
- The immediate fit-view screenshot exposed the node toolbar temporarily expanding to roughly 608px before settling near 418px. Its inverse scale inherited the shared 140ms transform transition while the world zoom updated immediately. This caused transient incorrect button size and position even though settled zoom tests passed.
- nodeToolbarScaleStyle now explicitly transitions opacity only, so inverse scaling and placement update synchronously with the world layer. Regression asserts this for 10%, 25%, 50%, 100%, 150%, 250% and 400% calculated styles.
- Fresh navigation, typecheck, lint, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer, diff check and build:all passed. Normally closed launcher 43111 (exit zero), rebuilt/reopened with launcher 69614, and passed the packaged-renderer smoke.
- Native wheel zoom after reopening changed approximately 71% to 146%. The immediate screenshot retained the compact toolbar rather than the earlier inflation. Read-only renderer measurement confirmed transitionProperty=opacity and every action hit box approximately 32 by 32 CSS pixels. This is native zoom evidence plus computed geometry, not a frame-by-frame proof of every transition. Full compatibility acceptance remains open.

### Native narrow-window and maximize/restore panel safety — 2026-09-17

- Used the native Windows Size menu to narrow the Electron window; read-only renderer inspection confirmed a 1024-by-962 client area. The title compacted to its edit icon while Add, Save, import/export and panel controls stayed visible. An initial border drag did not resize the window and is not counted as resize evidence.
- Opened the left panel at the narrow width. The right-panel entry became disabled with the explicit width-insufficient tooltip. Closed the left panel and opened the right: the left entry was then disabled with the corresponding explanation. Fit-view stayed operable and brought both Content nodes into the area left of the right panel at approximately 57%. The leftmost node still partly sits behind the vertical control strip; this sample does not certify unobstructed access to every node edge after fitting.
- Switched to dark theme through the actual canvas control. After transition settling, node text, top actions, panel and minimap remained visible in this sample. No claim is made about all node-type contrast states.
- Maximized the desktop, opened the left panel alongside the existing right panel, then restored the saved narrow window. The left panel closed automatically; the right remained open, top controls stayed separated, and the minimap moved back beside the right panel. Read-only renderer inspection confirmed dark theme, left disabled/pressed=false, right enabled/pressed=true, and Add/Save enabled.
- These are native window/panel safety observations on the two-Content QA Flow. No source implementation changed in this pass, and no automated gates were rerun solely for these observations. Fixed-tier six-node acceptance, control-strip fit clearance and provider-backed chains remain open. Desktop remains running in the narrow dark-theme QA view.

### Fit-view control-strip clearance verified on desktop — 2026-09-17

- Fit-view now reserves the vertical control strip occupied width (24px offset plus 48px width), followed by 40px breathing room, in addition to the left-panel inset. General viewport insets and pointer-anchored zoom are unchanged.
- The navigation regression extracts and executes the actual handleFit callback with production bounds helpers. It covers 1024/1440/2048 viewport widths and each left/right panel combination, checking both node bounds against the reserved horizontal space. A fresh navigation run passed after native verification.
- Recovered the existing running Electron window without restarting it. Used the Windows Size menu to create a 1024-by-962 client area, opened the right detail panel, and physically clicked Fit. In the dark-theme two-Content-node QA Flow, the leftmost shell starts at x=111.99999, leaving approximately 40px after the control strip right edge at x=72. The rightmost shell ends at x=598, leaving the intended margin before the panel. Both nodes are visible at displayed 50 percent.
- This closes the specific narrow-window/right-panel control-strip overlap found in the preceding entry. It does not certify all six node types, toolbar collisions, top/bottom overlay exclusion, extreme zoom, or provider-backed chains. The previous continuation reported the full automated gates and rebuilt renderer passing; this pass reran navigation only and supplies the missing native evidence.

- Additional native counterpart: closed the right panel, opened the left panel, and physically clicked Fit at the relocated control strip. At the same 1024px width, measured controls x=308..356 and leftmost shell x=396, again exactly 40px clearance; rightmost shell ends at x=984 (40px window margin), with displayed zoom 61 percent. Both nodes remained visible. Diff whitespace check also passed (only existing LF/CRLF normalization warnings).

### Native connection outer-handle regression and repair — 2026-09-17

- In the two-Content QA Flow at displayed 61 percent, physically dragged an output connection into blank canvas: the AI/Content/Request continuation menu appeared and Escape dismissed it. A subsequent release on the left edge of the existing target incorrectly opened the same blank-canvas menu. The target handle extends outside the node body, while connection targeting only tested body bounds.
- Connection movement and release now share a connection-specific stacked hit test including the input handle circular radius of 32 world pixels, matching the baseline 64px handle. Ordinary node selection hit testing remains unchanged. Candidate connection handles become visible for valid/invalid feedback even while pointer capture prevents ordinary hover. Self-loop, disabled-target and duplicate-edge validation is unchanged.
- Executable regressions cover outside-half hits through production coordinate transforms at 10/25/50/100/150/250/400 percent, the radius boundary, true blank space, circular corners, output-side exclusion, overlapping stack order and disabled targets. Wiring checks verify move/release share the new hit test.
- Typecheck, lint, navigation, document autosave, session exit, runtime persistence, generation selection and capture materializer passed. Normally closed launcher 14112 (exit zero), rebuilt via launcher 62846 (build:all passed), reopened the same Flow, and passed the packaged renderer smoke. Diff check passed.
- Native post-fix release approximately 10 screen pixels outside the target left edge successfully created the intended edge rather than a continuation menu. Read-only persisted document inspection confirmed exactly two nodes and edge fQJxoK7NgiQYEIQdvYS0e from 1KcbFQLktUidhYtXXjZkt to C3UofpDlF9iPHhXYhTaUA. Repeating the same drag displayed the rejection message and retained exactly one edge.
- Physically moved the target right; the visible curve followed its new input position. Clicked the curve: it highlighted and displayed the disconnect button. Physically locked the canvas; read-only DOM confirmed the disconnect button disabled. Unlocked afterward. No deletion was performed, so this is not evidence for native deletion/undo. Intermediate drag-frame target glow and cancellation while the pointer is held remain unverified; the full six-node/zoom/provider acceptance remains open.

### Minimap navigation and resize history continuity — 2026-09-17

- Native dark-theme two-Content scene: wheel delta 480 over the minimap left the displayed zoom at 61 percent and the scene unchanged. Clicking the first minimap node brought it near the view center; dragging to the second node centered that region without changing node sizes or displayed zoom. Read-only measurement confirmed the minimap remains 280 by 180 CSS pixels. These observations do not prove exact subpixel click mapping or every pan frame.
- Physically enlarged the connected text node by approximately 100 by 60 screen pixels. Its world size changed from 540 by 430 to 705.136 by 529.082 at zoom 0.605561277; the edge followed the input midpoint and the minimap rectangle enlarged. Shell/content geometry agreed within 0.01 CSS pixel in this sample; the synthetic text and edge identity remained intact.
- Native Undo exposed a compatibility defect: undoing the size change also jumped back to the view before minimap navigation. Baseline 97d15d4 use-flow-store undo/redo only restore nodes and edges, not the camera. Current graph-store undo/redo incorrectly assigned the history document viewport to the live view. Removed those two assignments while preserving immutable document snapshots and the existing persistence merge of live view.
- Added a regression that failed on the pre-fix store, then passed after repair: resize undo/redo restores dimensions while preserving three independently chosen pan/zoom views and leaving history viewport snapshots unchanged. Fresh typecheck, lint, navigation, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer and diff check passed.
- Normally closed launcher 62846 (exit zero), rebuilt through launcher 93426 (build:all passed), and passed packaged renderer smoke. Reopened the same Flow, navigated through the minimap, resized, then physically clicked Undo and Redo. Both kept the view fixed; persisted read-only inspection after each confirmed x=-175.0168142857998, y=233.7116923066461, zoom=0.6055612770339855. Undo restored 540 by 430; Redo restored 705.1360544217687 by 529.0816326530612. The same edge fQJxoK7NgiQYEIQdvYS0e remained in both states.
- This verifies the connected Content resize/history chain and minimap navigation at one zoom. Six-kind fixed-tier visual acceptance, exact minimap edge mapping, full drag-cancel paths and real provider chains remain open.

### Six-kind low-zoom geometry and Content scrolling — 2026-09-17

- Reacquired the unique existing Cnote window and activated only Cnote after the initial capture showed another application. No input was sent to that other application. The main Canvas compatibility QA Flow contains nine nodes spanning all six kinds; dark theme, approximately 1442 by 962 window, both panels closed.
- Read-only renderer geometry measured scale 0.254248 (displayed 25 percent), not exactly 0.25. All nine shell/content x, y, width and height differences were below 0.01 CSS pixel. This proves geometric alignment for this sample only: existing overlapping placement obscures some AI, Sticky and Group content, so it does not prove their visual usability or button access.
- Physically clicked the captured Content node edge near (1204,395). Its selected outline and floating toolbar appeared. Read-only measurement found the five icon buttons approximately 32 by 32 CSS pixels, with title and aria-label present; the toolbar title is a separate text control. No destructive or provider action was invoked.
- Physically scrolled delta 480 inside that Content body near (1143,374). Visible text advanced; its scrollTop became 324.0935, while the world transform remained exactly translate(764.096px, 305.528px) scale(0.254248). This closes this low-zoom Content scroll-isolation sample, not all six node kinds or settings menus.
- No application source changed in this pass. Automated build/type/lint results from earlier entries are not represented as fresh runs. Remaining exact-tier, window, theme, overlap and provider requirements stay open.

## Requirement-Level Completion Ledger

This ledger supersedes broad historical status labels. Each row remains incomplete until its entire stated scope has corresponding evidence. Earlier chronological entries retain the concrete scenarios and limitations; do not infer a pass from absence of a recorded defect.

| Plan requirement | Current evidence and status | Evidence still needed |
| --- | --- | --- |
| Baseline extraction and three-way difference classification | Partial: historical source comparisons and individual repairs recorded | Complete baseline dimensions, button conditions and behavior inventory; classify every difference as restore, architecture-equivalent, or explicitly accepted new behavior |
| Architecture invariants | Implemented constraint; not a final audit | Inspect final document serialization, runtime boundaries, absolute grouping and active-content retention against all constraints |
| Unified hover/selection/drag/resize/connect state | Partial desktop and handler evidence | Six-kind cross-layer pointer travel, toolbar gaps, handle entry, runtime-active/disabled states and cancel paths |
| Wheel and pointer boundaries | Partial desktop evidence for Content, selected menus/panels and minimap | Long AI/Request/Browser scroll, Space/middle native pan, continuous pointer anchoring and exact 0.1/4 clamps |
| Complete connection lifecycle | Partial: outer-handle success, duplicate rejection, blank menu/Escape, selection and lock | Self/invalid visual feedback, in-flight snap/cancel, blank-release creation variants, deletion/undo with action-time confirmation |
| Toolbar, panels and responsive layout | Partial: narrow panel exclusion, maximize/restore and fit horizontal clearance | Baseline button inventory, all panel combinations/themes, overlay top/bottom clearance and complete accessible states |
| Canvas controls | Partial implemented and native samples | Every control result, disabled/pressed feedback, baseline visual measurements and zoom percentage across required configurations |
| Minimap | Partial: 280x180, click/drag, wheel isolation, resize update | Exact centering/clipping, stable bounds during pan/zoom, both-panel placement and many-node recomputation behavior |
| Six-kind appearance at 25/50/100/150/250 percent | Partial geometry at actual 25.4248 percent; prior isolated samples | All five tiers per kind, visible content/chrome, default/minimum sizes, clipping and separate node/canvas scale behavior |
| Conditional hover toolbar actions | Partial: several native Content/Group actions and 32px Content buttons | Exhaustive six-kind resource-state action matrix, edge flipping, narrow layout, stable hover travel and missing-resource actions |
| Internal settings collection | Partial AI/Request placement evidence | All six kinds, maximum height/scroll, state retention after close, editing isolation and clipping at every required zoom |
| Copy/Alt-drag/group spatial operations | Automated store/handler evidence plus isolated desktop samples | Native single/multiple 40px bounds, Alt-copy/cancel, group center-drop/unbind/member deletion variants, edge preservation and one-step history |
| Sticky continuous scenario | Partial editing/pin/resize/restart evidence | One recorded create/edit/color/resize/copy/delete chain; deletion requires action-time confirmation |
| Browser continuous scenario | Partial navigation/recovery/capture/Content/upstream association | Full scrolling/navigation controls and continuous capture-to-AI chain, including downstream send and restart |
| Content continuous scenario | Partial import/reparse/failure preservation/text scrolling | Media download/split/missing-resource restore and downstream association through restart |
| AI continuous scenario | Configuration/upstream observations, not provider acceptance | Approved usable provider/model/test spend; real stream, cancel, retry, association and restart |
| Request continuous scenario | Automated selection/materialization evidence, not provider acceptance | Approved provider/model/test spend; batch progress, real outputs, retained historical results and restart |
| Group continuous scenario | Partial toolbar plus automated membership/history evidence | Native select/group/move/drop/unbind/member retention sequence and persisted absolute coordinates/edges |
| Desktop acceptance environments | Several isolated normal/narrow/maximized, dark/light, panel samples | Cross-check empty/single/multiple/offscreen nodes, canvas/panel edges and continuous min-to-max zoom; explicitly record untested combinations |
| Automated gates and final regression | Previous passing runs recorded chronologically | Fresh complete gate run against final source, inspect test coverage, then native regression of changed surfaces |
| Final delivery and rollback points | Prior batch committed and pushed as 60f9c9b; current follow-up changes await user manual acceptance | Full baseline inventory deferred by user; current UI choices supersede baseline. Do not claim native completion from scripts or commit this batch without a new request. |

Provider approval is an external dependency for real generation only. It does not block remaining canvas, layout, geometry, history, grouping and non-destructive native checks. UI deletion is a separate action-time confirmation dependency and must not be silently executed on QA data.

### Minimap padding-box inverse mapping repair — 2026-09-17

- Source inspection confirmed that minimap nodes are absolutely positioned relative to the padding box, but locateFromEvent subtracted only the outer bounding rectangle. A one-pixel border therefore displaced the requested world center by 1/scale on both axes. At map scale 0.1075 this is approximately 9.30 world pixels; it is distinct from native pointer rounding or panel-center calculations.
- Added a regression that extracts and executes the production locateFromEvent callback, covering borders of 0/1/2 pixels, fractional screen origins, three map scales and three rendered local positions. It failed against the original locator on the border-offset assertion, then passed after the fix.
- The locator now subtracts currentTarget.clientLeft/clientTop before mapping to world coordinates. Both click and pointer-captured drag already share this callback. No document, zoom, map-size, bounds or history behavior was changed.
- Fresh navigation, typecheck, lint, document autosave, session exit, runtime persistence, generation selection, capture materializer and desktop build:all passed. Build retains the existing bundle-size advisory.
- Native reacceptance of this particular repair is pending: the existing desktop renderer was not restarted in this pass, and its earlier navigation observations do not certify the newly built code. Full minimap bounds/clipping and six-kind acceptance also remain open.

### Baseline size audit and missing text download recovery — 2026-09-17

- Native restart was not performed: window captures showed another foreground application and the controller subsequently reported concurrent user input. No click, keypress, close, or deletion was issued after those observations. Minimap native repair acceptance remains pending; source work continued instead.
- Compared baseline 97d15d4 node-dimensions.ts with current constants and factory defaults: Sticky 300x240/min240x210, Browser 920x620/min680x460, AI 460x510/min460x340, Request 540x430/min540x430, Content 540x430/min420x300 match. Baseline GroupNode minimum160x120 also matches the Provider minimum. These are source-level size invariants, not proof of rendered min-size enforcement or all content clipping.
- Found a must-restore baseline omission: NodeChrome downloadContent exported text-category Content nodes as TXT for plain payloads and Markdown otherwise. The migrated toolbar capability only allowed assets or media URLs, leaving ordinary text nodes without this download action. Restored text-category capability, a Download Content label and export through the existing saveBlobToFile desktop save path. Media behavior is unchanged.
- Export reads current edited node.content before payload.value, preserves explicitly cleared content and whitespace, sets the matching MIME and extension, and sanitizes the filename. The graph and parsed payload are not changed. This replaces the old source-text storage lookup with the new document content field while preserving the user result.
- Added production-function regression coverage for Unicode/newlines, Markdown, edited-versus-stale payload, explicitly cleared text, no-payload fallback, MIME/extension/filename, graph immutability and non-Content exclusion. No real save dialog or file export was invoked by these mocked-save tests.
- Fresh desktop build:all, typecheck, lint, navigation, autosave, session-exit, runtime-persistence, generation-selection and capture-materializer passed. The bundle-size advisory remains. Native text save/cancel and reload verification are still required, as is the rest of the conditional-toolbar inventory.

### Parsed-media download parity repair — 2026-09-17

- Continued the baseline NodeChrome download comparison: the old image action resolved the first parsed media item and saved fetched bytes through saveBlobToFile. The migrated action inspected only node.assetId/source and used an anchor with target=_blank for remote media. Payload-only media could lack a download action, while a split node retaining its source could download the original asset or source page instead of its media. These are must-restore behavior gaps, not accepted new behavior.
- Resource resolution now prioritizes the first parsed image/video media item, preserving the baseline first-item rule. Its resourceId maps through the existing asset-store adapter; resource URL, MIME and filename are read from that same item. An item does not fall back to an unrelated original node asset. Nodes without parsed items retain their existing source/asset fallback.
- Both local and remote downloads now fetch bytes via desktopFetch and use the established save dialog. A missing local resource can fall back to the same item URL; non-success HTTP responses do not save bytes. If metadata lacks an extension, the response MIME supplies it. No real external download was issued in this pass.
- Production-function regression covers first-item priority over a stale original asset, resource-id mapping, local URL preference, missing-local remote fallback, response MIME extension, declared filename, unchanged document data, HTTP failure and save cancellation. These tests use stubbed network/storage/save boundaries, not a native save-dialog acceptance claim.
- Fresh build:all, typecheck, lint, navigation, document-autosave, session-exit, runtime-persistence, generation-selection, capture-materializer and diff check passed. The existing bundle-size advisory remains. Native remote/local media save, text save, minimap repair reacceptance and full media splitting/restore scenarios remain pending.

### Atomic media split history repair — 2026-09-17

- The migrated toolbar called addNode for every split output, each committing history, then separately changed the source payload and committed again. One Undo therefore restored a multi-resource source while leaving split outputs present. This contradicts the required single structural-operation history boundary.
- Moved splitting to graph-store splitMediaNode: validates the current document and lock state, resolves the current node rather than stale toolbar data, writes the source first-item payload and all independent outputs in one immutable document update, then commits exactly once. Existing edges and original node identity remain unchanged. New outputs retain absolute positions and a 40px horizontal outline gap, clear source-library/favorite flags, and do not inherit a parent group when positioned independently outside it. Original group membership is unchanged.
- Image and video real-store regressions cover three-resource split, item identities, active indexes, generated provenance, original-input immutability, one-step undo restoring all source resources/removing outputs, redo restoring the same output identities, unchanged edges, locked rejection, missing-node rejection and one-resource no-op without history pollution. The toolbar calls the tested store action and reports success only when it changed the document.
- Fresh desktop build:all, typecheck, lint, navigation, autosave, session-exit, runtime-persistence, generation-selection and capture-materializer passed. Build retains the existing bundle-size advisory. No native deletion or provider operation occurred. Desktop split/undo/redo and persistence of a split media fixture remain pending, not covered by store tests.

### Missing-resource recovery condition and reference cleanup — 2026-09-17

- Baseline NodeChrome treats state=missing as a lost resource. The migrated restore button checked error or absent payload only, so an explicitly missing node with a retained preview/payload could lose the recovery entry. Added missing to the tested capability helper without changing the existing error/asset fallback.
- Library restoration previously patched source/payload without replacing node.assetId, allowing a stale top-level asset to override the restored source. It also lost source-only text when no parsed text payload existed. Restoration now explicitly sets or clears assetId/content as a pair, uses payload text when available (including an intentional empty value), and otherwise preserves source text. Geometry, identity and edges are not modified by this patch.
- File restoration now preserves the chosen category and invokes the existing preserveOnFailure path rather than silently replacing good content with an empty failed parse. This is not a claim that every missing-resource path is resolved: local availability, real library recovery, file selection and native save/restart still require desktop checks.
- Focused production-helper tests cover missing/error states with retained payload, ready/non-Content exclusion, stale asset/text cleanup for file/clipboard/URL/text sources, and empty/parsed text precedence. Fresh build:all, typecheck, lint, navigation, autosave, session-exit, runtime-persistence, generation-selection and capture-materializer passed. No desktop input was performed in this pass.

### Parsed and split media downstream references — 2026-09-17

- Audited the media path beyond download. Request contentNodeReferences read only node.assetId/source, ignoring parsed payload.resources. Consequently parsed multi-media and split outputs could pass the stale original asset or a webpage to downstream generation, despite holding distinct media payloads.
- When a nonempty image/video resource list exists, derive references from those items in order, including resource IDs, MIME, filenames, labels and upstream node identity. Local IDs take precedence for transport classification; source-level fallback remains for nodes without a resource list. Image generation still filters out video/audio references. Request-owned result collection uses the same resolver. These references remain derived runtime inputs, not new persisted runtime objects.
- Added tests in verify-generation-inputs for stale-asset/source-page exclusion, multiple resources, mixed local/remote media, a split one-item node, input identity, image/video filtering and source immutability. All tests use fixtures; no external generation or paid request occurred.
- Fresh generation-inputs, six planned scripts, typecheck, lint and desktop build:all passed. Native downstream reference chips and actual submission remain unverified. A separate source audit found ContentContent useResolvedMediaSrc still prefers node source/asset over parsed media; its displayed-media path remains a known open defect to address next, not covered by this downstream fix.

### Active parsed-media display resolution — 2026-09-17

- Fixed the known display-path defect: image/video rendering now resolves the active parsed media item before any node-level original asset/source. Resource IDs use the asset adapter; an unavailable item does not display an unrelated original webpage, asset or thumbnail. Source fallback remains for nodes without parsed resources. Invalid active indexes are bounded or defaulted to the first item.
- For parsed video items, stale original YouTube/provider-preview metadata no longer takes over the player. Source-only videos prefer their parsed video URL over the origin page. Async display state is keyed to media identity and asset hash, preventing previous-item state from being used for a newly selected or split item while loading.
- Production resolver tests cover image/video active items, local IDs, remote items, invalid indexes, split one-item payloads, missing items, legacy file fallback, parsed video URL precedence and document immutability. Wiring assertions are not a native player or asynchronous-race test.
- Fresh build:all, typecheck, lint, six planned regression scripts and generation-inputs passed. No native input or real media fetch occurred. Desktop image/video playback and restart acceptance remain pending. Baseline audit additionally confirmed a missing multi-resource selection rail (click/drag-to-preview) in the migrated ContentContent; restoring that control is still open and is not claimed by this resolver repair.

### Multi-resource selection rail restoration — 2026-09-17

- Restored the baseline image/video resource rail using the existing media-resource-rail and media-resource-capsule CSS rather than a new visual pattern. Multiple resources expose numbered/labeled buttons with tooltip, aria-label and pressed state. The node outer surface allows overflow for the external rail, while the body remains in its own rounded clipping container.
- Clicking a resource selects its persisted activeResourceIndex. Dragging a capsule into that node preview uses the baseline custom MIME type; added node identity validation so a capsule from another node cannot silently select an unrelated same-index item. Invalid JSON, mismatched identity/kind, fractional/out-of-range indexes are rejected. Pointer/wheel boundaries prevent rail controls from starting node drag or canvas zoom.
- Selection resolves the live document, commits one history change, and avoids repeated history for a no-op or invalid item. Real-store tests cover image/video selection, one-step undo/redo, unchanged world position, malformed/cross-node drops and JSON round-trip reopening of the selected index. This in-memory round trip is not Electron restart evidence.
- Fresh desktop build:all, typecheck, lint, six planned scripts and generation-inputs passed. Native rail click/drag, edge and panel clipping, all zoom tiers and actual restart remain pending. This closes the missing control implementation, not desktop visual/interaction acceptance.

### Rebuilt desktop launch and native controller recovery limit — 2026-09-17

- Reobserved and activated the existing Cnote window; screenshot showed the main nine-node QA Flow, saved state, dark theme and displayed 25 percent. Issued normal Alt+F4 only to that uniquely selected Cnote window. Launcher 93426 then exited with code zero.
- Started launch-dev.mjs as session 70417. Its fresh build:all passed and Electron started with a new debugging endpoint. Packaged renderer and webview browser bridge smoke passed against the running instance. Read-only renderer inspection confirmed desktopBridge=true and loaded index-B4eDAjPy.js, matching this newly built artifact.
- Read-only storage inspection after restart confirmed Flow 1dZvkfEO1-7pRSysgjrHL retains nine nodes, four edges, all six kinds and viewport x=764.0955548722314, y=305.52767720112706, zoom=0.2542475952137122. This confirms this document survived normal shutdown, not the still-unperformed media operations or real generated outputs.
- Native controller rediscovery returned stale window 4723154. The stale-handle error listed a new Cnote window 15864894, but selecting it failed with foreground window did not report a process id. Refreshed window/app discovery did not establish a usable current target. No input was sent with stale coordinates after the failure. Do not classify the running Electron as stopped: session 70417 and its live renderer endpoint were confirmed.
- Native minimap, text/media save, resource rail and split acceptance remain pending despite the new build being running. This is a native automation access limitation for the current pass, not a whole-project completion or blocked-goal declaration; source/test audit can still proceed.

### Native controller recovery, zoom limits and text-save cancellation — 2026-09-17

- Reset only the JavaScript control session and reimported the supported sky package. Fresh window discovery returned the correct existing Cnote window 15864894; screenshots and native input resumed without another app restart. The controller limitation from the previous entry is resolved for this pass.
- Physically opened the main QA Flow from the dashboard. A minimap click moved the scene; this observation is navigation evidence only, not exact subpixel centering. The synthetic Browser fixture now reports ERR_CONNECTION_REFUSED at its local recovery URL, so it is not counted as a successful live-browser scenario.
- Native wheel on blank canvas reached displayed 10 percent; read-only world transform confirmed exact scale(0.1), with minimap still 280x180. Reverse wheel reached displayed 400 percent and exact scale(4). At the maximum, wheel delta480 over the minimap kept the displayed zoom at400. Clicking Fit then restored the nine-node scene at displayed57 percent. This verifies endpoint clamping, minimap wheel isolation and recovery from an offscreen extreme view for this scene; it does not certify every intermediate tier or all node controls.
- Selected the captured text Content node and physically clicked its restored download button. The native Save Cnote File dialog opened with suggested Cnote Browser QA.md and the Cnote text-content Markdown filter. Pressing Escape returned to the selected node, with toolbar controls reenabled and no visible error. No file was written; TXT saving, successful file output and media saves remain pending.
- No source implementation changed and no automated gate results are claimed as fresh in this pass. Remaining resource rail/split/persistence, exact minimap mapping and provider acceptance are unchanged.

### Native Markdown export byte verification — 2026-09-17

- Reacquired the unique existing Cnote window 15864894 and observed its pending native Save Cnote File dialog. Used physical filename-field selection, literal path entry and Return to save the captured text Content node UoeBKex7wfIGjBQg1_S9e. The dialog closed and the canvas and node toolbar returned without a visible error.
- Output: `C:\Users\lhc\AppData\Local\Temp\cnote-text-export-20260917-acceptance.md`. The path was absent before saving, so no existing file was overwritten. Read-only filesystem verification found 1932 bytes. Compared the complete file buffer with UTF-8 encoding of the persisted node's `content ?? payload?.value ?? ''`, read through the desktop storage bridge: exact byte equality passed. SHA-256: `6d434ac1889fe1499ae408a57c510ed51865a5904b5f7afdb2fc7181ea25441b`.
- This supplies actual successful Markdown export evidence, beyond the earlier dialog-open/cancel check. Plain TXT, media exports, resource-rail switching, split/undo/redo and restart continuity remain unverified. The Browser fixture still displays its local connection-refused state; no live Browser success is inferred.
- No application source changed in this pass; previous automated gates are not represented as fresh runs. Full requirement-level completion remains open.

### Restore the direct Content editor entry — 2026-09-17

- Baseline `97d15d4` ContentNode renders an upper-right Maximize2 action labelled 展开编辑器 for text and mindmap categories. The migrated ContentContent had neither action, although CanvasExtensionPanel already contains their editors. Classified as a missing control that must be restored, not an accepted new behavior.
- Restored the 32px icon action for both categories, including title, aria-label and keyboard-focus visibility. Its visibility uses the shared canvas hovered-node/selection state rather than an independent DOM hover. Clicking selects the current node, clears edge selection and opens the existing extension editor; no legacy store, document mutation, or editor instance serialization is introduced. Existing toolbar spacing handling remains responsible for panel clearance.
- Added production-helper regression for text and mindmap: correct target selection, stale edge selection clearing, panel opening, unchanged document identity/history and no-op on a deleted node or unsupported category. This verifies dispatch, not desktop visual placement, focus transfer or edit persistence.
- Fresh build:all, typecheck, lint, navigation, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer, generation-inputs and packaged-renderer checks passed. Existing large-bundle advisory remains.
- Native reacceptance is pending: Ctrl+R refreshed the Browser guest instead of the application, including after a blank-canvas click. Read-only inspection confirmed the host still loads index-B4eDAjPy.js and contains zero expanded-editor actions, while the new build entry is index-B-jd1vSS.js. Do not treat the old host as evidence for this patch. A proper desktop relaunch is required; the observed guest shortcut routing also needs a separate focus-boundary investigation. No destructive operation or provider request occurred.

### Content playback mode and Shorts restoration — 2026-09-17

- Baseline ContentNode has a dedicated audio element for video-category payloads with audio playback. The migrated VideoBody rendered those as video, losing the compact audio control. Restored native audio controls using the resolved local/remote media source, accessible title, and node gesture/wheel isolation. Parsed video-resource selections still override stale source-level audio or YouTube metadata.
- The migrated YouTube helper only handled short-host and watch-query links, missing Shorts/embed/live paths. Added those paths and the legacy /v/ path, requiring an actual YouTube host, HTTP(S) and an 11-character video ID. Lookalike hosts and malformed IDs no longer become YouTube embeds.
- Regression renders the extracted production VideoBody using React server rendering: verifies audio controls/source/accessibility, loading and missing-source branches, Shorts iframe output, and parsed-video precedence over stale audio/embed metadata. Address cases include watch, youtu.be, Shorts, live, embed, /v/, malformed IDs, unsupported protocols and lookalike hosts. These are rendering/logic tests, not native playback or network acceptance.
- Fresh build:all, typecheck, lint, navigation, autosave, session-exit, runtime-persistence, generation-selection, capture-materializer, generation-inputs and packaged-renderer checks passed. Existing bundle-size advisory remains.
- Native window activation failed after a snapshot showed other applications; no input was sent to those applications and no restart was forced. The previous Browser shortcut observation remains unresolved: source inspection did not find an application Ctrl+R handler, so no speculative focus patch was introduced. Latest built entry is index-YEZcGK65.js; expanded-editor and playback native reacceptance still require loading the new build.

### Native expanded-text editor and restart continuity — 2026-09-17

- Reset the controller JavaScript session, reacquired Cnote, closed the old app through its native close button and confirmed launcher 70417 exited normally. Launched through the desktop development launcher; read-only host inspection confirmed index-YEZcGK65.js, not the stale renderer. The earlier native activation limitation was resolved without touching another application.
- In the nine-node/four-edge QA Flow, dark default window at displayed 57 percent zoom, selected captured text node UoeBKex7wfIGjBQg1_S9e and physically clicked its upper-right expanded-editor icon. The right panel opened with the correct title and text. The canvas center and minimap moved to accommodate the panel; this is a single-layout observation, not all inset/window combinations.
- Scrolled delta480 inside the panel editor. Its scrollTop advanced to 259.20001220703125 while the host world transform stayed exactly translate(216.074px, 466.751px) scale(0.571238). This verifies panel text scrolling does not pan or zoom the canvas in this configuration.
- Used native text input at the end of the synthetic captured document to append `Expanded editor persistence QA 20260917`, then closed the panel. Read-only inspection confirmed the node-inline editor contains the marker, persisted node content and payload.value agree, and the document still contains nine nodes/four edges. No existing text was deleted.
- Closed Cnote normally, confirmed launcher 63198 exited with code0, and relaunched via the desktop launcher (current session69698). Opened the same Flow, selected the same Content node, clicked its direct editor entry again and navigated to the end using the keyboard. The marker was visibly retained. Read-only checks confirmed persisted marker=true, payloadMatches=true, panelMarker=true and inlineMarker=true, with unchanged node/edge counts.
- This completes the expanded text editor open/scroll/edit/close/restart sample. Mindmap entry, exact zoom tiers, keyboard-tab access and narrow-window variants remain pending. Audio/Shorts playback, media rail/split/download, Browser shortcut routing and provider-backed scenarios remain open. No application source changed during this acceptance pass; the launcher rebuilt successfully, but earlier type/lint/regression checks were not rerun or relabelled as fresh.

### 2026-09-17 — Media split persistence, native download, and import-name recovery

- Carry-forward media fixture evidence: native import of `qa-media-compat-20260917-a` provided two existing image assets and an AI downstream edge. Clicking the second rail entry switched the preview correctly. Dragging the first entry to the preview did not switch it; this remains unresolved, not a pass. Native split left the first resource on `qa-media-source` and created `NLT8Fja1R3yJnjWOL_c1g` for the second. Their world outline gap was 820 - (240 + 540) = 40px; the original AI edge survived. The new node overlapped the existing AI node. Split undo/redo has not been exercised.
- Revalidated the previous launcher (69698): it had exited with code 0; there was no Cnote window or pending save dialog. The expected media export file did not exist. The local read-only media fixture server (59872, port 11339) remained live. No success was inferred from the interrupted save dialog.
- A fresh native launch exposed a genuine startup failure: Dashboard called `flow.name.toLowerCase()` on the imported title-only schema-2 document. Read-only renderer console evidence confirmed the TypeError. This malformed fixture should not have been accepted without normalization, and an already persisted title-only document should not make the entire dashboard unusable.
- Fixed the common `migrateDocument` boundary used by native import and stored-document reads: keep valid names exactly; recover absent, non-string or whitespace-only names from a nonblank string title, otherwise use `未命名画布`. Normalization is nonmutating and idempotent, preserves unknown metadata, edges, viewport and node payloads, and applies after schema-1 migration as well as to schema 2. No data was deleted or manually patched in storage.
- Extended the production schema regression with both schema versions, six invalid-name values, six title values, valid-name precedence, unchanged input, graph-reference preservation and repeated-load stability. Existing valid current-schema documents retain identity.
- Closed the error screen through Cnote's native close action; launcher 34542 exited 0. Rebuilt/relaunched (25992, bundle `index-RKsT2Po5.js`). Native dashboard rendered all three existing test Flows, including `Media compatibility QA`. Opened that Flow by native click: both split previews loaded, three nodes and the original edge were retained. Read-only persisted inspection confirmed positions (240,200)/(820,200), sizes 540x430, gap 40px, original AI position (950,200), and unchanged edge `qa-media-edge`. The recovered name was persisted by the normal application path.
- Selected the second split node via its border and clicked its native download action. The Save Cnote File dialog proposed `second.ico`. Saved to the previously absent `C:/Users/lhc/AppData/Local/Temp/cnote-media-export-20260917-acceptance.ico` without overwrite. Read-only verification: 13,843 bytes, exact Buffer equality with `desktop/packaging/resources/icon-cnote.ico`, SHA256 `d17833136eddcf73f72d28ed0a257ed2683de7c5c10e9a9fad1366b8187caa9d`. This proves current split-resource download after restart, not all media formats or remote-provider failures.
- Fresh checks passed: desktop build:all, web typecheck/lint, verify-schema, verify-canvas-navigation, verify-document-autosave, verify-session-exit, verify-runtime-persistence, verify-generation-selection, verify-capture-materializer, verify-generation-inputs, desktop verify-packaged-renderer and diff whitespace check. Existing bundle-size advisory remains.
- Still open: media rail native drag failure, Browser shortcut focus, native deletion/undo authorization, complete six-kind/zoom/window acceptance, and authorized provider-backed AI/Request runs. The requirement-level ledger remains partial; this entry does not establish full plan completion.

### 2026-09-17 — User-prioritized eight-screenshot repair batch

- Scope follows the user's concrete opening/editing workflow, not the previous broad priority list. User explicitly requested all reported issues in one delivery and no computer-control acceptance. This batch did not launch or control the desktop; native visual acceptance is delegated through docs/canvas-user-flow-acceptance.md and is not marked passed.
- Empty minimaps use the visible-world center with symmetric aspect-ratio padding; occupied maps retain stable content bounds. Restored viewport-anchored dot grid and blank-only left-double-click CanvasAddMenu using the existing node creation path. Left node panel now starts at the same top inset as the toolbar/right panel.
- Unified node shell/content radius at 24 world pixels, including the Browser's special unscaled presentation. Text formatting is initially hidden and toggled from its capsule; all rich-text format toolbars wrap. Text details use an unframed full-height editor without a repeated text subsection heading.
- AI upstream variables moved outside the node. Its existing model/menu controls are rendered into the node capsule through a React portal; the capsule includes session creation/switching/renaming, system prompt toggle and settings toggle. The initially hidden composer settings row places search/reasoning left and model right. The details panel renders the actual AIContent at panel scale, sharing graph/runtime state and a cross-view sending guard. Runtime session nodeId is optional, persisted/parsed, and used for session ownership; existing active sessions remain accessible.
- Request body now acts only as a one-way chooser. Image/video generation keep distinct variants/labels without switchable type tabs or loss of IDs/configuration/results. Model, video mode and parameter menus moved into the composer action row, left of sending. Removed the decorative image/video glyph inside the prompt area.
- Fresh passed gates: desktop build:all; web typecheck/lint; verify-canvas-user-flow, verify-canvas-navigation, verify-rich-text, verify-schema, verify-document-autosave, verify-session-exit, verify-runtime-persistence, verify-generation-selection, verify-capture-materializer and verify-generation-inputs. New component tests use a fake provider, not external requests. Packaged renderer probe could not connect to the absent desktop debugging port 9222 and is not counted as passed; desktop was not launched to satisfy it. Existing bundle-size warning remains.
- The rest of the full compatibility ledger remains open. No desktop-perfect visual claim, paid-provider claim, or whole-plan completion follows from this batch.

### 2026-09-18 — Model discovery, upstream images, Sticky and annotation follow-up

- Repaired the shared desktop fetch boundary: sensitive headers without a saved reference are written to isolated temporary SecretStore entries, stripped from the network payload, referenced by name, and removed in finally. Saved references are reused without deleting the channel credential. Native sensitive-header validation remains unchanged; no browser-fetch bypass is used for desktop credential requests. Model discovery supports saved/unsaved keys and Google-native versus OpenAI-compatible list endpoints.
- AI sending now resolves local image assets to actual multimodal image bytes; public image URLs remain URL inputs. Current media-resource selection is respected. Both implicit connected inputs and explicit variable chips pass through the resolver; duplicate chips attach one copy of the image. Missing/disconnected resources fail visibly rather than silently sending only filenames. Browser captured text and upstream AI replies are used instead of bare labels where available. Graph persistence still contains resource references, not image bytes or editor instances.
- Moved the five Sticky color choices into the hover capsule with pressed/locked/history behavior. Sticky formatting is scoped to six basic actions; normal Content formatting and existing rich-text documents are preserved. Screen-space background dots now keep fixed spacing, size and position. The blank-canvas add menu follows the user's exact three groups, names and order.
- Fresh passed gates: desktop build:all; web typecheck/lint; verify-ai-upstream-transport; verify-canvas-user-flow; verify-rich-text; verify-schema; verify-canvas-navigation; verify-document-autosave; verify-session-exit; verify-runtime-persistence; verify-generation-selection; verify-capture-materializer; verify-generation-inputs; verify-prompt-mentions. Transport tests use fixture keys and a simulated native bridge. Component tests invoke the actual send handler for connected and chip-based images and exercise Sticky color undo/redo/locking and menu grouping. Existing bundle-size advisory remains.
- No desktop was launched or controlled, no real keys were read, and no real provider requests were sent. Updated docs/canvas-user-flow-acceptance.md contains pending user-operated checks, including actual model lists and vision-capable model recognition after reopen. Full compatibility, real-provider success and native visual acceptance remain unclaimed.

### 2026-09-18 — Markdown replies and unified generation action

- AI assistant messages now use the existing read-only Markdown editor renderer in both the node and its details panel. User prompts and stored/copied raw reply text remain unchanged. Component tests assert actual headings, bold, list, code and table DOM in both views, with no editing or formatting toolbar.
- Replaced the separate start/cancel/resume controls with GenerationActionButton. Idle retains the icon; running shows generating plus elapsed time, with red cancellation on hover or keyboard focus; paused uses the same control with a visible resume label. Switching labels reserves the same width. Existing task snapshot/polling/cancellation paths are reused, not replaced with a new submission on resume. Abandoning paused work remains available inside the parameters menu.
- Typecheck, lint, user-flow component tests, generation-selection, rich-text, upstream transport, persistence, session-exit, autosave, canvas navigation, generation inputs and capture checks passed. Desktop build:all also passed, with the existing bundle-size advisory only. Manual acceptance is appended to docs/canvas-user-flow-acceptance.md; no desktop control, actual provider calls or full-compatibility completion is claimed.

## 本轮 — Streaming, add-menu scope, resource dragging and guest focus

- Implemented actual desktop response streaming through owner-scoped IPC reads, cancellation and lifecycle cleanup; retained SecretStore boundaries and the buffered API for existing callers. AI consumes incremental deltas into one runtime assistant message, supports stopping from either node or details, preserves partial replies, and aborts when leaving the document or deleting the node.
- The top toolbar keeps two buttons, including compact windows. Its left menu contains only 添加内容节点 → 添加请求体 → 添加浏览器节点; the right button directly adds AI. The blank-canvas three-group menu intentionally remains different, following the user's newer requirement.
- Resource capsules now use captured pointer gestures and screen-space preview hit tests, with outside-drop rejection and Escape/cancel cleanup. Browser guest focus is released when interacting with the host, and blank-canvas clicks explicitly restore native host focus without globally intercepting guest shortcuts.
- Fresh desktop build:all/typecheck, web typecheck/lint, ai-streaming, ai-upstream-transport, canvas-user-flow, canvas-navigation, rich-text, schema, document-autosave, session-exit, runtime-persistence, generation-selection, generation-inputs, capture-materializer and prompt-mentions checks passed. Existing large-bundle advisory remains. Tests use mock network/DOM, not live providers or native mouse evidence.
- User-operated acceptance is in docs/canvas-manual-acceptance.md. All current native checks remain pending. No desktop control, real keys or paid requests were used. Full old-version differences are deliberately deferred, and the original whole-project completion is not claimed.

## 本轮截图追加 — Sticky details, text selection, Browser loading and YouTube

- Sticky details use a single flat editor with the same six compact formatting actions, no duplicated title or color selector. Both plain content and the rich-text document are updated together.
- Capture-phase outside pointer handling clears the previous editor selection without suppressing its own formatting toolbar. Cross-node selection clearing also covers other node content regions.
- Browser loading starts only for top-level, non-in-place navigation and is finalized by did-stop-loading as well as DOM readiness. Main-frame failures remain errors; subframe activity no longer reopens the central loading overlay.
- YouTube iframe requests with no valid web Referer receive the packaged Cnote application identifier, limited to the host renderer's YouTube embed subframes. Existing valid referrers and unrelated/guest requests remain untouched. The iframe explicitly preserves the origin referrer policy. Actual playback, including whether the reported 153 is resolved for the user's video, awaits user verification after a full desktop restart.
- Desktop build:all, web typecheck/lint and fourteen regression scripts passed, including the new browser-feedback suite and expanded rich-text/user-flow tests. Native acceptance is in docs/canvas-manual-acceptance.md; no real player success or full project completion is claimed.

## 本轮 — Per-run result batches and grid detach

- Supersedes legacy reusable output slots: each new run creates one connected Content result node; child completions merge into that run's resource list by task/output identity. Prior runs remain unchanged. Late/repeated completions do not duplicate results, recreate a deleted batch or steal the active image selection.
- Expanded/collapsed state and original size are persisted as graph presentation metadata, while live task status remains in runtime. Expanded grids hide the switching rail items and show collapse/detach. Detach is terminal-state-only, removes the batch and all inbound edges, places standalone media at grid positions, routes existing outbound edges through the selected item and commits one undo step.
- Copies and split outputs retain provenance but are detached from generation ownership. Ordinary non-batch media keep their existing resource presentation. A batch supplies only its selected resource to downstream generation; expanding is not a change of inputs.
- Added generation-batch logic coverage, actual RequestContent/ContentContent fixture tests for progressive outputs, partial failure, cancellation, grid controls, undo and resumed rounds, and a runtime result-node reference persistence assertion. Manual criteria are appended to docs/canvas-manual-acceptance.md. Native/paid-provider behavior remains pending user acceptance.

## Architecture Constraints

- React Flow is not reintroduced as the canvas engine.
- Webviews, iframes, editors, and runtime state stay outside the persisted graph document.
- Node positions remain absolute world coordinates.
- Runtime behavior is provided by the current runtime layer; the legacy `executeFlow` implementation is not restored.
- Virtualization may remove content mounts outside the visible region, but shells, edges, and active interaction targets remain available.

## Media Preview Follow-up

The latest user-directed preview rules supersede the earlier expandable-in-progress batch proposal:

- Media metadata drives automatic aspect-ratio sizing unless the user has manually resized the node.
- Running generation shows red cancellation styling only on pointer hover, not retained keyboard focus.
- Expansion is available only for terminal batches with at least two outputs. Three outputs occupy one row; grids use at most four columns. Each output has its own visible frame, without captions or an enclosing card.
- Empty output placeholders show a single centered status/count/elapsed-time line. Repeated content-type headings are removed.
- Dropping a resource capsule onto blank canvas creates an independent, undoable copy; source resources and connections remain unchanged. Coordinates respect canvas offset and zoom.
- Automated coverage: generation-batch and canvas-user-flow exercise sizing, manual-size preservation, terminal guards, individual frames, centered status, blank-drop placement, original preservation and undo. Desktop visual acceptance remains pending in canvas-user-flow-acceptance.md.

## Automated Gates

Passing on 2026-09-16:

- `desktop/npm run build:all`
- `web/npm run typecheck`
- `web/npm run lint`
- `web/node scripts/verify-canvas-navigation.mjs`
- `web/node scripts/verify-document-autosave.mjs`
- `web/node scripts/verify-session-exit.mjs`
- `web/node scripts/verify-runtime-persistence.mjs`
- `web/node scripts/verify-generation-selection.mjs`
- `web/node scripts/verify-capture-materializer.mjs`
- `git diff --check`

The `web/package.json` `typecheck` script now exposes the declared TypeScript check directly.

Passing automated gates do not by themselves close the desktop compatibility work. The remaining acceptance evidence is tracked above.
