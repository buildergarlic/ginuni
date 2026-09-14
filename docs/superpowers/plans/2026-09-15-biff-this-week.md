# 기누니 외화 작업 이번 주 제공 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 이 문서는 설계 요청에 대한 계획이며, 실제 구현 착수는 별도 작업 지시 시 수행한다.

**Goal:** 2026-09-18 금요일까지 작가가 한국어 SRT 또는 지원 담당자가 준비한 SRT로 영상 검수와 화면해설 작성·HWPX/SRT 출력을 시작하도록 한다.

**Architecture:** 기존 Electron/React 편집·검수·출력 기능을 재사용하고 자막 가져오기만 별도 경로로 추가한다. 불변 원본 큐와 현재 편집 행을 분리하며 ASR 전용 시간 반올림·행 병합을 우회한다. 영상에만 자막이 있으면 이번 주에는 별도 지원 작업에서 OCR·검수한 SRT를 준비한다.

**Tech Stack:** 기존 TypeScript, Electron, React, Vitest, FFmpeg/FFprobe. 지원형 OCR 후보는 RapidOCR/ONNX Runtime CPU와 한국어 PP-OCRv5이며 실제 표본 통과 전 앱 의존성에 추가하지 않는다.

**Spec:** [외화 화면해설 작업 대응 설계](../specs/2026-09-15-biff-foreign-film-design.md)

## Global Constraints

- 최우선 제약은 ‘이번 주 바로 사용’이다.
- 첫 사용 가능한 후보는 9월 17일 목요일, 작가 PC에서 확인한 제공 목표는 9월 18일 금요일로 잡는다.
- 앱 스키마는 2→3으로 명시적 마이그레이션하며 기존 workflow version 1은 유지한다.
- 이번 주 편집본의 정본은 `project.rows`다.
- 자막 없음과 무음을 구별한다. 자동으로 해설 가능을 확정하지 않는다.
- 영상의 `SourceKind = local | youtube`는 유지한다.
- 원본 자막 문구·밀리초·원본 출처와 작가의 작성 내용을 보존한다.
- 기존 ASR `runs`와 자막 가져오기 기록을 분리한다.
- 이번 주 편집 행은 기존 비겹침 규칙을 유지한다. 원본 큐는 겹침도 보존한다.
- 실제 검증 없이 OCR 정확도·본편 처리시간·다섯 편 인계 완료를 주장하지 않는다.
- 프로젝트 원본 영상·대사·API 키를 코드 저장소·CI 로그에 넣지 않는다.
- 이 계획 저장만으로 코드 변경·외부 전송·배포가 수행된 것은 아니다.

## 1. 독립 작업과 의존 관계

앱 경로: A 자료 계약/모델 → B SRT 가져오기 → C 검수·시간 보정 → D 출력·복구 → F 실제 제공판 검증.

지원 경로: E 자막 트랙 조사/OCR 표본 → 본편 SRT 검수 → F 첫 작품 인계. E는 앱 개발과 병렬로 진행하되, 별도 담당자가 없으면 같은 개발자의 작업시간을 중복 계산하지 않는다.

개발자 한 명의 이번 주 임계 경로는 A~D와 F다. 통합 OCR·다국어 번역·자동 정렬을 여기에 추가하지 않는다. 이번 주 자막만 있는 입력의 자동 처리 약속은 아래 E의 결과에 조건부다.

## 2. 최소 자료 계약

새 파일 `src/shared/subtitle-types.ts`에서 아래 이름과 필드를 공통으로 정의한다. 이 단계에서는 API 호출용 데이터 정의를 고정하며 별도 범용 플러그인 시스템을 만들지 않는다.

```ts
export interface SubtitleAsset {
  id: string
  fileName: string
  sha256: string
  encoding: string
  language: string
  sourceKind: 'provided-srt' | 'ocr-srt'
  declaredAuthority: 'festival-provided' | 'support-produced' | 'unknown'
  importedAt: string
  originalRelativePath: string
}
export interface SubtitleCue {
  id: string
  assetId: string
  ordinal: number
  startMs: number
  endMs: number
  text: string
}
export interface SubtitleIssue {
  code: 'encoding' | 'syntax' | 'range' | 'overlap' | 'style'
  severity: 'error' | 'warning'
  ordinal?: number
  message: string
}
export interface SubtitleImportRecord {
  id: string
  assetId: string
  at: string
  cueCount: number
  appliedRowCount: number
  offsetMs: number
  resolutions: SubtitleResolution[]
}
export interface SubtitleResolution {
  cueIds: string[]
  startMs: number
  endMs: number
  text?: string
  reason: string
}
export interface SubtitleWorkspace {
  version: 1
  assets: SubtitleAsset[]
  cues: SubtitleCue[]
  imports: SubtitleImportRecord[]
  activeAssetId?: string
}
export interface SubtitlePreview {
  previewId: string
  asset: SubtitleAsset
  cues: SubtitleCue[]
  issues: SubtitleIssue[]
  expectedRevision: number
}
```

`originalRelativePath`는 프로젝트 내부 저장 위치이며 메인 프로세스만 실제 경로로 해석한다. 렌더러가 임의 파일 경로를 지정하지 못하게 한다. 미리보기는 메인 프로세스의 임시 상태이며 프로젝트 ID·revision·파일 해시와 묶는다. 취소 시 버리고 적용 시 원본을 프로젝트 내부에 보관한다.

`ScriptProject.subtitleWorkspace?: SubtitleWorkspace`, `ScriptRow.sourceCueIds?: string[]`를 추가한다. 기존 ASR의 `sourceSegmentIds`는 유지한다. 새 필드는 기존 `ProcessingRun`의 provider나 speaker 추정 규칙으로 표현하지 않는다.

공용 함수 계약:

- `parseSrt(text: string, assetId: string): { cues: SubtitleCue[]; issues: SubtitleIssue[] }` — 정수 밀리초와 원문 줄바꿈 보존. 큐 ID 생성은 기존 UUID 방식 사용.
- `validateSubtitleCues(cues: SubtitleCue[]): SubtitleIssue[]` — 원본 ID·문장·구문·음수·역전·순서 검사. 영상 길이는 아직 적용하지 않으며 오류 큐를 조용히 제거하지 않음.
- `generateSubtitleRows(cues: SubtitleCue[], offsetMs: number, resolutions?: SubtitleResolution[]): ScriptRow[]` — 기본 1큐→1행, 시간 반올림·자동 공백 행 없음, `sourceCueIds` 연결. 명시한 해결 그룹만 합치거나 수정.
- `validateSubtitleRows(rows: ScriptRow[], durationMs: number): SubtitleIssue[]` — 보정·해결값 적용 후 실제 영상 범위·역전·겹침 검사.
- `previewSubtitleImport(projectId: string, expectedRevision: number): Promise<SubtitlePreview | null>` — 메인 파일 선택창 사용.
- `applySubtitleImport(projectId: string, previewId: string, offsetMs: number, resolutions: SubtitleResolution[], expectedRevision: number): Promise<ScriptProject>` — 변경 전 snapshot, 입력·revision 재검사, 원자적 적용.
- `shiftSubtitleRows(projectId: string, rowIds: string[], deltaMs: number, expectedRevision: number): Promise<ScriptProject>` — 현재 선택 행을 한 번만 이동, 범위/겹침 검사, snapshot, 승인 해제.

`SubtitleResolution`의 시간은 전체 offset을 적용한 뒤의 영상 기준 밀리초다. 같은 큐를 여러 해결 그룹에 넣거나 미리보기에 없는 ID를 지정하면 거부한다. 여러 큐를 합칠 때 text 생략 시 원래 순서의 문장을 줄바꿈으로 연결한다. 원본 큐는 변경하지 않고 적용 행의 sourceCueIds와 import record에 해결 근거를 남긴다.

## Task A: 영상만 준비하고 수동 작업을 시작하는 기반

**Files**

- Create: `src/shared/subtitle-types.ts`, `src/main/services/media-inspection.ts`
- Modify: `src/shared/types.ts`, `src/shared/constants.ts`, `src/main/services/media.ts`, `src/main/services/project-store.ts`
- Test: `tests/project-store.test.ts`, `tests/project-workflow-store.test.ts`, `tests/media-verification.test.ts`

**Interfaces:** 위 최소 자료 계약. `inspectLocalMedia(project, signal)`는 영상 길이·크기·원본 해시를 채우되 ASR 모델 다운로드나 음성 변환을 요구하지 않는다. 오디오 분석이 필요한 기존 `prepareMedia`만 오디오 존재 검사를 유지한다.

- [ ] 신규 필드를 저장·다시 열기·snapshot 복구하는 사례를 먼저 정의한다. 스키마 1→2→3, 스키마 2→3의 작성 내용·화자·검수 이력 보존을 확인한다.
- [ ] 새 스키마보다 높은 버전 파일은 자동 다운그레이드하거나 덮어쓰지 않는 검사를 추가한다.
- [ ] 영상 정보 확인을 오디오 추출에서 분리하고 기존 ASR 호출 결과가 변하지 않게 연결한다.
- [ ] 음성 분석 없이 로컬 영상의 수동 대본 작업을 시작할 수 있게 한다. 빈 프로젝트에도 첫 대사 추가 동작을 만들며, 아직 시간을 지정하지 않은 문단은 임시 입력창에서 편집한다. 기존 rows는 유한한 시작·종료 시간 규칙을 유지한다.
- [ ] 새 자막 출처를 원본 파일 ID로 연결하고 프로젝트 내부 상대 경로만 허용한다.
- [ ] 관련 검증: `npx vitest run tests/project-store.test.ts tests/project-workflow-store.test.ts tests/media-verification.test.ts`.

**완료 결과:** 자막 파일의 메타데이터와 원본 큐를 기존 프로젝트에 안전하게 추가할 기반, 음성 인식 없이 재생·수동 편집 가능한 프로젝트.

## Task B: SRT 미리보기와 자막별 대사 행

**Files**

- Create: `src/main/services/subtitle-import.ts`, `src/main/services/subtitle-ingestion.ts`, `src/shared/subtitle-rows.ts`
- Modify: `src/main/services/project-store.ts`, `src/shared/workflow.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/subtitle-import.test.ts`, `tests/subtitle-ingestion.test.ts`, `tests/subtitle-rows.test.ts`

**Interfaces:** `parseSrt`, `validateSubtitleCues`, `generateSubtitleRows`, `validateSubtitleRows`, `previewSubtitleImport`, `applySubtitleImport`를 위 계약대로 구현한다. 기존 `executeVerifiedAnalysis`의 무조건 행 재생성 경로는 사용하지 않는다. snapshot·revision·원자적 갱신 원칙만 재사용한다.

핵심 회귀 예시:

```ts
const input = '1\r\n00:00:01,250 --> 00:00:02,875\r\n첫 줄\r\n둘째 줄\r\n'
const parsed = parseSrt(input, 'asset-1')
expect(parsed.cues).toHaveLength(1)
expect(parsed.cues[0]).toMatchObject({
  startMs: 1250, endMs: 2875, text: '첫 줄\n둘째 줄'
})
const rows = generateSubtitleRows(parsed.cues, 0)
expect(rows[0]).toMatchObject({ startMs: 1250, endMs: 2875 })
expect(rows[0].sourceCueIds).toEqual([parsed.cues[0].id])
```

- [ ] UTF-8/BOM·UTF-16 BOM·CRLF/LF·여러 줄·자막 번호 불연속을 처리한다. 인코딩이 명확하지 않으면 선택 또는 지원 변환으로 안내한다.
- [ ] 스타일 태그 처리 전후를 미리보기로 보여 주고 원본을 보존한다. 입력 HTML을 실행하지 않는다.
- [ ] 원본의 잘못된 시간·빈 문장·중복 ID를 검사하고, 영상 밖 시간과 겹침은 offset/해결값을 적용한 행에서 검사한다. 01:00:00 시작 SRT에 -3600000ms를 적용해 정상 영상 시간으로 들어오는 사례를 포함한다. 미리보기에서 보정 가능한 오류는 보정 입력을 막지 않는다. 서로 다른 시간의 같은 문장은 삭제하지 않는다.
- [ ] 자막 간 2초 미만 공백, 60초 이상 연속 자막에서도 큐 경계와 시간을 유지한다. 자막 공백을 자동 무음·해설 구간으로 만들지 않는다.
- [ ] 겹치는 큐는 원본에 유지하고 해결 전 적용을 막는다. 이번 주는 지원 담당자가 미리보기의 겹침 그룹에서 시간 수정 또는 그룹 합치기를 명시하고 `SubtitleResolution`으로 전달한다. 메인에서 ID·시간·이유와 최종 겹침을 검증한다. 합치면 모든 원본 ID와 변경 이유를 기록한다.
- [ ] 가져오기 미리보기 후 원본 파일 또는 프로젝트 revision이 변하면 적용을 거부하고 기존 해설을 유지한다.
- [ ] 자료 처리 권한 확인을 가져오기 적용에서도 검사한다. 로컬 SRT 입력 자체에는 클라우드 전송이나 음성 전송 동의를 요구하지 않는다.
- [ ] 실패·취소 후 임시 자료만 정리한다. 기존 프로젝트의 원본/행/해설/내보내기 기록을 지우지 않는다.
- [ ] 관련 검증: `npx vitest run tests/subtitle-import.test.ts tests/subtitle-ingestion.test.ts tests/subtitle-rows.test.ts`.

**완료 결과:** 지원 SRT가 1큐→1행으로 안전하게 연결되는 가져오기 API.

## Task C: 작가용 가져오기·싱크·수동 입력 화면

**Files**

- Create: `src/renderer/src/SubtitleImportDialog.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/workflow-editing.ts`, `src/renderer/src/WorkflowPanel.tsx`, `src/renderer/src/atelier.css`
- Test: `tests/renderer-workflow.test.ts`, `tests/review-split.test.ts`, `tests/subtitle-ingestion.test.ts`

**Interfaces:** 미리보기/적용/이동 API와 `ScriptRow.sourceCueIds`. 메인 프로세스가 모든 최종 시간·revision을 검사한다.

- [ ] 새 프로젝트의 시작 방식에 ‘자막 파일로 시작’, ‘대사를 직접 입력’을 추가한다. 자막 작업에 Whisper 모델 설치를 요구하지 않는다.
- [ ] 미리보기에서 출처, 문장·시간, 개수, 오류·겹침을 보여 주고 새 초안 적용 시 기존 대본 백업을 안내한다.
- [ ] 가져오기 전 전체 오프셋 입력과 시작·중간·끝 비교를 제공한다. `+1500ms` 적용을 저장·재열기해도 `+3000ms`가 되지 않는 사례를 검증한다.
- [ ] 적용 후 이동은 현재 선택 행 대상임을 명시하고 겹침·음수·종료 범위 초과 시 전체 작업을 원자적으로 거부한다.
- [ ] 현재 재생 시점을 시작/종료에 넣는 동작과 대사 붙여넣기를 제공한다. 빈 프로젝트는 기존 선택 행 의존 함수를 우회해 첫 대사를 추가한다. 시작과 종료가 모두 유효해질 때만 rows로 저장하고, 시간 지정 중인 문단은 입력창에 유지하며 창을 닫을 때 미저장 내용을 안내한다.
- [ ] 한 큐를 둘로 나누면 양쪽 행이 같은 원본 큐를 참조하고, 여러 큐를 합치면 참조의 합집합을 보존한다. 수정·시간 변경 시 승인 해제한다.
- [ ] OCR SRT에는 ‘영상에서 추출한 자막’ 출처를 표시한다. 자막만 있는 프로젝트에서 화자 경고를 강제로 켜지 않는다.
- [ ] 관련 검증: `npx vitest run tests/renderer-workflow.test.ts tests/review-split.test.ts tests/subtitle-ingestion.test.ts`.

**완료 결과:** 작가가 프로그램 안에서 영상+SRT를 사용하고 시간 없는 대본도 수동 입력할 수 있는 후보판.

## Task D: 출처·내보내기·복구의 연결

**Files**

- Modify: `src/main/services/project-store.ts`, `src/main/services/export-workflow.ts`, `src/main/services/srt.ts`, `src/main/services/hwpx.ts`, `src/shared/workflow.ts`, `src/shared/speaker-labels.ts`
- Test: `tests/export-workflow.test.ts`, `tests/srt.test.ts`, `tests/hwpx.test.ts`, `tests/project-workflow-store.test.ts`

**Interfaces:** 출처 확인은 기존 `sourceSegmentIds`와 신규 `sourceCueIds`를 모두 해석한다. 기존 ASR `runs`의 형식은 이번 주 변경하지 않는다. 내보내기 기록에는 자막 자료 ID/해시와 가져오기 기록 ID를 선택 필드로 추가한다.

- [ ] `saveRows`의 필드 복사·편집 동일성 비교·snapshot·restore에 새 자막 참조와 workspace를 포함한다. 복구 후 편집행/원본 참조가 같은 버전을 가리키게 한다.
- [ ] 수동 작성 행, ASR 행, 자막 행의 출처 판정을 구별한다. 자막 행을 원본 없는 대사로 잘못 보고하지 않는다.
- [ ] 기존 SRT 직렬화로 1250→2875ms와 여러 줄이 유지되는지 왕복 확인한다. 작가의 의도적 분할/병합 후에는 편집 대본 SRT로 기록한다.
- [ ] HWPX 5열 형식과 시작/종료 밀리초를 유지한다. 간격 열이 1초 미만을 0초로 나타내는 문제는 소수 초 표시로 일관되게 처리하고 실제 한컴 레이아웃을 확인한다.
- [ ] 원본을 바꾸는 재가져오기·복구·부분 수정으로 이미 승인한 행이 조용히 바뀌지 않는지 검증한다.
- [ ] 기존 한국어 ASR 프로젝트의 HWPX/SRT 결과를 회귀 검증한다.
- [ ] 관련 검증: `npx vitest run tests/export-workflow.test.ts tests/srt.test.ts tests/hwpx.test.ts tests/project-workflow-store.test.ts`.

**완료 결과:** 가져온 자막과 작성한 해설이 저장·복구·납품 파일까지 일관되게 유지된다.

## Task E: 이번 주 영상 자막의 지원형 추출

**별도 담당이 있으면 A~D와 병렬. 앱 구현과 같은 담당이면 지원 시간을 별도 산정한다.**

**자료 위치:** 실제 영화·자막은 코드 저장소 밖의 접근 제한 작업 폴더. 테스트용 합성 SRT/영상만 저장소에 둔다. 아직 수령하지 않은 파일의 경로나 결과를 가정하지 않는다.

- [ ] 동일 편집본 영상·언어·러닝타임·자막 자료 유무·처리 권한·외부 전송 조건·담당 작가를 작품별로 기록한다.
- [ ] FFprobe로 자막 트랙을 조사한다. 추출 가능한 텍스트 트랙이면 선택한 트랙을 SRT로 만들고 원본과 비교한다. 이미지 트랙과 하드자막은 OCR 경로로 구별한다.
- [ ] 첫 작품 5~10분의 어려운 장면을 포함한 표본으로 한국어 OCR를 실행한다. 최소 100큐를 권장하되 큐가 적으면 표본을 늘린다.
- [ ] 실제 한국어 인식 모델·문자 사전·실행 버전을 기록한다. 기본 모델이 한국어를 처리한다고 가정하지 않는다.
- [ ] 지원 담당자가 원문과 시작·종료를 대조한다. 인식되지 않은 자막도 세고, 부정어·숫자·인명을 확인한다.
- [ ] 자동 본편 확대 목표: 구간 정밀도/재현율 각 98% 이상, CER 2% 이하, 시간 오차 P95 200ms 이하. 미달하면 원인과 사람이 수정하는 시간을 확인한 뒤 지원형 처리 또는 수작업으로 범위를 조정한다.
- [ ] 표본의 기계 처리시간과 사람 교정시간을 각각 본편 길이에 환산한다. 다섯 편의 인계 시간은 작품마다 별도 계산한다.
- [ ] 본편 처리 후 단순 저신뢰도 목록만 보지 말고 영상 자체와 비교해 누락 구간을 확인한다. 검수 범위를 함께 기록한 SRT를 작가에게 제공한다.
- [ ] 앱으로 가져와 초반·중반·후반 싱크를 확인한다. 첫 작품 성공 후 다음 작품의 스타일을 별도로 검사한다.

**중단 기준:** 첫 표본에서 반복 누락·잘못된 시간축·본편보다 더 오래 걸리는 교정 부담이 확인되고 해결되지 않으면, 해당 OCR를 완성 기능으로 제공하지 않는다. 같은 편집본의 공식 자막 요청, 지원 인력의 수동 자막 작성, 원어 전사·번역 표본 중 실제 자료에 맞는 대안을 선택한다. 기누니에는 준비된 작품부터 인계한다.

## Task F: 금요일 작가용 제공판

**Files**

- Modify: `docs/USER_GUIDE.md`, `CHANGELOG.md`, `package.json` 및 lockfile의 릴리스 버전(실제 배포 시)
- Create: `docs/release-notes-biff-pilot.md`(실제 제공 범위와 검증 결과만 기록)

- [ ] `npm run verify`로 타입·테스트·빌드를 확인한다. 실패가 남으면 해결 후 진행한다.
- [ ] Windows 설치본을 만들고 실제 작가 PC에서 영상+자막 가져오기, 수동 수정, 저장, 종료/재열기, HWPX/SRT 출력까지 수행한다.
- [ ] 90분 이상 영상의 중간·끝 탐색과 2줄 자막·한글 경로를 확인한다. 3시간을 넘는 작품은 현재 한도 밖으로 표시하고 분할 지원을 별도 결정한다.
- [ ] 실제 한컴에서 첫/중간/끝 페이지, 5열 정렬, 소수 시간, 긴 대사 줄바꿈을 확인한다. 파일 XML 검사만으로 이를 대체하지 않는다.
- [ ] API 키와 Whisper 모델이 없는 PC에서도 SRT 기반 기본 작업을 할 수 있는지 확인한다.
- [ ] 이전 베타 프로젝트 백업·새 버전 열기·복구를 확인한다. 이전 앱으로 새 스키마를 다시 여는 것은 보장하지 않으며 이전 형식 백업을 유지한다.
- [ ] 안내서에 ‘이번 주 앱에서 직접 되는 기능’과 ‘담당자 지원으로 받는 자료’를 구별하고, 번역/OCR 시험 결과를 실측한 만큼만 적는다.
- [ ] 첫 작품 인계 후 실제 작가가 도움 없이 기본 동작을 한 번 반복한다. 다음 작품은 준비되는 순서로 넘긴다.

**통과 결과:** 특정 설치본·특정 입력 경로·실제 PC에서 작업을 시작할 수 있음. 다섯 편 전부의 검수 완료나 통합 OCR 완성으로 확대 해석하지 않는다.

## 3. 후속 개발의 분리와 착수 조건

| 독립 작업 | 수정·추가 파일 후보 | 착수 조건 | 독립 완료 기준 |
|---|---|---|---|
| 통합 OCR | `frame-extraction.ts`, `subtitle-ocr.ts`, `ocr-runtime.ts`, `SubtitleOcrPanel.tsx`, 런타임 배포 스크립트 | 한국어 표본 통과와 담당 PC 처리시간 확인 | 영역 설정→표본→장편→취소/재개→이미지 검수→SRT→대본 흐름 |
| 다국어 전사·번역 | `translation.ts`, `src/main/index.ts`, provider별 언어 전달, 번역 화면·동의·출처 | 한국어 자막 없는 작품 확정, 언어 검수자 확보 | 원어/번역 ID·시간 보존, 번역 누락 검출, 원문/공식 자막 비파괴 |
| 대본 자동 정렬 | `text-alignment.ts`, 미정렬 문단 화면 | 시간 없는 대본이 반복 유입 | 같은 언어 정렬과 교차언어 후보 구별, 누락·편집 차이·수동 앵커 처리 |
| 다중 트랙·일괄 처리 | 공통 대사 트랙, 작업 큐, 자막 트랙 선택 | 단일 작품 흐름 안정화 | 작품별 설정·출처·실패·검수 분리, 중단 시 완료 구간 보존 |

후속 파일은 위치 제안이다. 이번 주 계획에 빈 구현체를 만들거나 아직 검증하지 않은 모델을 설치본에 포함시키지 않는다. 각 작업은 실제 표본·입출력 계약에 맞춘 별도 상세 계획으로 쪼개서 착수한다.

## 4. 금요일에 대한 의사결정

1. 수요일까지 SRT가 있으면 앱 경로를 최우선으로 끝낸다.
2. 영상 자막만 있으면 앱 경로와 지원형 OCR를 병렬 운영한다. 금요일 인계 가능 작품은 표본 처리·검수 시간으로 정한다.
3. 영상·샘플이 오지 않으면 합성 자료로 앱 준비는 진행하되 실제 작품 지원 완료라고 표시하지 않는다.
4. 번역만 가능한 작품은 기존 한국어 자막 작품과 납품 조건을 분리한다. 원어/한국어 검수 인력 없이 자동 번역 품질을 보증하지 않는다.
5. 일정이 흔들리면 통합 자동화 범위를 줄이고 기본 검수·출력과 작품 인계를 우선한다. 작성 내용 보존·시간 정확성·실제 작가 PC 확인을 생략하지 않는다.
