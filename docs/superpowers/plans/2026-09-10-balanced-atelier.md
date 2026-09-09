# GiNuNi Balanced Atelier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the user's selected first visual direction to the existing Windows app, centered on an easy, spacious review/writing workspace.

**Architecture:** Keep Electron, preload API, project schema and analysis/export services intact. Restructure renderer presentation around a large left media area, readable right script table, labelled export disclosure, persistent review footer, and a native modal work-tools drawer. Reuse the existing save/mutation pipeline and introduce only a pure next-unreviewed-row helper plus a success selection option for confirm-and-next.

**Tech Stack:** Electron, React 19, TypeScript, CSS, Vitest, Microsoft Fluent UI System Icons. Keep existing system Korean font fallback; do not install Apple fonts or create another app scaffold.

**Spec:** `docs/design/2026-09-10-ui-design-research.md`; selected visual `docs/design/references/balanced-atelier.png` (first displayed image explicitly chosen by user).

## Global Constraints

- Work only in `C:/GiNuNi/screen-description-script-maker/.worktrees/atelier-ui`, branch `codex/atelier-ui`. Do not change the original checkout, merge, push or publish.
- Existing application upgrade, not a new web app. Do not change project schema, source data, default cloud permissions or backend services.
- Preserve YouTube/local click seek including active-editor seek without losing draft or unpausing. Preserve source video aspect and full frame with containment: never copy the mock's portrait crop.
- Preserve autosave, draft flush before navigation/export/close/update, explicit human approval, rejection of stale AI proposals, separate audio/text cloud consents, source records, snapshots, row editing, HWPX and SRT behavior.
- No automatically generated visual description, fake success, fake accuracy percentage, remote fonts, demo film as production content, Apple assets or SF fonts.
- Design: white/warm-white surfaces, deep teal action accent, quiet gray separators, restrained rounded corners, readable Korean and Fluent icons with text labels. Keep native Windows window controls; do not implement fake macOS buttons.
- Keep author data and user font preference; existing 11–28px font range and default 16px stay compatible. No version bump or release in this implementation task.
- Parent owns `scripts/qa-atelier.mjs`, other QA harness updates, design-qa report, and implementation/research documentation. Implementer owns renderer code, relevant renderer tests, dependency manifest/lockfile and bundled icon license only.

## Task 1: Implement the selected workspace and coherent surrounding surfaces

**Files:**
- Modify `src/renderer/src/App.tsx`, `src/renderer/src/WorkflowPanel.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/GuideScreen.tsx`, `src/renderer/src/guide.css`.
- Create `src/renderer/src/review-navigation.ts`, `src/renderer/src/atelier.css`; small renderer-only UI component files are allowed for export/drawer if they simplify the existing large App.
- Modify `src/renderer/src/main.tsx` to load atelier styles after existing styles.
- Modify only presentation options in `src/main/index.ts` `createWindow`: native minimum size800x600 so the compact layout is reachable; keep native frame and all IPC/services unchanged.
- Test `tests/review-navigation.test.ts`, `tests/renderer-workflow.test.ts`; add renderer component tests for actual accessible output where useful.
- Add dependency `@fluentui/react-icons` pinned to resolved stable version through npm; preserve all existing versions. Copy its MIT license into `resources/licenses/fluent-ui-system-icons-LICENSE.txt`.

**Interfaces:**
- Consumes existing `rowReviewStatus(row: ScriptRow)`, `runAction(operation: () => Promise<void>)`, `flushSave()`, `reviewRows(projectId, ids, approved, revision)` and `mutateProject`.
- Produces `nextUnreviewedRow(rows: ScriptRow[], currentId: string): ScriptRow | undefined`. After current row, search in order then wrap to the first unapproved row, using `rowReviewStatus`; return undefined if none. Missing current ID starts from first remaining.
- Extend renderer-internal `mutateProject(operation, selection?: (updated: ScriptProject) => ScriptRow | undefined)` without changing the callback contract consumers already use. On successful operation choose the resolver row, else existing selection fallback. On the selection-resolver path synchronize refs/state and seek directly inside the successful branch; never navigate after a caught failure.

- [x] Step 1: Write and run failing behavior tests before implementing helper/action changes. Test fixture shape:

```ts
const makeRow = (id: string, approved = false): ScriptRow => ({
  id, kind: 'dialogue', startMs: 0, endMs: 1000,
  content: id, speakers: [], sourceSegmentIds: ['source'],
  reviewed: approved, reviewStatus: approved ? 'approved' : 'unreviewed',
  approvedAt: approved ? '2026-09-10T00:00:00Z' : undefined
})
expect(nextUnreviewedRow([makeRow('a'), makeRow('b', true), makeRow('c')], 'a')?.id).toBe('c')
expect(nextUnreviewedRow([makeRow('a'), makeRow('b', true), makeRow('c', true)], 'c')?.id).toBe('a')
expect(nextUnreviewedRow([makeRow('a', true)], 'a')).toBeUndefined()
expect(nextUnreviewedRow([], '')).toBeUndefined()
expect(nextUnreviewedRow([makeRow('a')], 'missing')?.id).toBe('a')
```

Also test an apparently approved row missing `approvedAt` is not skipped. Run `npm test -- tests/review-navigation.test.ts` and retain actual RED/GREEN evidence. Existing tests for draft/save ordering must continue passing; do not replace them with source-text tests.

- [x] Step 2: Implement the helper and success-selection path. Minimal helper:

```ts
export function nextUnreviewedRow(rows: ScriptRow[], currentId: string): ScriptRow | undefined {
  const index = rows.findIndex(row => row.id === currentId)
  return rows.slice(index + 1).find(row => rowReviewStatus(row) !== 'approved')
    ?? rows.slice(0, index + 1).find(row => rowReviewStatus(row) !== 'approved')
}
```

Confirm action captures selected ID, uses the `mutateProject` pipeline, and calls `window.screenScript.reviewRows(project.id, [targetId], true, revision)`. The success selection resolver derives next from `updated.rows` and retains the confirmed row when none remain. Do not use `await mutateProject(...); chooseRow(...)` because the pipeline catches failures. Already-approved unchanged selection navigates via a separate “다음 확인할 행” secondary action; it must not create redundant approval events. Completion is derived from `visibleRows`, not stale project rows.

- [x] Step 3: Replace review presentation, keeping handlers and meaningful accessible names.

Header: back label “내 프로젝트”; project title; accurate autosave state; labelled “작업 도구” trigger and outlined “대본 내보내기” disclosure. About/support/settings live in the tools area. Export disclosure shows actual buttons “HWPX 내보내기” with “한글 문서 · 대사와 화면해설”, and “SRT 내보내기” with “자막 파일 · 대사만”. Keep existing disabled/error gating, Escape/outside closing and keyboard reachability.

Main workspace: video left, table right. At desktop1440px, start with42%/58%; video width fills left with16:9 containment and existing local/native/YouTube controls. Under video show playhead and selected range/duration, short writing guidance, plus “원문과 작업 기록” trigger opening the same drawer. No fake media image in app code. Right title “대본 쓰기”, actual remaining count, font controls with labelled decrease/increase and range. Table reorders/grouped times at leading edge, classification, content, review status. Preserve both time input labels; do not remove start/end editing or duration. Use “화면해설” visible badge but keep existing row accessible-name compatibility (“해설 …”) if useful.

Footer: current review hint, “실행 취소”, “다음 확인할 행”, dominant “확인 완료 · 다음”. Footer stays reachable without horizontal page overflow. Already-approved selected row disables confirm until changed; no rows/all done have truthful state. All primary action disable behavior must respect processing/mutation locks and draft validation.

Drawer: use native `<dialog>` / `showModal()` or an equally accessible modal with labelled heading, close button, Escape, focus containment and focus return. Keep its contents mounted while closed so WorkflowPanel consent edits/snapshot selection do not reset. Put existing WorkflowPanel plus all selected-row split/merge/insert/delete/type/time tools and speaker rename inside. Display notification of missing required rights consent near processing controls rather than hiding the cause in the drawer. Avoid auto-opening a long drawer on every selection.

- [x] Step 4: Add a coherent atelier style layer; remove/rewrite conflicting review rules rather than leaving unreachable duplicate UI. CSS starting points:

```css
:root { --ink:#202c29; --muted:#586963; --paper:#fff; --line:#dfe6e2; --green:#145f59; }
.review-grid { grid-template-columns:minmax(320px,42fr) minmax(0,58fr); }
.media-frame { width:100%; aspect-ratio:16/9; object-fit:contain; background:#111; }
.script-panel { min-width:0; }
.review-page .selected-row { background:#f1f8f6; }
```

Use legible UI body14–16px, script user preference16px+, restrained700 weight only on headings, generous line heights. No pink whole-row flood or yellow header. A solid opaque script surface, subtle separators, near-white canvas. Bundled Fluent regular icons replace text glyph controls in touched surfaces; decorative icons aria-hidden, meaningful icon buttons have labels. Use plain GiNuNi wordmark, not a CSS-drawn logo. Preserve full page title bars and actual data content.

Extend common type/color/button/input/spacing styles into home, setup, settings, guide, About and support so they belong to the same product; don't create new screens. Remove old decorative gradients and overly dark/tiny navigation where these conflict with selected identity. Update use-guide menu references for export disclosure and tools drawer without rewriting unrelated guide content.

Responsive behavior: at1100px use narrower media and readable script; below900px stack media then script or a similarly usable layout. No body min-width1000px; no viewport-level horizontal clipping. Large fonts/time fields must not overlap. Support `prefers-reduced-motion: reduce` and `forced-colors: active`, meaningful focus-visible outlines. Prefer native Windows title bar unchanged over a risky custom frame.

- [x] Step 5: Run focused tests, then `npm run verify` once complete. Read full output. Add/keep actual accessible-output assertions, not brittle stylesheet/source substring tests. Report any existing warnings separately.
- [x] Step 6: Self-review diff for data changes, dropped controls, modal state loss, inaccurate autosave/approval, small-window layout, missing icon license. Commit only owned files with `feat: apply Balanced Atelier writer workspace`. Do not commit parent-owned plan/QA artifacts or release files.

## Parent verification and handoff checklist

- [ ] Read implementer report and run independent task/whole-branch review before completion.
- [x] After explicit Playwright permission, adapt native Electron QA harness to new disclosures and add confirm-next, save failure/no advance, drawer keyboard/focus preservation and export tests using synthetic local project only.
- [x] Capture1440x1024,1100x900, narrow/large text, tools and export states. Open reference+implementation together in a comparison input and inspect typography, space, palette, imagery, copy and all P0/P1/P2 differences.
- [x] Write `design-qa.md` with evidence and exact final result `passed` or `blocked`. Do not claim native/browser visual verification if permission/capture is unavailable.
- [x] Keep work in the isolated branch and show the actual result. Do not release until verified and the user asks to integrate/publish this redesign.

Execution note: task review approved; visual review fixes are committed in a199786. Selected range duration remains in the media context; redundant per-row duration was removed after comparison. Final parent verification: 235 unit tests, successful typecheck/build and 29 native scenario checks including live YouTube. See design-qa.md and docs/design/2026-09-10-atelier-verification.md. Whole-branch review is the remaining checklist gate before handoff.
