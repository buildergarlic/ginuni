# GiNuNi 검증 가능한 AI 워크플로우 이미지 생성 기록

- 생성일: 2026-08-31
- 사용 방식: 내장 `image_gen` 도구
- 산출물: `assets/ginuni-verifiable-ai-workflow-2026-08-31.png`
- 과정: 신규 생성 1회, 연결 방향 교정 2회
- 용도: 업그레이드 제안 설계도. 구현 완료를 의미하지 않음.

## 1. 최초 생성 프롬프트

```text
Use case: infographic-diagram
Asset type: high-resolution Korean program flowchart / architecture blueprint for the GiNuNi desktop project, to attach to its upgrade plan. One complete landscape image, ideally 3840 x 2560 (3:2), crisp readable Korean text.
Primary request: Visualize a proposed VERIFIABLE AI workflow for a tool used by screen-description writers (people who write audio-description broadcast scripts for blind viewers). Writers are domain experts, not IT experts. The diagram must visually separate their SIMPLE three-step experience from the invisible internal AI checks, evidence, recovery, and offline evaluation. It is a proposed design, NOT implemented software.
Style/medium: polished professional editorial system diagram, flat vector-like shapes, restrained teal/navy/amber palette consistent with GiNuNi's calm green desktop UI, warm white background, high contrast, clear Korean sans-serif typography (Noto Sans KR style), generous margins, compact line icons only, straight orthogonal arrows with unmistakable arrowheads. No robots, no photos, no gradients, no 3D. Prioritize logical accuracy and readable typography over decoration. All quoted Korean labels must be rendered accurately and exactly. The image should look ready for a mentor review meeting.

LAYOUT: Title, three clearly separated horizontal lanes, then a small footer. Every lane has a heading. Use a large central runtime pipeline, a lower horizontal local evidence bar, and a bottom offline evaluation strip. Color is supplemented by labels, never the only signal. Keep all arrows unambiguous and do not connect the offline evaluation directly to exported scripts.

TITLE exact: "GiNuNi | 검증 가능한 AI 워크플로우"
Subtitle exact: "화면해설작가는 쉽게, AI 결과는 근거와 함께"
Small status pill: "업그레이드 제안 설계 · 2026.08.31"

LANE 1 heading: "작가에게 보이는 3단계"
Three very large numbered boxes left to right with bold arrows:
"1  영상 가져오기"
"2  대사 초안 만들기"
"3  영상 확인 · 해설 작성 · 저장"
A small note below this lane: "모델명 대신 쉬운 버튼 · 확인할 구간만 안내 · 언제든 되돌리기"

LANE 2 heading: "내부 처리와 검증"
Main pipeline arranged left to right, with clearly numbered logical modules and two compact decision gates. Allow generous width and use only these short texts inside the nodes:
A rounded rectangle: "입력 확인" / "사용 권한 · 음성 유효성" / "외부 전송은 동의 후"
arrow to B rectangle: "음성·화자 분석" / "대사 인식 → 화자 구분" / "원본 시간에 맞추기"
arrow to C diamond or distinct gate card: "검사 ①" / "형식 · 시간 · 누락"
The pass arrow labeled "통과" goes to D rectangle: "AI 교정 제안" / "원문 보존 · 변경 비교" / "의심 구간 표시"
arrow to E human-accented rectangle, make visually prominent: "작가 확인" / "원본 영상·음성 대조" / "해설 직접 작성 · 적용/거부"
arrow to F distinct gate: "검사 ②" / "시간 · 누락 · 파일 검사"
The pass arrow labeled "통과" goes to G rounded output rectangle: "HWPX / SRT" / "버전 저장 · 미리보기"

Below C and D, a small amber rectangle: "확인 필요 구간" / "불명확한 화자 · 원음 불일치 의심"
C soft uncertainty arrow labeled "불확실" and D concern arrow go into this amber box; its outgoing arrow goes ONLY to E 작가 확인.
Below B/C, a separate small red-orange recovery rectangle: "실패·형식 오류" / "원문 보존 → 제한 재시도" / "계속 실패하면 수동 편집"
B error and C fatal error arrows go to this recovery rectangle, which routes to E via a labeled "수동 작업" path. Do not make an infinite automatic retry loop. Do not switch providers or upload to cloud silently.
F failure arrow labeled "수정 필요" loops back to E. E rejection of AI suggestions keeps original text; don't route rejection to automatic AI rewriting.

Immediately below the runtime pipeline, a navy outlined bar labeled:
"로컬 검증 기록"
Inside the bar, evenly separated segments:
"실행 ID · 입력 해시"
"모델·프롬프트 버전"
"구간 ID · 원본 시간"
"검사 결과 · 수정 전후"
"작가 승인 · 저장 버전"
Use thin dotted taps from the relevant processing nodes into this bar, labeled once "근거 연결". It is LOCAL project evidence, not public logs.
Small nearby caption: "민감한 근거는 로컬 보호 · 진단 파일은 비식별 요약만"

LANE 3 heading: "개발자용 모델 평가 · 실제 작업 흐름과 분리"
An independent left-to-right five-node strip:
"권리 확인된 평가 자료"
arrow to "사람이 검수한 정답"
arrow to "같은 조건으로 모델 비교"
arrow to "기준 충족?"
YES arrow label "예" to "권장 모델 후보"
NO arrow from gate down to a small label "아니오 → 기존 모델 유지"
Under the comparison node, a small readable metrics line:
"CER/WER · DER · SubER · 고유명사 재현율 · 검수 시간 · 비용"
A subtle connection from E 작가 확인 to the first two evaluation nodes must pass through a distinct small consent node labeled "별도 동의 + 권리 확인". Label that connection "평가용 제공 시". No automatic upload or automatic training arrow.
A thin dotted connection from "권장 모델 후보" back to B (or to a caption below B) labeled "검증 후 개발자가 적용". No direct connection to G output.

BOTTOM SAFETY FOOTER, full width, three concise statements separated by dots:
"자동 검사는 정답 보장이 아님"
"정답 기반 평가는 개발 단계에서 수행"
"화면해설과 최종 판단은 작가가 담당"
Small legend: "실선: 작업 흐름   점선: 근거·개선 연결   주황: 확인·복구"

Constraints: No claimed achieved accuracy percentages, no guarantee of detecting all hallucinations, no vendor model-version speculation, no public uploads of source scripts, no self-approving LLM judge. STT only transcribes speech; it does not create visual scene descriptions. The offline evaluation metrics are not shown as per-live-file truth verification. Preserve all these distinctions. Do not add extra boxes, paragraphs, illegible microtext, or duplicate arrows. Use all labels in Korean except GiNuNi, AI, IDs, HWPX/SRT and metric abbreviations. Keep text within boxes and leave space between arrow labels and borders.
```

## 2. 근거·평가 연결 교정 프롬프트

```text
Edit this existing Korean GiNuNi workflow diagram. Keep its overall layout, readable typography, colors, title, three-step writer lane, runtime boxes A-G and footer exactly as they are. Make ONLY the following arrow-correctness and evidence-flow fixes. The current image is a proposed architecture diagram, not software UI.

1. In the central runtime lane, the red downward arrow labeled "치명적 오류" currently starts at box B. It MUST instead originate from diamond C "검사 ①" and route to the existing red box "실패·형식 오류". Keep the separate B → red box arrow "오류". There must be no crossing or overlapping text. Keep the amber C → 확인 필요 구간 path.
2. Local evidence direction: the blue dotted arrows connecting runtime nodes and the "로컬 검증 기록" bar must point FROM processing nodes downward INTO the record bar. Remove any arrowheads pointing upward into A, the issue box, E, or G. Dotted taps should end with down-arrowheads at the bar; their caption should be "근거 기록". Evidence is recorded, never fed back as input. Do not connect an evidence arrow into a recovery decision.
3. Completely REMOVE the long dotted loop at the very bottom that currently runs from "기준 충족?" back toward "권리 확인된 평가 자료", and remove its caption "검증 후 개발자가 적용". That loop is logically wrong.
4. Keep the five-node offline evaluation row and its YES/NO decision branches. Under "권장 모델 후보", add a small simple downstream box with a short downward arrow: "개발자 검토 후 다음 분석에 적용". This box must NOT connect to evaluation data or to HWPX/SRT. Keep the NO branch text "아니오 → 기존 모델 유지".
5. The small dashed consent badge above the offline evaluation row currently lacks a source. Replace the whole little badge and its dangling arrows with one clearly readable standalone note spanning the first two evaluation boxes: "작가 수정본 제공: 별도 동의 + 권리 확인". Treat it as an explanatory note, no arrows needed from it. Do not imply automatically uploaded or trained data.
6. In the evidence bar, keep "실행 ID · 입력 해시", "모델·프롬프트 버전", "구간 ID · 원본 시간", "검사 결과 · 수정 전후", "작가 승인 · 저장 버전".
7. Preserve footer warning "자동 검사는 정답 보장이 아님" and "정답 기반 평가는 개발 단계에서 수행". Preserve "화면해설과 최종 판단은 작가가 담당".
All text must remain precise Korean, large and crisp. Do not add new metrics, performance guarantees, decorative elements, or unrelated arrows. Return one corrected high-resolution landscape image.
```

## 3. 실패·검수 반환 경로 교정 프롬프트

```text
Edit ONLY the connectors in the central runtime lane of this exact diagram. Preserve every box, icon, label, all typography, the three-step top lane, local evidence bar, and the entire offline evaluation lane unchanged. Do not remove any existing correct connector.

The diagram currently omits some important return paths. Restore them precisely:
1) Add a solid ORANGE connector from the right-lower edge of diamond C "검사 ①" into the LEFT edge of the amber "확인 필요 구간" box. Label it "불확실". This is distinct from the existing red fatal-error path.
2) Add a solid RED connector from the RIGHT edge of the red "실패·형식 오류" box to the LOWER-LEFT edge of the blue E "작가 확인" box, with the arrowhead entering E. Route in available whitespace below the amber issue box and above the evidence bar. Label "수동 편집". This ensures a failed AI analysis can still lead to manual authoring.
3) Add a solid RED return connector from the RIGHT-LOWER edge of diamond F "검사 ②" back to the RIGHT edge of E "작가 확인", arrowhead entering E. Route this loop below F and to the right of E, then back left. Label it "수정 필요". Keep the existing F → G pass arrow.
4) REMOVE the dotted vertical connector under B that currently ends at the TOP of the red failure box. It wrongly makes an evidence arrow enter failure handling. Keep the existing solid red B error arrow. Do not add a new evidence tap for B if no free route exists.
5) Keep all other evidence arrows pointing DOWN into the local evidence bar. Keep the offline model candidate → developer review → next analysis path exactly as currently shown. Do not reintroduce the removed long dotted bottom loop.

No new boxes. No content changes. No extra decorations. Correct arrow directions and no overlapping labels are the only purpose of this edit.
```
