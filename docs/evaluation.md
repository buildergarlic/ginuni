# 개발자용 오프라인 평가

이 도구는 권리가 확인된 별도 평가 자료와 사람이 검수한 정답으로 후보 모델을 비교한다. 실제 프로젝트 자료를 수집하거나 업로드하지 않으며 네트워크를 사용하지 않는다. 결과는 런타임 정확도 보증이 아니고, `candidateForReview`가 `true`여도 권장 모델을 자동 변경하지 않는다.

## 실행

```powershell
npm run evaluate:workflow -- docs/evaluation-example.json
```

인수는 로컬 JSON 파일 하나만 허용한다. 정상 평가 보고서는 표준 출력의 JSON으로 제공된다. JSON/스키마가 잘못되면 종료 코드 1, 유효하지만 기준을 통과하지 못하면 종료 코드 2, 사람이 검수한 test 분할과 모든 기준을 통과하면 종료 코드 0이다. 예제 파일은 동작 설명을 위한 합성 문자열이며 실제 벤치마크나 모델 성능 주장이 아니다.

## 입력 계약

- `datasetId`, `version`, `split`: 고정 데이터 버전과 `validation`/`test` 구분이다. 프로그램·화자가 겹치지 않도록 `groupId`로 분리한 뒤 최종 후보 판정에는 `test`만 쓴다.
- `rightsConfirmed`, `referenceReviewed`: 둘 다 명시적으로 `true`여야 한다.
- `candidate.provider`, `candidate.model`, `candidate.version`, `candidate.configuration` 객체가 필수다. 모델 버전/체크포인트와 디코딩·프롬프트 등 재현에 필요한 설정을 선언한다. 보고서는 데이터 버전, 이 후보 식별 정보와 정규화 규칙을 함께 보존한다.
- `separation.tuningGroupIds`, `separation.validationGroupIds`는 전체 튜닝/검증 그룹 목록이다. 사용하지 않았으면 빈 배열로 명시한다. test clip의 `groupId`와 겹치면 `overlap`, 선언이 없으면 `unknown`으로 보고하며 후보 판정을 통과하지 못한다. 두 목록이 모두 있고 test 그룹과 겹치지 않을 때만 `declared-disjoint`다.
- 권리 확인, 사람 검수, 모델 식별과 그룹 목록은 제출자의 선언이다. 도구가 원자료나 실제 실행을 독립 검증했다는 뜻이 아니며 보고서의 `declarations.independentlyVerified`는 항상 `false`다. 그룹 목록은 프로그램·화자 등 누출 가능성이 있는 모든 분리 단위를 반영해야 한다.
- 정규화는 NFC, 앞뒤 공백 제거, 연속 공백 축약을 선언한다. CER은 공백을 제외하고 문장 부호는 유지한다. WER은 공백 토큰을 사용한다.
- 각 clip은 고유 `clipId`, 분리 단위 `groupId`, `reference`, `hypothesis`, `hotwords`를 가진다. 시간과 비용은 선택 사항인 유한한 0 이상 숫자다.
- acceptance에는 CER/WER 최대값, 고유명사 재현율 최소값, 사람이 검수한 test 표본 최소 개수를 명시한다.

CER/WER은 clip별 비율 평균이 아니라 전체 편집 수를 전체 정답 단위 수로 나눈 corpus 값이다. 빈 정답에 대한 삽입 편집 수는 기록하되 분모가 0이면 비율은 `null`이다. 고유명사 재현율 분모에는 정답에 실제 등장한 횟수만 포함한다. 시간·비용 항목이 clip 하나라도 빠지면 해당 합계와 파생값은 0이 아니라 `null`이다.

## DER와 SubER

이 도구는 WER로 DER/SubER를 추정하지 않는다. 기본값은 `null`이다. 화자/자막 정답 주석을 공식 또는 검증된 외부 도구로 별도 실행한 경우에만 manifest의 `externalMetrics.der` 또는 `externalMetrics.suber`에 `value`와 `provenance.tool`, `version`, `annotation`을 기록할 수 있다. 예를 들어 DER은 RTTM 정답을 지원하는 검증 도구, SubER는 정답 자막을 지원하는 공식 구현의 명령을 해당 도구 문서대로 별도 실행한다. 명령, 도구 버전, 주석 자료 선언을 실험 기록에 보존하고 수치를 수동으로 입력한다. 통합 실행이나 외부 전송은 이 저장소 도구의 범위가 아니다.
