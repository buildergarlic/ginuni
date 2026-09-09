# Balanced Atelier — visual acceptance

final result: passed

## Evidence and scope

- Selected visual truth: `docs/design/references/balanced-atelier.png` (first displayed option; 1487 × 1058 pixels).
- Real implementation: the existing Electron application, isolated synthetic project “골목의 오후”, description at 01:24 selected. No writer project or credentials used.
- CSS viewport: 1440 × 1024, deviceScaleFactor 1. Implementation capture: `output/playwright/atelier-review-1440.png`, 1440 × 1024.
- Comparison normalization: both images contained into 1440 × 1024 panels, separated by 24px. The reference includes an illustrated title bar; the implementation screenshot excludes the genuine native title bar. These frame offsets are not findings.
- Full comparison: `output/playwright/atelier-round1/atelier-comparison-full.png`.
- Focused table comparison: `output/playwright/atelier-round1/atelier-comparison-detail.png`.
- Additional states: 800 and 1100px wide, 28px long Korean text, tools dialog, export menu, high contrast. Generated film still is original synthetic QA media, never a production image.

## Findings — comparison round 1

1. **P2 · Notifications obscure persistent actions.** Bottom-centered export toast overlaps undo/next controls, especially at 800 and 1100px. Evidence: `output/playwright/atelier-round1/atelier-review-800.png`, `atelier-large-text-1100.png`. Relocate it to a non-overlapping status region and expose its status accessibly.
2. **P2 · Excess table density drift.** Redundant per-row durations add a second time line and show roughly seven rows where the selected design shows eight. Remove duplicate duration lines; retain the selected interval duration in the media context. Preserve 16px default script text.
3. **P3 · Long precise time values.** Code review notes 52px inputs cannot display supported `125:43.250` values fully. Accommodate longer values and wrapping without widening every ordinary time field.

## Required fidelity surfaces

- **Typography:** Segoe UI with installed Malgun Gothic Korean fallback, not bundled Apple fonts. Actual script 16px default and 11–28px persisted control. Clear heading/body hierarchy; keyboard focus retained. Korean rasterization differs from generated mock; no fabricated font match claim.
- **Spacing/layout:** 42/58 main workspace matches selected wide composition. Narrow layout stacks the media/context region above the script. Density finding above must be fixed; native minimum allows 800px content width (816px outer Windows frame in this environment).
- **Colors:** white/warm neutral surfaces, deep teal `#145f59`, restrained separators, distinct approval/draft badges. Status is conveyed in text, not color alone.
- **Image quality:** original wide synthetic alley shot plays as an actual MP4. `object-fit: contain` intentionally differs from the mock's portrait crop, preserving visual evidence important to audio-description writers. First premature screenshot showed buffering; waiting for a decoded non-seeking frame fixed the capture, not production code.
- **Copy/content:** Korean labels, honest autosave/review state, separate HWPX all-script and SRT dialogue-only explanations. Extra “작업 도구” and next-unreviewed controls retain existing capabilities. No design-award claims or prompt language in UI.
- **Icons:** licensed Microsoft Fluent regular icons, no Apple assets or custom icon approximations.

## Comparison round 2 — accepted

- Fix commit: `a199786`. Full comparison reopened together at `output/playwright/atelier-comparison-full.png`; focused table comparison reopened at `output/playwright/atelier-comparison-detail.png`.
- Notifications are now normal-flow live status regions in the media context and the active modal, not a footer overlay. Native geometry checks verify no overlap with any footer action at 1440, 1100 and 800px. Evidence: `output/playwright/atelier-responsive-800.png` and `atelier-responsive-1100.png`.
- Eight ordinary rows are fully visible at 1440 × 1024 with 16px text; an actual bounding-box assertion checks the eighth row inside the table viewport. Redundant time-cell durations are removed; selected duration remains in the media context.
- `125:43.250` is fully visible in the expanding time field and wraps with the end time within the time column; input scrollWidth <= clientWidth is verified at 1100px. Evidence: `output/playwright/atelier-precise-time-1100.png`. This deliberately invalid fixture range also leaves approval disabled without saving it.
- The five fidelity surfaces above were rechecked. No actionable P0/P1/P2 remains. Video playback controls are genuine Chromium controls; waiting for readiness and the native loading-control fade makes the paused frame reproducible. Saved selected-row state differs from the mock's pending-draft state, so the neutral “확인 전” badge is correct.
- Remaining P3: Windows font rasterization differs from the image-generated type; a future writer field trial can guide typography preference. The supported text-size controls and clear keyboard focus are retained.
- Stable handoff copies: `docs/design/atelier/desktop.png`, `comparison-full.png`, `comparison-detail.png`. Full transient test artifacts remain under ignored `output/playwright`.

## Interaction evidence

- Atelier native suite: 8 checks passed, no page errors (draft/approval failure safety, double click, focus, consent persistence, export, responsive sizes, text scaling).
- Existing workflow: 8 checks passed (including proposal application/source preservation, snapshot restore, actual export artifacts and subsequent editing).
- YouTube controlled iframe boundary: 4 checks passed. Live public YouTube IFrame API example (`M7lc1UVf-VE`): another 4 checks passed for dialogue/description selection and active editor seeking while paused, preserving drafts. No video download or AI request.
- Guide/About: 5 checks passed, no failures or page errors.
- Final implementation: 235 unit tests across 30 files, typecheck and build passed in an independent parent run. Task code review approved with no important findings; its precise-time readability note is fixed.

## Implementation checklist

- [x] Fix notification overlap and table density.
- [x] Address precise-time legibility and test it.
- [x] Rebuild, recapture matching state, compare full + detail again.
- [x] Verify no remaining P0/P1/P2 and update final result.

## Residual validation limits

This is automated/native visual QA, not a screen-description writer field trial. Windows Narrator, installed Hancom rendering, signed installer/updater and a design award are not certified by these checks. No merge, push, version bump or release has occurred for this redesign.
