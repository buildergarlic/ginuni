# 아키텍처

## 구성

앱은 Electron의 세 영역을 분리합니다.

- `src/main`: 파일, 미디어 도구, 로컬 Whisper/OpenAI 전사, 암호화 키, 프로젝트 저장, HWPX 생성
- `src/preload`: 허용된 기능만 렌더러에 노출하는 IPC 경계
- `src/renderer`: React 기반 입력·진행·검수·설정 UI
- `src/shared`: 프로젝트 타입, 타임코드, 대사/해설 행 생성 규칙

렌더러는 Node.js API나 API 키에 직접 접근하지 않습니다. `contextIsolation`, `sandbox`, `nodeIntegration: false`를 유지합니다.

## 데이터 흐름

1. 로컬 파일 경로나 공개·일부공개 유튜브 URL로 `ScriptProject`를 만듭니다. 유튜브 입력은 고정 버전의 공식 `yt-dlp` 독립 실행 파일과 Deno 런타임으로 메타데이터와 음성을 가져옵니다.
2. FFprobe로 길이를 확인하고 3시간 초과 입력을 거부합니다.
3. 로컬 모드는 FFmpeg로 16kHz 모노 PCM WAV를 만들고, `whisper.cpp` small-q5_1 모델과 Silero VAD로 이 PC에서 처리합니다.
4. OpenAI 모드는 16kHz 모노 WebM/Opus 음성을 만들고 24.5MB를 검사한 뒤 `gpt-4o-transcribe-diarize`에 `diarized_json`, `chunking_strategy: auto`, `language: ko`로 전사합니다.
5. 로컬 모드는 화자를 추정하지 않고 대사 내용만 기록하며, OpenAI 모드는 화자를 최초 등장 순서대로 `화자1`, `화자2`에 대응시킵니다.
6. 시작을 초 단위 내림, 종료를 올림하고 2초 미만 공백은 합칩니다. 2초 이상 공백은 해설 후보 행으로 만듭니다.
7. 연속 대사는 가능한 발화 경계에서 60초 이하 행으로 나눕니다.
8. 검수 변경은 `project.json`에 원자적으로 자동 저장합니다.
9. 내보낼 때 템플릿의 표 스타일을 복제하고 HWPX XML과 미리보기 텍스트를 갱신합니다.

로컬 영상 검수는 `media://project/<id>` 사용자 정의 프로토콜을 사용합니다. 메인 프로세스는 원본 파일의 범위 요청에 `206 Partial Content`, `Content-Range`, `Accept-Ranges`로 응답하여 대용량 MP4의 중간·끝 탐색을 지원합니다. 렌더러에 실제 파일 경로를 노출하지 않습니다.

## 핵심 모델

- `ScriptProject`: 작업 전체, 소스, 미디어, 처리 이력, 내보내기 이력
- `TranscriptSegment`: 밀리초 단위 화자 발화
- `ScriptRow`: 작가가 편집하는 대사 또는 해설 행
- `TranscriptionProvider`: 로컬 Whisper와 OpenAI가 공유하는 전사 추상화

## 자동 업데이트

- Windows NSIS 설치본은 `electron-updater`로 공개 `buildergarlic/ginuni` GitHub Releases를 확인합니다.
- GitHub Actions가 `v*` 태그에서 설치본, 블록맵, `latest.yml`, SHA-256을 함께 게시합니다.
- 설치형 앱만 시작 5초 후 자동 확인하며 새 버전은 백그라운드에서 내려받습니다.
- 설치 직전 검수 중 편집 내용을 원자적으로 저장하고 사용자가 재시작을 선택하면 `quitAndInstall`을 실행합니다.
- 업데이트 서버 오류 원문은 토큰·로컬 경로 노출을 막기 위해 UI나 앱 로그에 기록하지 않습니다.

## 로컬 모델

- 실행 엔진: 설치본의 `whisper.cpp v1.9.2` Windows x64 CPU 빌드
- 음성인식 모델: 사용자 데이터 폴더의 `models\whisper\ggml-small-q5_1.bin`(190,085,487바이트)
- 모델 다운로드는 고정 리비전 URL과 SHA-256을 검사한 뒤 원자적으로 설치합니다.
- Silero VAD 모델은 설치본에 포함하며, 2초 이상 실제 무음에서 대사 블록을 나누는 데 사용합니다.
- 로컬 WAV와 유튜브 캐시는 프로젝트 폴더에 있어 프로젝트 삭제 시 함께 제거됩니다.

프로젝트 스키마를 바꿀 때는 `schemaVersion`을 올리고 이전 버전 마이그레이션을 먼저 추가해야 합니다. 스키마 구조를 바꾸지 않는 안전한 데이터 정규화(예: 과거 로컬 분석의 자동 `화자1` 표기 제거)는 프로젝트 로드 시 원자적으로 영구 저장합니다.

## HWPX

`resources/templates/screen-description-template.hwpx`는 제공 문서에서 기존 작품명과 대사를 제거한 템플릿입니다. 출력 시 다음을 갱신합니다.

- `Contents/section0.xml`: 제목, 표 행, 셀 주소·높이, 표 전체 높이
- `Contents/content.hpf`: 제목, 생성자, 수정 시각
- `Preview/PrvText.txt`: 새 문서 텍스트
- `Preview/PrvImage.png`: 오래된 내용 노출을 방지하기 위해 제거

본문 텍스트나 표 구조를 바꾼 뒤에는 이전 글자 길이의 줄 배치 캐시인 `hp:linesegarray`를 제거합니다. 한글이 문서를 열 때 다시 조판하게 하여 글자 겹침과 손상·변조 경고를 방지합니다. 셀 안의 줄바꿈은 `hp:lineBreak` 요소로 기록합니다.

ZIP의 `mimetype`은 항상 첫 항목이며 무압축입니다.

## 보안 경계

- API 키는 Electron `safeStorage`로 암호화하고 `userData/settings.json`에 암호문만 저장합니다.
- 프로젝트 JSON에는 키가 들어가지 않습니다.
- OpenAI 실패 이력에는 안전한 분류 코드, HTTP 상태, 요청 ID만 저장하고 SDK 원문, 음성, 대사, API 키는 저장하지 않습니다.
- 로컬 모드에서는 영상·음성·대사를 외부 전사 서비스로 전송하지 않습니다.
- IPC는 미리 정의한 메서드만 preload에서 노출합니다.
- About·후원 화면의 GitHub 저장소, GitHub Sponsors, Threads, 이메일, 카카오 오픈채팅은 고정 IPC 허용 목록으로만 엽니다. 렌더러가 임의 URL을 열 수 없습니다.
- 프로젝트 삭제는 문서 폴더의 프로젝트 루트 하위 경로인지 확인한 뒤 수행합니다.
- 유튜브 임베드는 `youtube-nocookie.com`만 CSP에서 허용합니다.
