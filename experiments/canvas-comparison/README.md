# Cnote canvas comparison experiments

This directory contains the archived selection experiments and the final acceptance harness for the implemented canvas changes. It is not a canvas migration. It does not read production storage or provider keys. Electron uses a separate per-run user-data directory and an ephemeral guest partition. The only HTTP listener binds to loopback and is closed at the end. All network inputs are synthetic.

## Current non-window checks

**Per the user's latest direction, do not launch product or fixture windows automatically.** Actual interaction, appearance, responsiveness and browser resource checks belong to the user operating the real application. Existing window-fixture data is diagnostic archive only, not acceptance evidence. The window task was stopped; completing its remaining rows is no longer a delivery requirement.

Run these commands from the repository root, using the repository's installed Web and desktop dependencies:

```text
npm --prefix web run test:canvas-release
node experiments/canvas-comparison/measure-save-cost.mjs
```

The release entry runs 16 functional suites, TypeScript, ESLint, the Web and desktop-mode frontend builds, and the desktop TypeScript build. Functional results and measured-source hashes are stored in `results/release-checks-*.json`. It does not package or install an application release.

## Archived window fixtures — not pending validation

The following documents how the retained `run-final-product.mjs`, `final-product-main.cjs` and related diagnostic files work. It is not an instruction to resume them. The real product manual checklist supersedes their former acceptance role; their names have been retained for traceability, not as a claim of completed final validation.

The final product harness renders the real `CanvasViewport`, `CanvasProvider`, AI content, rich text, tables, images and sticky notes. Both versions use the same fixture, React profiling build and dependencies. Drag, pan, zoom, streaming and mixed operation are measured at 30/100/300 nodes, separately for Web-style HTTP and desktop-style streaming. Each condition has five repetitions; before/after order alternates by repetition. This produces 300 rows, or 150 paired observations. Do not run CPU-intensive builds or other benchmarks concurrently.

The **before** core is extracted from the frozen `build/before-optimization/fixture.js.map`, not current code with the frame scheduler disabled. Core provider, viewport, graph store and AI-content sources are checked for provenance. Content wrappers absent from that snapshot use their recorded Git original; unaffected shared modules use the same source in both variants. `build/final-product/manifest.json` records source provenance, source hashes, bundle hashes and fixture/orchestrator hashes. This is a controlled comparison of changed product components, **not two fully packaged historical application releases**. Do not regenerate the frozen baseline from today's source or present the fixture as framework-selection evidence.

AI runs click the production send button, pass local SSE through the production protocol parser and display buffer, and check exact final text. The desktop fixture provides an IPC-backed local stream to the production desktop-fetch reader; it is not a remote-provider or complete main-process network-service benchmark. Canvas browser bodies are identical simple iframes in both variants. Actual native webview state/resource checks run separately with `--guests`: 1, 10, then 50 guests, stopping if free system memory falls below 2 GiB. Those checks retain and restore input values after moving guests offscreen; they do not simulate real websites, authentication, media or a 50-browser full application workload.

Every completed row is checkpointed. A row has a 30-second navigation/measurement guard, and a shard has a 12-minute guard; interrupted files stay in `results/` and are not passing acceptance records. Each measured page must be visible. The final runner disables renderer/occlusion backgrounding and re-exposes its inactive window after navigation, because a hidden window previously stopped delivering animation frames despite a responsive page. Visibility, inner dimensions and DPR are recorded per row. This changes only the test window, not production background behavior.

`verify-final-product.mjs` requires three complete, matching-source shards; exact before/after coverage; final gesture/stream integrity; native guest restoration; and current source hashes. It creates `results/final-product-summary.json`. Frame numbers are the median and full range of **five per-run frame-P95 estimates**, not a pooled-frame percentile. Each run has 20 measured intervals; the current P95 estimator selects the largest of those 20, so these short samples are useful diagnostics, not an exhaustive latency distribution. React profiling adds overhead, software compositing cannot establish hardware-GPU performance, and observed overlap is not a statistical significance test. Report regressions as well as gains. Native guest working-set sums may count shared pages more than once; they are not private memory or the drop in free RAM.

`measure-save-cost.mjs` runs production `saveDocument` and `commitHistory` against an in-memory storage sink, checking saved envelopes and independent history snapshots. Its 15 records measure queue/encoding and cloning costs, not disk, IPC or end-to-end autosave latency. Unchanged-AI-session encoding is covered by the separate persistence regression suite and archived serialization experiment.

Final scope/status and the user-owned 33-row hardware/UI checklist are in `docs/canvas-optimization-plan.md`, `docs/canvas-optimization-execution.md` and `docs/canvas-manual-test-checklist.md`. Native IME, real websites, hardware compositing and perceived clarity still require that manual checklist; automatic checks must not mark those rows passed.

## Archived selection experiments — reproduction only

The commands below reproduce the already completed framework/transport/process/motion studies. They are historical evidence, **not pending tasks in the implementation plan**. Do not rerun them to reopen the approved scope. Keep their accepted 670 Electron, 90 serialization and 40 motion records separate from final product acceptance.

Run from this directory after the repository's Web and desktop development dependencies are available:

```text
npm ci --ignore-scripts --no-audit --no-fund
node run.mjs --smoke
node run.mjs
node run.mjs --windowed
node run.mjs --windowed --group=engine
node motion.mjs
node consolidate.mjs
node summarize.mjs results/accepted.json
node verify-results.mjs
node serialization.mjs
```

The production reference requires the existing `web/dist/assets/index-*.css`; build the Web app if that artifact is absent. The harness bundles current source in production mode and reuses the repository's React, esbuild and Electron. React Flow 11.11.4 is pinned only here, matching the pre-migration lockfile. No production package file is edited.

`--group=engine`, `--group=scale`, `--group=virtual`, `--group=virtual-steady`, `--group=material`, `--group=transport`, `--group=isolation`, and `--group=production-update` select one experiment. Full runs use five repetitions in a seeded shuffled order. Smoke runs are setup checks and must not be used as adoption evidence. Raw results are archived in `results/`; `latest.json` and summaries are overwritten by the next run. `--windowed` temporarily shows an isolated normal window without requesting focus; it is closed at the end. A fully hidden normal window did not advance rAF in the setup check, so it is not used for measurements.

## What is measured

- Engines: same simple rich-content fixture in a current-style per-node presentation model, a shared-transform model, React Flow 11.11.4, and a React Flow shell plus lifted-content model. An actual `CanvasViewport` with fixture contents is a separate product reference: its controls, shell behavior, virtualization, and graph-store writes are not equivalent to the small prototypes. Never rank framework adoption from that reference-versus-prototype ratio.
- Scaling: keep identical nodes and change only content `zoom` versus `transform`. Shell position and screen dimensions are updated in both variants. Both incur shell layout; the test asks whether content relayout adds measurable cost.
- Virtualization: reuse production visibility and pin functions. All variants retain shells. Test light/heavy content, 12/24/100/300 nodes, and intermittent offscreen streaming. The speculative adaptive policy uses cost weights 1/6 and threshold 64 chosen before the result; it is not a calibrated product policy. Streaming toggles every ten frames, deliberately stressing mount churn rather than representing a sustained long response.
- `virtual-steady` repeats the 100/300-node comparison with uninterrupted streaming. `production-update` renders the actual current canvas with the same fixture contents and compares 20 individual graph writes per frame with one equivalent batch, checking every node position on every frame and counting notifications. These are explicitly separated from the framework models.
- Transport: the same paced NDJSON UTF-8 payload crosses pull IPC using numeric-byte arrays, a credit-limited MessagePort, or authenticated loopback HTTP. Measurements separate initial delay (including the identical 30 ms source startup) from source-timestamp-to-receipt delay. They do not include a provider, Markdown rendering, a saved-key vault, or the complete production network stack. Cross-process high-resolution epoch clocks can introduce small timestamp error; sub-millisecond differences are not migration evidence alone.
- Isolation: identical per-entity JSON serialization runs on the renderer, a warm Web Worker, or a warm utility process. Worker/process variants return the full serialized result, so total time and main-thread responsiveness include input/output copying. This is the production serialization kernel, not a full persistence service; current desktop storage already has a native path. It does not measure moving data ownership and writes into the worker/process.
- Motion: deterministic scalar-camera simulation records settling, overshoot and target changes. This is not human preference evidence. The scalar two-stage model is not a reproduction of Creatos's separate center-then-zoom sequence; a dedicated follow-through comparison is reported separately when available.

## Validity and decision rules

- Record hardware, Electron/Chromium versions, compositing mode and git HEAD. Other desktop processes are not stopped; this is not an otherwise-idle laboratory machine.
- Warm scenes, then collect rAF intervals, CDP layout/style/task durations, update-call time and mount/render counts. The test intentionally checks per-frame changes, not raw pointer-event scheduling. Heap snapshots across randomly ordered scenes are not an isolated-memory comparison.
- Evaluate medians, min/max across five repetitions, absolute differences and correctness together. Approximately 15% improvement is an initial signal, not a guarantee of perceptual benefit; improvements inside run-to-run variation are inconclusive.
- The hidden offscreen renderer reported software compositing during the setup check. These tests support CPU/layout and messaging conclusions, not GPU performance claims.
- The normal-window setup check also reported software compositing, but allowed the unscaled native guest click control to work. Its native input evidence must not be mixed with offscreen click failures. Actual viewport, DPI and compositing status are stored per run.
- Focus, input selection and host hit testing are automated. Native guest clicking must have a passing unscaled control before interpreting a scaled result. All-failing controls indicate a harness limitation, not three broken product implementations.
- IME, rich-text sharpness, complete browser navigation/scroll/zoom, menus, undo/redo, restart persistence and subjective preferences remain separate compatibility gates. A React Flow migration is not approved without those gates and a measured advantage over an equivalently optimized self-built engine.
- A candidate may be adopted only for a node type or workload. A negative full-copy utility-process result does not prove that process isolation with ownership transfer is inferior.

## Historical evidence

Commit `4a1358c30ccebf094e63060b80e2f2718d0b5f4e` (2026-09-15 11:30:40 +08:00) explicitly replaces React Flow with a self-built engine and names declarative nodes, independent runtime session/asset management, content lifted outside the transform tree, and graph/payload separation. Its parent lockfile pins React Flow 11.11.4. The commit adds the domain/runtime/storage modules and removes the legacy editor and flow store.

`docs/canvas-compatibility-matrix.md` records preserving this architecture and explicitly says not to reintroduce React Flow as the engine. These are evidence of the historical goals and constraints, not comparative performance measurements or proof that React Flow cannot implement a similarly separated architecture. No benchmark establishing the original migration's performance advantage has been found in the inspected history.

The Electron offscreen rendering contract was checked against the official Electron repository's `docs/tutorial/offscreen-rendering.md`. No subagents were used: historical evidence was local and timing experiments needed serialized execution.

## Experiment revisions

The first complete offscreen run had 570 cases. Its HTTP drain waiter accumulated temporary close listeners on burst responses, and its shared-transform prototype gave the edge SVG an unnecessarily large 10000x10000 bounding box. Those two implementations were corrected before the normal-window rerun. Use the corrected run for adoption decisions; the initial data is retained as an audit trail, not pooled into its medians. The original source hashes are in `results/full-source-manifest.json`; subsequent runs embed their own hashes. The normal-window full run adds the sustained-streaming and production-batching controls, totaling 670 cases.

The React Flow prototype was then audited for stable unchanged node-data references and a stable edge array, to avoid accidentally rerendering all bodies on a partial drag. The whole 150-case engine family is rerun after this correction, not only the cases showing a favorable result. `consolidate.mjs` retains the other 520 cases from the corrected full run and replaces all engine cases with that rerun. `accepted.json` has 670 rows, both source manifests and checksums of the original data. `verify-results.mjs` checks the five repetitions, result integrity, per-frame graph-write counts, and that the prototypes rerender only the 20 changed bodies per drag frame.

`motion.mjs` separately implements the documented center-for-400ms then zoom-for-680ms pattern. It explicitly assumes cubic-out easing because the excerpt does not specify easing. It checks 40 target-change/manual-interruption cases; it does not claim to reproduce the original closed-source motion engine. Its output supersedes the preliminary scalar two-stage simulation for follow-through discussion.

`serialization.mjs` extracts the current production `serializeEntity` function through TypeScript's parser and compares serialize-then-compare with a reference-identity guard for immutable AI-session-shaped entities. It records 90 Node CPU-kernel samples with identical write intents. This is not a whole persistence-service or renderer-frame benchmark; cache invalidation, failed writes and other entity collections require separate production tests.
