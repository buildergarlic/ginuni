# GiNuNi UI 전면 개편 — 조사 근거와 디자인 방향

작성일: 2026-09-10 · 상태: 시안 선택 전 / 구현·배포 전

## 1. 제품의 중심

GiNuNi는 화면해설 방송 대본을 쓰는 **작가의 Windows 작업 도구**다. 작가의 전문성은 존중하되, IT 지식을 요구하지 않는다. 좋은 결과의 기준은 “멋진 화면”과 함께 **영상을 보고, 대사를 확인하고, 해설을 쓰고, 안전하게 저장하기가 쉬운가**이다.

기존 앱의 업데이트로 진행한다. 프로젝트 형식, 음성 인식 처리, 검증 가능한 AI 워크플로우와 문서 출력 기능은 보존한다. 첫 디자인 비교는 하루 중 가장 오래 사용하는 검수·집필 화면에 집중한다. 선택한 체계는 홈·영상 준비·설정·사용법·About·업데이트 화면에도 일관되게 확장한다.

이 문서는 조사와 제안이다. 새 UI 구현 완료, 사용자 검증 완료 또는 수상을 의미하지 않는다.

## 2. 확인 범위와 한계

- Apple Design의 한국어 허브와 시각 구성, HIG, 디자인 리소스, Liquid Glass 자료, 디자인 기초 세션, 2026 Design Awards 및 Windows에 관련된 자산 사용 조건을 조사했다.
- HIG의 계층·레이아웃·재질·접근성·문구·피드백·생성형 AI 가이드와 Microsoft의 타이포그래피·창 제목 표시줄·Mica·접근성 자료를 교차 확인했다.
- 사이트 전체의 모든 하위 페이지를 전수 검토했다고 주장하지 않는다. watchOS·CarPlay 등 이 Windows 앱과 직접 관련 없는 UI를 이식하지 않는다.
- 현재 앱 기준: `main` 커밋 `8429e54250eba67ffb29ecc4288ca27509c466bb`, 버전 `0.6.0-beta.2`.
- `App.tsx`, `styles.css`와 기존 `output/playwright/workflow-1440.png`를 디자인 참고로 확인했다. 기존 스크린샷은 새 실행 테스트나 현재 사용자 세션에 대한 접근성 감사의 증거가 아니다.

## 3. 현재 화면에서 개선할 점

| 관찰한 문제 | 개편 방향 | 보존할 사항 |
| --- | --- | --- |
| 영상 아래 좁은 영역에 검수·설정·편집 도구가 집중됨 | 영상·대본 중심의 두 영역, 보조 도구는 필요할 때 펼침 | 원본 결과·외부 전송 동의·복구·작업 기록 접근 |
| 본문보다 보조 정보가 작고 빽빽하며, 대본은 넓은 빈 공간에 놓임 | 읽기 폭·행간·열 비율을 조정하고 내용량에 맞게 공간 사용 | 긴 대본, 창 크기 변경, 글자 확대 |
| 다수의 버튼이 비슷한 무게로 경쟁함 | 단계별 대표 동작 하나를 강조 | 저장·내보내기·실행 취소를 숨기거나 제거하지 않음 |
| 표 전체 색상과 테두리에 상태 표현이 의존함 | 선택·수정 중·확인 전·확인 완료를 글자와 아이콘으로 구분 | 수정 시 기존 확인 완료가 해제되는 규칙 |
| 영문 형식명이 행동보다 먼저 보임 | “대본 내보내기” 안에 “한글 문서(HWPX)”, “자막 파일(SRT)” 안내 | 두 출력 형식과 검수 상태 표시 |

관찰은 화면과 코드에 대한 판단이며, 개선 효과를 수치로 측정한 결과는 아니다.

## 4. Apple에서 채택할 원칙, Windows에서 구현할 방법

| 공식 원칙 | GiNuNi 적용 제안 |
| --- | --- |
| 계층·조화·플랫폼 일관성 | 영상과 대본이 중심. 도구는 역할별로 정렬. Windows 창 제어와 키보드 관례 유지. [HIG](https://developer.apple.com/design/human-interface-guidelines?lang=en) |
| 중요한 콘텐츠에 충분한 공간을 제공 | 대본 영역을 넓히되 한 줄을 지나치게 길게 만들지 않음. 고급 설정은 별도 패널. [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) |
| Liquid Glass는 조작·탐색 계층, 콘텐츠에 남용하지 않음 | 대본 편집면은 불투명. 재질 효과는 창 프레임에만 절제해 검토. 유리 효과 자체가 목표는 아님. [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) |
| 명확한 동사형 문구와 일관된 흐름 | “영상 선택 → 듣고 확인 → 대본 저장”. 버튼에는 “다음 확인”, “확인 완료”처럼 결과를 예측할 수 있는 말 사용. [Writing](https://developer.apple.com/design/human-interface-guidelines/writing?changes=l_1) |
| 맥락에 맞는 피드백 | 저장 중/저장됨/저장 실패를 구별. 성공 알림은 편집을 가리지 않고, 실패는 해결 행동을 함께 제시. [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) |
| 사용자가 AI를 통제 | AI 교정은 원문과 비교 후 적용. 거절·복구 가능. 자동 점검 통과를 정확성 보증으로 표현하지 않음. [Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai) |
| 읽기·조작·설정 적응성 | 글자 확대, 키보드, 대비, 동작 줄이기, 고대비 모드 검증. 상태를 색상만으로 전달하지 않음. [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |

Apple의 SwiftUI·AppKit 자동 적응 기능이 Electron에도 자동 제공되는 것은 아니다. 위 항목은 Windows/Electron에 맞게 별도 구현·검증해야 한다.

## 5. 자산 사용 정책

1. **Apple UI 키트 복사 금지:** 공개 Apple Design Resources 계약 §2 A/B는 Apple OS용 UI 목업으로 용도를 제한하고 비 Apple OS 목업·제품 포함을 금지한다. 개념만 연구하고 자체 UI를 만든다. [공식 계약](https://developer.apple.com/support/downloads/terms/apple-design-resources/Apple-Design-Resources-License-20230621-English.pdf)
2. **SF Pro·SF Mono를 Windows 앱용으로 내려받아 포함하지 않음:** 확인한 공개 San Francisco 계약 §2B는 비 Apple OS 목업과 임베딩을 허용하지 않는다. [Apple Fonts](https://developer.apple.com/fonts/)
3. **SF Symbols 글리프를 추출·재배포하지 않음:** 공개 Xcode 계약 §2.10의 시스템 이미지 조항은 Apple 기기용 앱 개발로 제한한다. SF Symbols 앱의 개별 설치 계약은 이번 조사에서 직접 받지 않았다. Windows 허용 권한이 확인되지 않은 자산은 채택하지 않는다. [Xcode 계약](https://www.apple.com/legal/sla/docs/xcode.pdf)
4. **아이콘 후보:** Microsoft Fluent UI System Icons의 단일 스타일·선 두께 사용. 재배포 시 MIT 저작권·라이선스 고지 포함. 아이콘 단독 조작에는 접근 가능한 이름, 중요한 버튼에는 한국어 글자 레이블 제공. [아이콘 라이선스](https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE)
5. **글꼴 후보:** Windows의 Segoe UI Variable과 한국어 Malgun Gothic을 명시적으로 구분한다. 별도 한글 폰트를 번들할 경우 해당 라이선스와 가변 글꼴 렌더링을 먼저 검증한다. Microsoft는 Segoe UI Variable을 Latin/Greek/Cyrillic용, Malgun Gothic을 한국어 UI용으로 안내한다. [Windows Typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography)
6. **창과 재질:** Windows의 우측 창 제어, 드래그·최대화·복원 관례를 보존한다. Mica는 불투명 기반 재질이며 단색 대체가 필요하다. macOS 창 버튼을 복제하지 않는다. [Title bar](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design), [Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)

## 6. 비교할 세 가지 방향

번호는 생성 이미지가 실제 표시된 순서에 따라 붙인다. 아래 나열 순서만으로 사용자 선택을 해석하지 않는다.

### 균형 작업실 — Balanced Atelier

영상은 왼쪽에 충분히 크게, 대본은 오른쪽의 정돈된 연속 목록에 표시한다. 한 구간의 내용·시간·확인 상태를 같은 자리에서 편집한다. 따뜻한 백색과 깊은 청록의 절제된 조합. 기존 사용자의 적응 부담이 가장 낮은 권장 출발점이다.

### 한 장면에 집중 — Scene Focus

작업 목록보다 현재 구간의 영상과 집필에 집중한다. 이전·현재·다음 문맥만 가까이에 두고 “확인 완료 · 다음”이 분명하다. 전체 대본 접근은 유지한다. 주의가 분산되기 쉬운 첫 사용자에게 유리할 수 있으나 대본 전체를 훑는 작업에는 전환 비용이 생긴다.

### 작가의 원고 — Manuscript Studio

오른쪽은 서식이 정돈된 원고처럼 연속해서 읽고 수정한다. 왼쪽 영상과 구간 정보는 고정한다. 실제 타임코드는 여백에 유지하고 대사·해설은 레이블로 구별한다. 장문 검수에 유리할 수 있으나 기존 표 편집 사용자의 적응 여부를 확인해야 한다.

공통 금지: 대시보드식 장식 수치, 불필요한 탭·카드, 아이콘만 있는 중요한 버튼, 눈에 띄는 반복 애니메이션, AI가 작성하지 않은 내용의 자동 생성 표시, 검수 완료처럼 보이는 미확인 내용, 유튜브 컨트롤·광고 가리기.

### 실제 표시된 시안 순서

세 이미지는 2026-09-10 내장 이미지 생성 도구로 각각 생성해 대화에 표시했다. 아직 선택되지 않은 미리보기이므로 원본은 생성 이미지 폴더에 유지한다.

| 대화 표시 번호 | 방향 | 원본 이미지 |
| --- | --- | --- |
| 1 | 균형 작업실 | `C:/Users/harmo/.codex/generated_images/01a0443c-228e-7b61-8d74-7b76df695d82/exec-6be89ebc-0d43-4c54-875e-40c5441349d5.png` |
| 2 | 한 장면에 집중 | `C:/Users/harmo/.codex/generated_images/01a0443c-228e-7b61-8d74-7b76df695d82/exec-36de1e07-1366-4fa4-96b4-b0054d14fe21.png` |
| 3 | 작가의 원고 | `C:/Users/harmo/.codex/generated_images/01a0443c-228e-7b61-8d74-7b76df695d82/exec-64b76269-78a7-427e-84d3-1695de9b8813.png` |

이미지 속 영상과 문장은 가상의 예시다. 생성 이미지는 픽셀 단위 구현 명세나 접근성 검증 결과가 아니다. 특히 영상이 프레임을 채우도록 잘린 표현은 실제 구현에서 복제하지 말고 원본 종횡비·전체 프레임을 보존한다. 생성된 본문 크기와 표시된 글자 크기 수치도 실제 CSS와 일치하도록 다시 정해야 한다. AI 제안, 확인 상태, 저장 상태의 상세 동작은 기존 계약과 사용자 승인 명세를 따른다.

## 7. 시안 선택 후 적용 범위

| 단계 | 작업 | 다음 단계 조건 |
| --- | --- | --- |
| 디자인 확정 | 선택한 방향의 화면 구조·상태·공통 스타일·작동 방식 명세 | 사용자 승인 |
| 핵심 화면 구현 | 공통 글꼴·색·간격·아이콘, 검수 편집기와 영상 영역, 보조 도구 재배치 | 기존 데이터와 동작을 보존하는 자동 테스트 |
| 전체 화면 일관화 | 홈·준비·처리·사용법·설정·About·내보내기·업데이트 상태 | 초보자 흐름과 오류 복구 확인 |
| 파일럿 검증과 배포 | 실제 작가 관찰, Windows 화면 배율·문서 출력·영상 재생 회귀 검증 | 중대 결함 해소 후 기존 GitHub 릴리스 체계로 배포 |

시안 이미지는 작동하는 앱이 아니다. 이번 조사만으로 버전 번호를 올리거나 기존 배포본을 교체하지 않는다.

구현 시 특별히 지킬 계약:

- 음성 외부 전송 동의와 대사 교정 외부 전송 동의는 별개다. UI를 단순화해도 하나로 합쳐 묵시적 동의를 만들지 않는다.
- 현재 자동 저장은 700ms 지연과 revision 관리가 있다. 새 편집면에서도 입력 중 초안과 저장 결과를 구분하고 마지막 입력을 보존한다.
- 행 삽입·삭제·분할·병합·분류 변경은 본문뿐 아니라 시각·화자·원본 구간 연결도 보존해야 한다.
- 기존 사용법에서 HWPX는 대사와 작성한 해설, SRT는 대사만 내보내는 것으로 안내한다. “대본 저장” 메뉴 개편 시 두 형식이 동일한 내용이라고 오해하게 만들지 않는다.
- 현재 파일 선택 버튼에 드래그 앤 드롭이 구현되었다고 가정하지 않는다. 방향키 탐색·통합 단축키·새 장면 집중 모드 등 새 조작은 별도 구현·검증 항목이다.

## 8. 완료 기준 제안

- 실제 화면해설작가 최소 5명에게 처음부터 영상 선택·대사 확인·해설 작성·대본 출력까지 수행하도록 요청한다. 제안 목표는 5명 중 4명 이상이 진행자 도움 없이 핵심 흐름을 완료하는 것이다. 아직 달성한 결과가 아니다.
- 핵심 작업 시간과 도움 요청 횟수를 기존 UI와 비교한다. “대폭 개선”은 측정 후에만 주장한다.
- 한국어 IME 조합 중 재생·단축키·자동 저장이 글자를 잃거나 포커스를 빼앗지 않는다.
- 유튜브 및 로컬 영상에서 행 클릭·키보드 선택이 의도한 시점으로 이동한다. 글자 편집과 타임코드 조작은 불필요한 점프를 일으키지 않는다.
- 저장 전 화면 이동·프로그램 종료·오류 복구에서 대본을 잃지 않는다. 수정한 행은 재확인이 필요한 상태로 돌아간다.
- HWPX·SRT 내보내기, 수정 이력·원문·AI 교정 제안·동의 상태를 보존한다. 사용자 확인 없는 외부 전송을 추가하지 않는다.
- 대표 화면에서 100/125/150/200% 배율, 좁은 창, 장문, 긴 제목, 큰 글자를 검증한다. 중요한 조작이 잘리거나 숨지 않는다.
- 일반 글자 대비 4.5:1 이상을 출발 기준으로 하고, 키보드 포커스·고대비·Windows Narrator를 실제 검증한다. [Microsoft 접근성 체크리스트](https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessibility-checklist)
- 불필요한 애니메이션을 배제하고, 동작 줄이기와 투명 효과 해제 시에도 정보와 조작이 유지된다.

## 9. 어워즈 목표의 의미

Apple은 2026 Design Awards 수상작·최종 후보를 공개하고 있으며 해당 소개는 Apple 플랫폼 앱을 대상으로 한다. 이를 Windows 전용 GiNuNi의 출품 자격으로 오해하지 않는다. 2027 규정이나 수상을 보장할 근거는 없다. [Apple Design Awards](https://developer.apple.com/design/awards/)

GiNuNi의 현실적인 목표는 플랫폼에 자연스럽게 어울리는 시각적 완성도, 실제 작가 작업에서 입증한 사용 편의성, 안전한 AI 검수, 접근성, 안정적인 배포를 함께 갖추는 것이다. 출품은 실제 공모전의 플랫폼·일정·상용화·접근성 요건을 별도로 확인한 뒤 결정한다.
