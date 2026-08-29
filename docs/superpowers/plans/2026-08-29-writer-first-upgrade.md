# GiNuNi Writer-First Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비전문 화면해설작가가 모델명을 몰라도 영상을 가져와 문제 구간만 검수하고, 안전하게 HWPX/SRT를 내보낼 수 있는 GiNuNi v0.6 계열을 만든다.

**Architecture:** 사용자에게는 `내 PC에서 분석`과 `정확도 우선 분석` 두 프로필만 보여주고, 내부에서는 전사·화자 분리 공급자를 공통 결과 형식으로 정규화한다. 검수 상태, 검수 이슈, 교정 제안, 스냅샷을 프로젝트 스키마 3에 보존하며, 새 모델은 별도 평가 도구에서 기준선을 통과한 뒤에만 제품 옵션으로 승격한다.

**Tech Stack:** Electron 43, React 19, TypeScript 7, Vite/electron-vite, Vitest 3, Node.js 26, OpenAI Node SDK 7, Zod 4, whisper.cpp, sherpa-onnx, HWPX/SRT

**Spec:** `docs/superpowers/specs/2026-08-29-writer-first-upgrade-design.md`

## Global Constraints

- 기본 대상은 Windows 10/11 x64와 한컴오피스 2022다.
- 기본 분석 프로필은 `private`이며 원본 음성을 외부로 보내지 않는다.
- 클라우드 분석은 실행 전 외부 전송과 비용 가능성을 한글로 알린다.
- 일반 사용자 화면에 공급자·모델·런타임 이름을 기본 노출하지 않는다.
- AI 결과는 승인 전 원문을 덮어쓰지 않는다.
- API 키·대사·음성 내용·전체 파일 경로를 로그와 진단 파일에 기록하지 않는다.
- 기존 스키마 1·2 프로젝트의 대사, 화자, 시간, 내보내기 기록을 보존한다.
- HWPX와 SRT는 기존 파일을 덮어쓰지 않는다.
- 실제 방송 영상·대본·자막과 평가용 비공개 음성은 Git에 커밋하지 않는다.
- 핵심 동작은 우클릭이나 단축키 없이 버튼만으로 완료할 수 있어야 한다.
- 각 작업은 테스트를 먼저 추가하고 `npm run typecheck`, 관련 Vitest, 마지막에 `npm run verify`를 통과한다.

---

## File Map

### Shared domain

- `src/shared/types.ts`: 분석 프로필, 공급자 결과, 검수 상태, 교정 제안, 스냅샷 메타데이터의 공통 타입
- `src/shared/constants.ts`: 스키마 버전과 모델·보존 개수 상수
- `src/shared/rows.ts`: 새 행의 기본 검수 상태와 스키마 호환 변환
- `src/shared/review-issues.ts`: 저장 및 UI가 공유하는 검수 이슈 계산
- `src/shared/review-navigation.ts`: 다음 확인 필요 행 선택
- `src/shared/analysis-profile.ts`: 사용자용 프로필을 현재 엔진 설정으로 변환
- `src/shared/evaluation.ts`: CER/WER/고유명사 평가의 순수 함수
- `src/shared/corrections.ts`: 교정 제안 검증과 적용·거부 상태 전이

### Main process

- `src/main/services/provider-registry.ts`: 공급자 생성과 기능 정보
- `src/main/services/project-store.ts`: 스키마 3 마이그레이션과 검수 데이터 저장
- `src/main/services/project-snapshots.ts`: 원자적 스냅샷 생성·목록·복원
- `src/main/services/glossary-store.ts`: 로컬 용어 사전 저장
- `src/main/services/correction-service.ts`: 구조화된 교정 제안 생성
- `src/main/services/local-transcription.ts`: 공통 전사 결과와 용어 힌트 지원
- `src/main/services/openai-transcription.ts`: 공통 전사 결과와 공급자 근거 정보
- `src/main/index.ts`: 새 서비스의 IPC 및 처리 파이프라인 연결
- `src/preload/index.ts`: 검수·복구·용어·교정 IPC 노출

### Renderer

- `src/renderer/src/components/ProcessingProfilePicker.tsx`: 쉬운 분석 방식 선택
- `src/renderer/src/components/ReviewWorkspace.tsx`: 영상·현재 행·확인 목록의 3영역 작업대
- `src/renderer/src/components/ReviewQueue.tsx`: 확인 필요 구간 목록
- `src/renderer/src/components/CorrectionDiff.tsx`: 원문과 제안 비교 및 승인
- `src/renderer/src/components/SnapshotDialog.tsx`: 복원 지점 목록과 확인
- `src/renderer/src/App.tsx`: 화면 전환과 프로젝트 상태 조정
- `src/renderer/src/styles.css`: 기존 색·타이포그래피를 유지한 새 컴포넌트 스타일

### Evaluation, QA, docs

- `scripts/evaluate-transcription.ts`: 매니페스트의 정답·가설을 점수화
- `evaluation/manifest.example.json`: 권리 정보가 포함된 예시 스키마
- `evaluation/README.md`: 비공개 평가 자료 준비·실행 지침
- `docs/qa/WRITER_PILOT.md`: 화면해설작가 파일럿 진행표
- `docs/USER_GUIDE.md`: 새 3단계 작업 흐름
- `docs/ARCHITECTURE.md`: 공급자·스키마·복구 구조
- `docs/RELEASE.md`: v0.6 릴리스 게이트

---

## Delivery Sequence

| 주차 | 작업 | 독립적으로 확인 가능한 결과 |
| --- | --- | --- |
| 1 | Task 1 | 기존 및 후보 결과를 같은 지표로 점수화 |
| 2 | Task 2 | 스키마 1·2를 손실 없이 스키마 3으로 열기 |
| 3 | Task 3~4 | 쉬운 분석 방식과 명확한 검수 상태 |
| 4~5 | Task 5~6 | 문제 구간 전용 검수와 프로젝트 복원 |
| 6~8 | Task 7 | 공급자 공통화와 비교 실행 기반 |
| 9 | Task 8 | 고유명사 재사용과 힌트 전달 |
| 10 | Task 9 | 원문을 보존하는 교정 제안 승인 |
| 11 | Task 10 | 실제 HWPX/SRT 및 전체 회귀 검증 |
| 12 | Task 11 | 화면해설작가 파일럿과 베타 판정 |

---

### Task 1: Evaluation Manifest and Baseline Metrics

**Files:**
- Create: `src/shared/evaluation.ts`
- Create: `tests/evaluation.test.ts`
- Create: `scripts/evaluate-transcription.ts`
- Create: `evaluation/manifest.example.json`
- Create: `evaluation/README.md`
- Modify: `.gitignore`
- Modify: `package.json:6-17`

**Interfaces:**
- Produces: `scoreTranscript(reference: string, hypothesis: string): TextScores`
- Produces: `scoreHotwords(referenceTerms: string[], hypothesis: string): HotwordScores`
- Produces: CLI `npm run eval:transcription -- <manifest> <output>`

- [ ] **Step 1: Write failing metric tests**

```ts
import { describe, expect, it } from 'vitest'
import { scoreHotwords, scoreTranscript } from '@shared/evaluation'

describe('전사 평가', () => {
  it('한국어 문자와 공백 단위 오류율을 계산한다', () => {
    expect(scoreTranscript('기누니가 시작한다', '기누니 시작한다')).toEqual({
      characterErrorRate: 1 / 8,
      wordErrorRate: 1 / 3
    })
  })

  it('고유명사를 대소문자와 주변 문장부호에 영향받지 않고 센다', () => {
    expect(scoreHotwords(['GiNuNi', '한강'], 'ginuni는 한강에 있다.')).toEqual({
      matched: 2,
      expected: 2,
      recall: 1
    })
  })
})
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npm test -- tests/evaluation.test.ts`

Expected: FAIL because `src/shared/evaluation.ts` does not exist.

- [ ] **Step 3: Implement normalized edit-distance scoring**

```ts
export interface TextScores {
  characterErrorRate: number
  wordErrorRate: number
}

export interface HotwordScores {
  matched: number
  expected: number
  recall: number
}

function distance<T>(left: T[], right: T[]): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]
    row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex]
      const substitution = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      row[rightIndex] = Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, substitution)
      diagonal = above
    }
  }
  return row[right.length]
}

function compact(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
}

function words(value: string): string[] {
  return value.normalize('NFKC').trim().split(/\s+/).filter(Boolean)
}

export function scoreTranscript(reference: string, hypothesis: string): TextScores {
  const referenceCharacters = [...compact(reference)]
  const referenceWords = words(reference)
  return {
    characterErrorRate: distance(referenceCharacters, [...compact(hypothesis)]) / Math.max(referenceCharacters.length, 1),
    wordErrorRate: distance(referenceWords, words(hypothesis)) / Math.max(referenceWords.length, 1)
  }
}

export function scoreHotwords(referenceTerms: string[], hypothesis: string): HotwordScores {
  const normalizedHypothesis = hypothesis.normalize('NFKC').toLocaleLowerCase('ko-KR')
  const matched = referenceTerms.filter((term) => normalizedHypothesis.includes(term.normalize('NFKC').toLocaleLowerCase('ko-KR'))).length
  return { matched, expected: referenceTerms.length, recall: matched / Math.max(referenceTerms.length, 1) }
}
```

- [ ] **Step 4: Add a rights-aware manifest and CLI**

Use this exact example shape in `evaluation/manifest.example.json`:

```json
{
  "schemaVersion": 1,
  "clips": [
    {
      "id": "licensed-clean-dialogue-001",
      "audioPath": "private/audio/licensed-clean-dialogue-001.wav",
      "referencePath": "private/reference/licensed-clean-dialogue-001.json",
      "category": "clean-two-speaker",
      "rightsBasis": "직접 제작 및 평가 목적 사용 동의",
      "allowedUse": "evaluation-only",
      "deleteAfter": "2027-08-29",
      "hotwords": ["기누니"]
    }
  ]
}
```

The CLI must reject entries with an empty `rightsBasis`, write only aggregate scores to `evaluation/results`, and never copy audio or reference text to the result file.

- [ ] **Step 5: Protect private evaluation data and add the script**

Add these lines to `.gitignore`:

```gitignore
evaluation/private/
evaluation/results/
```

Add this package script:

```json
"eval:transcription": "tsx scripts/evaluate-transcription.ts"
```

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/evaluation.test.ts && npm run typecheck`

Expected: PASS.

```powershell
git add .gitignore package.json src/shared/evaluation.ts tests/evaluation.test.ts scripts/evaluate-transcription.ts evaluation
git commit -m "test: add rights-aware transcription evaluation"
```

---

### Task 2: Project Schema 3 and Explicit Review Status

**Files:**
- Modify: `src/shared/constants.ts:1-3`
- Modify: `src/shared/types.ts:1-120`
- Modify: `src/shared/rows.ts:65-160`
- Modify: `src/main/services/project-store.ts:1-88`
- Modify: `tests/project-store.test.ts`
- Modify: `tests/rows.test.ts`

**Interfaces:**
- Produces: `ReviewStatus = 'unreviewed' | 'needsAttention' | 'approved'`
- Produces: `migrateProject(project: ScriptProject | LegacyProject): ScriptProject`
- Changes: `ScriptRow.reviewed` to `ScriptRow.reviewStatus`

- [ ] **Step 1: Add failing schema migration tests**

```ts
it('스키마 2의 reviewed 값을 스키마 3 검수 상태로 변환한다', async () => {
  const legacy = makeSchema2Project([
    { ...makeRow('a'), reviewed: true },
    { ...makeRow('b'), reviewed: false }
  ])
  const loaded = await saveAndLoadLegacyProject(legacy)
  expect(loaded.schemaVersion).toBe(3)
  expect(loaded.rows.map((row) => row.reviewStatus)).toEqual(['approved', 'unreviewed'])
  expect(loaded.rows.map((row) => row.content)).toEqual(legacy.rows.map((row) => row.content))
})
```

Add a rows test asserting every generated row starts as `unreviewed`.

- [ ] **Step 2: Verify the old schema fails**

Run: `npm test -- tests/project-store.test.ts tests/rows.test.ts`

Expected: FAIL because `reviewStatus` and schema 3 do not exist.

- [ ] **Step 3: Define the schema 3 fields**

```ts
export type ReviewStatus = 'unreviewed' | 'needsAttention' | 'approved'

export interface ScriptRow {
  id: string
  kind: ScriptRowKind
  startMs: number
  endMs: number
  speakers: string[]
  content: string
  sourceSegmentIds: string[]
  reviewStatus: ReviewStatus
}
```

Set `APP_SCHEMA_VERSION = 3` and replace all new-row `reviewed: false` values with `reviewStatus: 'unreviewed'`.

- [ ] **Step 4: Implement a single explicit migration path**

```ts
interface LegacyScriptRow extends Omit<ScriptRow, 'reviewStatus'> {
  reviewed?: boolean
  reviewStatus?: ReviewStatus
}

function migrateRow(row: LegacyScriptRow): ScriptRow {
  const { reviewed, ...current } = row
  return {
    ...current,
    reviewStatus: current.reviewStatus ?? (reviewed ? 'approved' : 'unreviewed')
  }
}

export function migrateProject(project: ScriptProject): ScriptProject {
  const speakerNormalized = removeLegacyLocalSpeakerLabels(project)
  return {
    ...speakerNormalized,
    schemaVersion: APP_SCHEMA_VERSION,
    localDiarization: normalizedDiarization(speakerNormalized.localDiarization),
    rows: (speakerNormalized.rows as LegacyScriptRow[]).map(migrateRow)
  }
}
```

`loadProject` must call `migrateProject` once and atomically persist only when serialized content changes.

- [ ] **Step 5: Update direct row mutations without auto-approval**

In `App.tsx`, replace the current helper with:

```ts
const updateRow = (id: string, patch: Partial<ScriptRow>): void => {
  applyRows(rows.map((row) => row.id === id ? { ...row, ...patch } : row))
}
```

Add an explicit `approveRow(id)` action that writes `reviewStatus: 'approved'` only when the user presses `확인 완료`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/project-store.test.ts tests/rows.test.ts && npm run typecheck`

Expected: PASS with schema 1, 2, and 3 coverage.

```powershell
git add src/shared/constants.ts src/shared/types.ts src/shared/rows.ts src/main/services/project-store.ts src/renderer/src/App.tsx tests/project-store.test.ts tests/rows.test.ts
git commit -m "feat: add explicit review status and schema migration"
```

---

### Task 3: Plain-Language Analysis Profiles

**Files:**
- Create: `src/shared/analysis-profile.ts`
- Create: `tests/analysis-profile.test.ts`
- Create: `src/renderer/src/components/ProcessingProfilePicker.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/App.tsx:524-638`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: existing `TranscriptionEngine`, `LocalDiarizationConfig`
- Produces: `AnalysisProfile = 'private' | 'accuracy'`
- Produces: `settingsForProfile(profile: AnalysisProfile): AnalysisSettings`

- [ ] **Step 1: Add failing profile mapping tests**

```ts
import { describe, expect, it } from 'vitest'
import { settingsForProfile } from '@shared/analysis-profile'

describe('쉬운 분석 방식', () => {
  it('기본 방식은 외부 전송 없는 로컬 전사다', () => {
    expect(settingsForProfile('private')).toEqual({
      transcriptionEngine: 'local',
      localDiarization: { mode: 'none', speakerCount: null }
    })
  })

  it('정확도 우선은 클라우드 화자 전사를 선택한다', () => {
    expect(settingsForProfile('accuracy')).toEqual({
      transcriptionEngine: 'openai',
      localDiarization: { mode: 'none', speakerCount: null }
    })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/analysis-profile.test.ts`

Expected: FAIL because the profile module does not exist.

- [ ] **Step 3: Implement the mapping**

```ts
import type { AnalysisProfile, LocalDiarizationConfig, TranscriptionEngine } from './types'

export interface AnalysisSettings {
  transcriptionEngine: TranscriptionEngine
  localDiarization: LocalDiarizationConfig
}

export function settingsForProfile(profile: AnalysisProfile): AnalysisSettings {
  return profile === 'accuracy'
    ? { transcriptionEngine: 'openai', localDiarization: { mode: 'none', speakerCount: null } }
    : { transcriptionEngine: 'local', localDiarization: { mode: 'none', speakerCount: null } }
}
```

- [ ] **Step 4: Build the accessible picker**

`ProcessingProfilePicker` must render native radio inputs with these exact visible strings:

- `내 PC에서 분석` / `음성을 외부로 보내지 않습니다. 처음 분석할 때 모델을 내려받습니다.`
- `정확도 우선 분석` / `음성을 외부 서비스로 전송합니다. API 키와 비용이 필요할 수 있습니다.`

Put the existing local speaker-count controls under a collapsed `고급 설정` disclosure. The selected card must use both checked state and text, not color alone.

- [ ] **Step 5: Replace the new-project model selector**

`NewProjectPanel` stores `AnalysisProfile`, calls `settingsForProfile`, and passes those values to `createProject`. When `accuracy` is selected without an API key, the primary button text remains visible and pressing it opens the existing settings screen with the message `정확도 우선 분석을 사용하려면 API 키를 먼저 저장하세요.`

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/analysis-profile.test.ts && npm run typecheck && npm run build`

Manual check: Windows 125% scaling, keyboard Tab/Space selection, visible external-transfer copy.

```powershell
git add src/shared/analysis-profile.ts src/shared/types.ts src/renderer/src/components/ProcessingProfilePicker.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/analysis-profile.test.ts
git commit -m "feat: add plain-language analysis profiles"
```

---

### Task 4: Review Issue Engine and Queue

**Files:**
- Create: `src/shared/review-issues.ts`
- Create: `src/shared/review-navigation.ts`
- Create: `tests/review-issues.test.ts`
- Create: `tests/review-navigation.test.ts`
- Create: `src/renderer/src/components/ReviewQueue.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/App.tsx:1004-1755`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Produces: `collectReviewIssues(rows: ScriptRow[], segments: TranscriptSegment[]): ReviewIssue[]`
- Produces: `nextIssueRowId(issues: ReviewIssue[], currentRowId?: string): string | null`
- Consumes: `DiarizationRunInfo.unassignedWordCount`, `ambiguousWordCount`

- [ ] **Step 1: Write failing issue tests**

```ts
it('시간·내용·화자 문제를 행별로 모은다', () => {
  const rows = [
    makeRow({ id: 'a', startMs: 0, endMs: 3_000, content: '안녕', speakers: [] }),
    makeRow({ id: 'b', startMs: 2_000, endMs: 4_000, content: '', speakers: [] })
  ]
  expect(collectReviewIssues(rows, [])).toEqual([
    { id: 'overlap:a:b', rowId: 'b', kind: 'timeOverlap', message: '이전 구간과 시간이 겹칩니다.', blocking: true },
    { id: 'empty:b', rowId: 'b', kind: 'emptyContent', message: '대사 또는 해설 내용이 비어 있습니다.', blocking: true }
  ])
})
```

Add navigation tests for wrap-around and an empty issue list.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/review-issues.test.ts tests/review-navigation.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement deterministic issue collection**

```ts
export type ReviewIssueKind = 'invalidRange' | 'timeOverlap' | 'emptyContent' | 'speakerUncertain' | 'correctionPending'

export interface ReviewIssue {
  id: string
  rowId: string
  kind: ReviewIssueKind
  message: string
  blocking: boolean
}

export function nextIssueRowId(issues: ReviewIssue[], currentRowId?: string): string | null {
  const ordered = [...new Set(issues.map((issue) => issue.rowId))]
  if (ordered.length === 0) return null
  const index = currentRowId ? ordered.indexOf(currentRowId) : -1
  return ordered[(index + 1) % ordered.length]
}
```

`collectReviewIssues` sorts rows by time, emits stable IDs, and never mutates the project. Existing export blocking must use `issues.filter((issue) => issue.blocking)`.

- [ ] **Step 4: Add the visible review queue**

`ReviewQueue` groups items into `내보내기 전 수정` and `확인 권장`, shows plain Korean messages, and exposes one primary button `다음 확인 필요 구간`. Clicking any item selects the row and seeks the media player.

- [ ] **Step 5: Keep approval explicit**

When a row has a blocking issue, show `확인 완료` disabled with the adjacent explanation. Resolving the issue changes the row to `unreviewed`; the writer must still press `확인 완료`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/review-issues.test.ts tests/review-navigation.test.ts tests/rows.test.ts && npm run typecheck && npm run build`

```powershell
git add src/shared/review-issues.ts src/shared/review-navigation.ts src/shared/types.ts src/renderer/src/components/ReviewQueue.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/review-issues.test.ts tests/review-navigation.test.ts
git commit -m "feat: guide writers through review issues"
```

---

### Task 5: Three-Zone Focus Review Workspace

**Files:**
- Create: `src/renderer/src/components/ReviewWorkspace.tsx`
- Create: `src/renderer/src/components/CurrentRowEditor.tsx`
- Create: `src/renderer/src/components/ReviewProgress.tsx`
- Create: `src/shared/review-progress.ts`
- Create: `tests/review-progress.test.ts`
- Modify: `src/renderer/src/App.tsx:1004-1755`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `ReviewIssue[]`, current `MediaHandle`, current row mutation callbacks
- Produces: `reviewProgress(rows: ScriptRow[], issues: ReviewIssue[]): ReviewProgressSummary`
- Preserves: split, merge, add, delete, seek, speaker rename, font-size controls

- [ ] **Step 1: Write failing progress tests**

```ts
it('검수 상태와 내보내기 차단 수를 요약한다', () => {
  expect(reviewProgress([
    makeRow({ reviewStatus: 'approved' }),
    makeRow({ reviewStatus: 'unreviewed' }),
    makeRow({ reviewStatus: 'needsAttention' })
  ], [makeIssue({ blocking: true })])).toEqual({
    approved: 1,
    unreviewed: 1,
    needsAttention: 1,
    blockingIssues: 1,
    total: 3
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/review-progress.test.ts`

Expected: FAIL because the progress helper does not exist.

- [ ] **Step 3: Implement the pure summary helper**

```ts
export function reviewProgress(rows: ScriptRow[], issues: ReviewIssue[]): ReviewProgressSummary {
  return {
    approved: rows.filter((row) => row.reviewStatus === 'approved').length,
    unreviewed: rows.filter((row) => row.reviewStatus === 'unreviewed').length,
    needsAttention: rows.filter((row) => row.reviewStatus === 'needsAttention').length,
    blockingIssues: issues.filter((issue) => issue.blocking).length,
    total: rows.length
  }
}
```

- [ ] **Step 4: Extract without changing behavior**

Move the selected-row controls from `ReviewScreen` into `CurrentRowEditor`. Keep callbacks owned by `ReviewScreen`; do not move project persistence into child components. Extract the progress display and queue before changing layout.

- [ ] **Step 5: Apply the three-zone layout**

Desktop widths of 1280px and above use `minmax(320px, 0.9fr) minmax(420px, 1.3fr) minmax(280px, 0.8fr)`. Below 1280px, place the queue under the current-row editor. The current row editor receives the strongest visual hierarchy; the full table remains available behind `전체 행 보기`.

All visible controls must have Korean text labels or `aria-label`. Focus order is video controls → current row → review queue → export.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/review-progress.test.ts && npm run typecheck && npm run build`

Manual check: 1280×720, 1920×1080, Windows scaling 125% and 150%, mouse-only and keyboard-only completion of one row.

```powershell
git add src/shared/review-progress.ts src/renderer/src/components/ReviewWorkspace.tsx src/renderer/src/components/CurrentRowEditor.tsx src/renderer/src/components/ReviewProgress.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/review-progress.test.ts
git commit -m "feat: add focused three-zone review workspace"
```

---

### Task 6: Automatic Project Snapshots and Restore

**Files:**
- Create: `src/main/services/project-snapshots.ts`
- Create: `tests/project-snapshots.test.ts`
- Create: `src/renderer/src/components/SnapshotDialog.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/project-store.ts`
- Modify: `src/main/index.ts:331-390`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `createProjectSnapshot(project, directory, reason): Promise<ProjectSnapshot>`
- Produces: `listProjectSnapshots(projectId): Promise<ProjectSnapshot[]>`
- Produces: `restoreProjectSnapshot(projectId, snapshotId): Promise<ScriptProject>`
- Adds App API: `listSnapshots`, `restoreSnapshot`

- [ ] **Step 1: Write failing retention and restore tests**

```ts
it('최근 10개 JSON 스냅샷만 유지하고 음성 파일을 복사하지 않는다', async () => {
  for (let index = 0; index < 12; index += 1) {
    await createProjectSnapshot(makeProject(`수정 ${index}`), directory, 'bulk-edit')
  }
  const snapshots = await listSnapshotsInDirectory(directory)
  expect(snapshots).toHaveLength(10)
  expect(await readdir(join(directory, 'snapshots'))).not.toContain('media')
})

it('복원 전에 현재 프로젝트를 안전 스냅샷으로 남긴다', async () => {
  const restored = await restoreSnapshotInDirectory(directory, snapshotId)
  expect(restored.rows[0].content).toBe('복원된 대사')
  expect((await listSnapshotsInDirectory(directory))[0].reason).toBe('before-restore')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/project-snapshots.test.ts`

Expected: FAIL because snapshot services do not exist.

- [ ] **Step 3: Implement atomic JSON snapshots**

```ts
export type SnapshotReason = 'analysis-complete' | 'bulk-edit' | 'speaker-rename' | 'correction-batch' | 'before-export' | 'before-restore'

export interface ProjectSnapshot {
  id: string
  createdAt: string
  reason: SnapshotReason
  rowCount: number
}
```

Store snapshot JSON under `<project>/snapshots/<ISO-safe>-<uuid>.json`, write atomically, and remove the oldest files after sorting metadata by `createdAt`. Validate that resolved paths remain within the project's `snapshots` directory before reading or removing.

- [ ] **Step 4: Connect snapshot creation points**

Create snapshots after analysis completes and before speaker rename, bulk correction, export, and restore. A single-row edit relies on existing autosave and undo; it must not create a snapshot for every keystroke.

- [ ] **Step 5: Add a two-click restore flow**

The header button reads `이전 상태 복원`. `SnapshotDialog` shows date, reason in Korean, and row count. Clicking one item then `이 상태로 복원` performs the restore and displays `이전 상태로 복원했습니다. 복원 직전 상태도 보관했습니다.`

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/project-snapshots.test.ts tests/project-store.test.ts && npm run typecheck && npm run build`

```powershell
git add src/shared/types.ts src/main/services/project-snapshots.ts src/main/services/project-store.ts src/main/index.ts src/preload/index.ts src/renderer/src/components/SnapshotDialog.tsx src/renderer/src/App.tsx tests/project-snapshots.test.ts
git commit -m "feat: add recoverable project snapshots"
```

---

### Task 7: Provider Registry and Normalized Evidence

**Files:**
- Create: `src/main/services/provider-registry.ts`
- Create: `tests/provider-registry.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/local-transcription.ts`
- Modify: `src/main/services/openai-transcription.ts`
- Modify: `src/main/index.ts:67-251`
- Modify: `tests/local-transcription.test.ts`
- Modify: `tests/openai-transcription.test.ts`

**Interfaces:**
- Produces: `TranscriptionProviderId`
- Produces: `TranscriptionCapabilities`
- Changes: `TranscriptionProvider.transcribe` returns `TranscriptionResult`
- Produces: `providerForProject(project, dependencies): RegisteredProvider`

- [ ] **Step 1: Add failing provider selection tests**

```ts
it('기존 프로젝트 설정을 안정적인 공급자 ID로 변환한다', () => {
  expect(providerIdForProject(makeProject({ transcriptionEngine: 'local', localDiarization: { mode: 'none', speakerCount: null } }))).toBe('local-whisper')
  expect(providerIdForProject(makeProject({ transcriptionEngine: 'local', localDiarization: { mode: 'sherpa-onnx', speakerCount: null } }))).toBe('local-sherpa')
  expect(providerIdForProject(makeProject({ transcriptionEngine: 'openai' }))).toBe('openai-diarized')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/provider-registry.test.ts`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Define normalized provider evidence**

```ts
export type TranscriptionProviderId = 'local-whisper' | 'local-sherpa' | 'openai-diarized' | 'gemini-transcribe'

export interface TranscriptionCapabilities {
  speakerLabels: boolean
  wordTimestamps: boolean
  glossaryHints: boolean
  cloud: boolean
}

export interface TranscriptionResult {
  providerId: TranscriptionProviderId
  model: string
  segments: TranscriptSegment[]
  capabilities: TranscriptionCapabilities
}

export interface TranscriptionProvider {
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>
}
```

- [ ] **Step 4: Update existing providers**

`LocalWhisperTranscriptionProvider` returns `local-whisper`, the pinned local model name, no speaker labels, word timestamps when available, no cloud. `OpenAiTranscriptionProvider` returns `openai-diarized`, `OPENAI_MODEL`, speaker labels, segment timestamps, and cloud true.

Keep current fallback behavior: if local diarization fails, retain local Whisper segments and add a warning; do not convert failure into an empty successful result.

- [ ] **Step 5: Store the provider evidence in ProcessingRun**

Add `providerId` and `capabilities` to `ProcessingRun`. Keep legacy `provider: 'local' | 'openai'` during schema 3 so older diagnostics and release tooling continue to work.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/provider-registry.test.ts tests/local-transcription.test.ts tests/openai-transcription.test.ts tests/openai-transcription-retry.test.ts tests/speaker-diarization.test.ts && npm run typecheck`

```powershell
git add src/shared/types.ts src/main/services/provider-registry.ts src/main/services/local-transcription.ts src/main/services/openai-transcription.ts src/main/index.ts tests/provider-registry.test.ts tests/local-transcription.test.ts tests/openai-transcription.test.ts
git commit -m "refactor: normalize transcription provider evidence"
```

---

### Task 8: Local Glossary and Provider Hints

**Files:**
- Create: `src/main/services/glossary-store.ts`
- Create: `tests/glossary-store.test.ts`
- Create: `src/renderer/src/components/GlossaryDialog.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/local-transcription.ts`
- Modify: `src/main/services/openai-transcription.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `GlossaryEntry`
- Produces: `listGlossaryEntries`, `upsertGlossaryEntry`, `deleteGlossaryEntry`
- Adds: `TranscriptionRequest.glossaryTerms?: string[]`
- Adds App API: `listGlossary`, `saveGlossaryEntry`, `deleteGlossaryEntry`

- [ ] **Step 1: Write failing glossary tests**

```ts
it('올바른 표기와 오인식 표기를 정규화해 원자적으로 저장한다', async () => {
  await upsertGlossaryEntry(root, {
    id: 'person-hong',
    canonical: '홍길동',
    aliases: ['홍 길동', '홍길똥', '홍 길동'],
    category: 'person',
    updatedAt: '2026-08-29T00:00:00.000Z'
  })
  expect(await listGlossaryEntries(root)).toEqual([{
    id: 'person-hong',
    canonical: '홍길동',
    aliases: ['홍 길동', '홍길똥'],
    category: 'person',
    updatedAt: '2026-08-29T00:00:00.000Z'
  }])
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/glossary-store.test.ts`

Expected: FAIL because the glossary store does not exist.

- [ ] **Step 3: Implement a local-only glossary store**

```ts
export interface GlossaryEntry {
  id: string
  canonical: string
  aliases: string[]
  category: 'person' | 'place' | 'title' | 'term'
  updatedAt: string
}
```

Store `glossary.json` under the existing app user-data directory, reject empty canonical names, remove duplicate aliases, cap entries at 1,000, and write atomically. Do not include the glossary in diagnostics.

- [ ] **Step 4: Pass only relevant terms to capable providers**

Before analysis, select at most 100 canonical terms used by the current project or explicitly selected in `GlossaryDialog`. Set `request.glossaryTerms` only when `capabilities.glossaryHints` is true. For providers without hint support, retain the list for post-transcription highlighting and do not send unsupported API fields.

- [ ] **Step 5: Add writer-facing management**

The dialog title is `이름과 용어 기억하기`. Fields are `올바른 표기`, `자주 잘못 적히는 표기`, and `종류`. After manual correction, offer the non-blocking action `다음 작업에서도 이 표기를 기억할까요?` with `기억하기` and `이번만 수정`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/glossary-store.test.ts tests/local-transcription.test.ts tests/openai-transcription.test.ts && npm run typecheck && npm run build`

```powershell
git add src/shared/types.ts src/main/services/glossary-store.ts src/main/services/local-transcription.ts src/main/services/openai-transcription.ts src/main/index.ts src/preload/index.ts src/renderer/src/components/GlossaryDialog.tsx src/renderer/src/App.tsx tests/glossary-store.test.ts
git commit -m "feat: add local writer glossary"
```

---

### Task 9: Safe Correction Suggestions and Diff Approval

**Files:**
- Create: `src/shared/corrections.ts`
- Create: `tests/corrections.test.ts`
- Create: `src/main/services/correction-service.ts`
- Create: `tests/correction-service.test.ts`
- Create: `src/renderer/src/components/CorrectionDiff.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/project-store.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `CorrectionSuggestion`
- Produces: `validateCorrection(original, proposed, glossary): CorrectionValidation`
- Adds App API: `requestCorrections`, `resolveCorrection`
- Consumes: glossary and snapshot services

- [ ] **Step 1: Write failing safety tests**

```ts
it('띄어쓰기와 등록된 고유명사 교정은 제안할 수 있다', () => {
  expect(validateCorrection('홍 길동이 들어 온다', '홍길동이 들어온다', ['홍길동']).allowed).toBe(true)
})

it('원문과 연결되지 않는 문장이 추가되면 일괄 적용을 막는다', () => {
  expect(validateCorrection('문이 열린다', '문이 열리고 영희가 웃으며 들어온다', []).allowed).toBe(false)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/corrections.test.ts tests/correction-service.test.ts`

Expected: FAIL because correction modules do not exist.

- [ ] **Step 3: Define immutable suggestions**

```ts
export type CorrectionReason = 'spacing' | 'spelling' | 'punctuation' | 'properNoun'
export type CorrectionStatus = 'pending' | 'applied' | 'rejected'

export interface CorrectionSuggestion {
  id: string
  rowId: string
  original: string
  proposed: string
  reasons: CorrectionReason[]
  confidence: number
  status: CorrectionStatus
  createdAt: string
  resolvedAt?: string
}
```

`validateCorrection` must reject empty output, a duration- or speaker-changing response, and proposals whose normalized token count exceeds the original by more than 20% unless every added token appears in the selected glossary.

- [ ] **Step 4: Generate structured suggestions without saving over rows**

`correction-service.ts` receives selected rows and glossary terms, requests JSON matching `CorrectionSuggestion[]`, validates every result again locally, and returns suggestions. It must not call `saveRows`. API errors use the existing sanitized error path and must not place row text in logs.

- [ ] **Step 5: Apply or reject one suggestion at a time**

`CorrectionDiff` shows `현재 대사`, `제안`, and highlighted changed text with buttons `적용`, `거부`, `나중에 확인`. Applying verifies that the row still equals `original`, creates a `correction-batch` snapshot before the first applied item, updates the row, and records `applied`. A stale original returns `대사가 이미 바뀌어 이 제안은 적용하지 않았습니다.`

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/corrections.test.ts tests/correction-service.test.ts tests/project-store.test.ts && npm run typecheck && npm run build`

Manual check: no suggestion silently changes a row; undo and snapshot restore both recover applied suggestions.

```powershell
git add src/shared/corrections.ts src/shared/types.ts src/main/services/correction-service.ts src/main/services/project-store.ts src/main/index.ts src/preload/index.ts src/renderer/src/components/CorrectionDiff.tsx src/renderer/src/App.tsx tests/corrections.test.ts tests/correction-service.test.ts
git commit -m "feat: add reviewable correction suggestions"
```

---

### Task 10: Full Workflow, Export, and Compatibility Gate

**Files:**
- Modify: `tests/hwpx.test.ts`
- Modify: `tests/srt.test.ts`
- Modify: `tests/diagnostics.test.ts`
- Modify: `tests/project-store.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/RELEASE.md`

**Interfaces:**
- Consumes: schema 3 projects, review issues, correction state, provider evidence
- Produces: verified v0.6 release candidate behavior

- [ ] **Step 1: Add a schema 3 export fixture**

Create a test project with approved, unreviewed, and description-gap rows; two speakers; one rejected correction; and no blocking issue. Assert HWPX and SRT content remains based on current rows, not rejected suggestions.

```ts
expect(hwpxPreview).toContain('[홍길동] 문이 열린다')
expect(hwpxPreview).not.toContain('거부된 교정문')
expect(srt).toContain('00:00:01,000 --> 00:00:03,000')
```

- [ ] **Step 2: Add privacy regression assertions**

Diagnostics from a project containing glossary entries and correction suggestions must omit the canonical terms, aliases, row text, audio path, and API key. Keep provider ID, capability flags, error category, duration, byte count, and sanitized request ID.

- [ ] **Step 3: Run the complete automated gate**

Run: `npm run verify`

Expected: typecheck, all Vitest tests, and production build PASS.

- [ ] **Step 4: Perform the Windows manual matrix**

Complete each row and record evidence in `docs/RELEASE.md`:

| Scenario | Required result |
| --- | --- |
| Local file, private profile | No external upload; HWPX/SRT export succeeds |
| Local diarization advanced option | Speaker labels editable; fallback preserves dialogue |
| Accuracy profile | External-transfer warning visible; API failure gives recovery action |
| YouTube permitted link | Download, analysis, review, and deletion behave as documented |
| Snapshot restore | Current state preserved before restore |
| Correction proposal | No text change before approval |
| Hancom Office 2022 | HWPX opens without recovery warning |
| Windows 125%/150% scaling | Primary controls remain visible and reachable |

- [ ] **Step 5: Update docs with exact user copy**

`USER_GUIDE.md` begins with the three-step flow and explains `내 PC에서 분석` before advanced settings. `ARCHITECTURE.md` documents schema 3, normalized provider evidence, snapshots, local glossary, and correction isolation. `RELEASE.md` includes the writer-first release gates.

- [ ] **Step 6: Commit the release gate**

```powershell
git add tests/hwpx.test.ts tests/srt.test.ts tests/diagnostics.test.ts tests/project-store.test.ts docs/ARCHITECTURE.md docs/USER_GUIDE.md docs/RELEASE.md
git commit -m "test: gate the writer-first workflow"
```

---

### Task 11: Screen-Description Writer Pilot and Beta Decision

**Files:**
- Create: `docs/qa/WRITER_PILOT.md`
- Create: `docs/qa/WRITER_PILOT_RESULT_TEMPLATE.md`
- Modify: `docs/RELEASE.md`
- Modify: `CHANGELOG.md` if it exists at release time
- Modify: `package.json` only when all release gates pass

**Interfaces:**
- Consumes: a signed-off release candidate and rights-cleared pilot media
- Produces: task completion rate, review time, corrections per 10 minutes, critical incident count, go/no-go decision

- [ ] **Step 1: Write the pilot protocol**

Use 5 to 8 practicing screen-description writers. Do not teach the UI before the first run. Ask each participant to complete these tasks:

1. Create a project from a local video.
2. Start the default analysis.
3. Find and fix one wrong line.
4. Rename one speaker.
5. Move to the next item requiring review.
6. Mark a row complete.
7. Export HWPX.
8. Reopen the project and restore a prior state.

- [ ] **Step 2: Record only consented, minimal measures**

The result template stores participant code, experience range, task completion, elapsed minutes, help requests, observed confusion, and severity. It must not contain the source video, full script text, participant name, contact details, or API key.

- [ ] **Step 3: Apply the release decision rule**

Release as v0.6 beta only when all are true:

- unassisted end-to-end completion rate is at least 90%;
- median review time per 10 video minutes is at least 25% lower than the v0.5 baseline;
- HWPX/SRT export failures are zero;
- critical invented-dialogue incidents are zero;
- every severity-1 usability problem is fixed and rerun with the affected task.

- [ ] **Step 4: Re-run verification after pilot fixes**

Run: `npm run verify`

Expected: PASS after every pilot-driven code change.

- [ ] **Step 5: Update version and release notes only after passing**

Set the agreed SemVer prerelease version in `package.json`, summarize writer-visible changes in `CHANGELOG.md`, and follow `docs/RELEASE.md`. Do not describe automated tests as human review.

- [ ] **Step 6: Commit the pilot decision**

```powershell
git add docs/qa docs/RELEASE.md package.json
if (Test-Path CHANGELOG.md) { git add CHANGELOG.md }
git commit -m "docs: record writer pilot and beta decision"
```

---

## Evaluation Provider Track

The product tasks above keep existing production providers stable. During weeks 6 to 8, run the following comparison outside the user-facing app:

1. Current local Whisper baseline
2. Current local Whisper + sherpa-onnx
3. Current OpenAI diarized transcription
4. OpenAI general transcription with glossary hints where timestamps permit the target export
5. Gemini 3.5 Transcribe in verbatim mode with speaker labels and word timestamps, within its documented duration and speaker limits

For every candidate, store only provider ID, model version, aggregate CER/WER/DER/SubER/hotword scores, runtime, cost, and failure category in `evaluation/results`. Do not store transcripts in aggregate result files.

A candidate receives a production integration task only after meeting the model adoption conditions in the spec. Until then, it remains a developer evaluation adapter and is not shown to writers.

## Final Verification Checklist

- [ ] Every requirement in the design spec maps to Task 1 through Task 11.
- [ ] `rg -n "T[B]D|T[O]DO|implement l[a]ter|Similar to T[a]sk" docs/superpowers/plans/2026-08-29-writer-first-upgrade.md` returns no matches.
- [ ] All new shared type names are used consistently across main, preload, and renderer.
- [ ] Schema 1, 2, and 3 migration tests pass without content loss.
- [ ] Private evaluation data and results are ignored by Git.
- [ ] `npm run verify` passes.
- [ ] HWPX opens in Hancom Office 2022 without a repair warning.
- [ ] Five or more screen-description writers complete the pilot protocol.
