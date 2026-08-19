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
3. 로컬 모드는 FFmpeg로 16kHz 모노 PCM WAV를 만들고, `whisper.cpp` small-q5_1 모델과 Silero VAD로 이 PC에서 처리합니다. 기본 모드는 여기서 종료합니다.
4. 로컬 화자 분리 실험 모드는 같은 WAV를 `sherpa-onnx v1.13.6`의 Pyannote segmentation 3.0 int8 및 3D-Speaker ERes2Net에 순차 입력합니다. Whisper 단어 구간과 화자 구간을 시간 겹침으로 병합하며, 화자 분리만 실패하면 기존 Whisper 대사를 그대로 보존합니다.
5. OpenAI 모드는 16kHz 모노 WebM/Opus 음성을 만들고 24.5MB와 오디오 스트림을 검사한 뒤 `gpt-4o-transcribe-diarize`에 `diarized_json`, `chunking_strategy: auto`, `language: ko`로 전사합니다. 서버가 오디오 형식 오류를 명시한 경우에만 MP3로 한 번 재인코딩해 같은 화자 분리 요청을 재시도합니다.
6. 기본 로컬 모드는 화자를 추정하지 않습니다. 로컬 실험 모드와 OpenAI 모드는 화자를 최초 등장 순서대로 `화자1`, `화자2`에 대응시킵니다.
7. 시작을 초 단위 내림, 종료를 올림하고 2초 미만 공백은 합칩니다. 2초 이상 공백은 해설 후보 행으로 만듭니다.
8. 연속 대사는 가능한 발화 경계에서 60초 이하 행으로 나눕니다.
9. 검수 변경은 `project.json`에 원자적으로 자동 저장합니다.
10. 내보낼 때 템플릿의 표 스타일을 복제하고 HWPX XML과 미리보기 텍스트를 갱신합니다.
11. SRT 내보내기는 같은 검수 행을 직렬화해 `MIME` 제약 없는 자막 형식으로 별도 저장합니다.

로컬 영상 검수는 `media://project/<id>` 사용자 정의 프로토콜을 사용합니다. 메인 프로세스는 원본 파일의 범위 요청에 `206 Partial Content`, `Content-Range`, `Accept-Ranges`로 응답하여 대용량 MP4의 중간·끝 탐색을 지원합니다. 렌더러에 실제 파일 경로를 노출하지 않습니다.

## 핵심 모델

- `ScriptProject`: 작업 전체, 소스, 미디어, 처리 이력, 내보내기 이력
- `TranscriptSegment`: 밀리초 단위 화자 발화
- `ScriptRow`: 작가가 편집하는 대사 또는 해설 행
- `ExportRecord`: 각 내보내기 작업의 형식(`hwpx`/`srt`)과 경로, 시각을 기록
- `TranscriptionProvider`: 로컬 Whisper와 OpenAI가 공유하는 전사 추상화
- `LocalDiarizationConfig`: 프로젝트별 로컬 화자 분리 방식과 자동/2~10명 화자 수 설정
- `DiarizationRunInfo`: 화자 엔진·모델·요청/감지 화자 수·성공/대체 상태

## 자동 업데이트

- Windows NSIS 설치본은 `electron-updater`로 공개 `buildergarlic/ginuni` GitHub Releases를 확인합니다.
- GitHub Actions가 `v*` 태그에서 설치본, 블록맵, `latest.yml`, SHA-256을 함께 게시합니다.
- 설치형 앱만 시작 5초 후 자동 확인하며 새 버전은 백그라운드에서 내려받습니다.
- 설치 직전 검수 중 편집 내용을 원자적으로 저장하고 사용자가 재시작을 선택하면 `quitAndInstall`을 실행합니다.
- 업데이트 서버 오류 원문은 토큰·로컬 경로 노출을 막기 위해 UI나 앱 로그에 기록하지 않습니다.

## 로컬 분석 진단

- 로컬 처리 오류는 원본 확인, FFprobe, 음성 변환, 모델 준비, Whisper 실행, 결과 읽기 단계로 분류합니다.
- `runProcess`는 stdout·stderr·종료 코드·시그널을 구조화하고, 프로젝트에는 정제된 오류 요약만 저장합니다.
- 오류 화면의 진단 파일은 앱·Windows·아키텍처·실행 파일 상태와 정제된 오류만 포함하며 음성·대사·API 키·원본 전체 경로를 기록하지 않습니다.
- OpenAI 실패 이력은 HTTP 상태·요청 ID·안전한 API 오류 필드와 요청 형식, 업로드 음성의 확장자·크기·코덱·재생 시간만 기록합니다. 비화자 모델로 자동 전환하지 않습니다.
- 로컬 모델은 파일 크기와 고정 SHA-256을 확인하며 불일치 시 임시 파일 다운로드 후 원자적으로 복구합니다.
- sherpa 실행 파일·ONNX Runtime DLL·Pyannote 및 3D-Speaker 모델은 앱 시작과 실험 분석 직전에 크기와 SHA-256을 검사합니다. 손상 시 화자 분리만 건너뛰고 진단 경고를 남깁니다.

## 로컬 모델

- 실행 엔진: 설치본의 `whisper.cpp v1.9.2` Windows x64 CPU 빌드
- 음성인식 모델: 사용자 데이터 폴더의 `models\whisper\ggml-small-q5_1.bin`(190,085,487바이트)
- 모델 다운로드는 고정 리비전 URL과 SHA-256을 검사한 뒤 원자적으로 설치합니다.
- Silero VAD 모델은 설치본에 포함하며, 2초 이상 실제 무음에서 대사 블록을 나누는 데 사용합니다.
- 실험적 화자 분리: 설치본의 `sherpa-onnx v1.13.6` Windows x64 CLI, Pyannote segmentation 3.0 int8, 3D-Speaker ERes2Net base 16k
- sherpa 처리 결과는 Whisper 단어와 최대 겹침 기준으로 연결합니다. 겹침이 없거나 동률이면 화자를 추측하지 않으며, 단어 타임스탬프가 없으면 문장 구간 단위로 대체하고 경고를 기록합니다.
- 로컬 WAV와 유튜브 캐시는 프로젝트 폴더에 있어 프로젝트 삭제 시 함께 제거됩니다.

현재 프로젝트 스키마는 2입니다. 스키마 1 프로젝트는 열 때 `localDiarization: { mode: 'none', speakerCount: null }`을 추가해 원자적으로 저장하며 기존 대사와 화자 데이터는 보존합니다. 이후 스키마를 바꿀 때도 이전 버전 마이그레이션을 먼저 추가해야 합니다.

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
- OpenAI 실패 이력에는 안전한 분류 코드, HTTP 상태, 요청 ID, 정제된 오류 필드와 업로드 음성 메타데이터만 저장하고 SDK 원문, 음성, 대사, API 키는 저장하지 않습니다.
- 로컬 모드에서는 영상·음성·대사를 외부 전사 서비스로 전송하지 않습니다.
- IPC는 미리 정의한 메서드만 preload에서 노출합니다.
- About·후원 화면의 GitHub 저장소, GitHub Sponsors, Threads, 이메일, 카카오 오픈채팅은 고정 IPC 허용 목록으로만 엽니다. 렌더러가 임의 URL을 열 수 없습니다.
- 프로젝트 삭제는 문서 폴더의 프로젝트 루트 하위 경로인지 확인한 뒤 수행합니다.
- 유튜브 임베드는 `youtube-nocookie.com`만 CSP에서 허용합니다.
