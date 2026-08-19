# 화면해설 대본 도구

영상 파일 또는 공개·일부공개 유튜브 링크에서 음성과 화자를 분석하고, 화면해설작가가 검수한 뒤 한컴오피스용 HWPX 대본으로 저장하는 Windows 앱입니다.

## 최신 버전 다운로드

[화면해설 대본 도구 v0.4.0-beta.5 설치 파일 내려받기](https://github.com/buildergarlic/ginuni/releases/download/v0.4.0-beta.5/ScreenDescriptionScriptMaker-0.4.0-beta.5-Setup.exe)

- Windows 10/11용 설치 파일이며 약 198MB입니다.
- 새 버전과 체크섬은 [GiNuNi Releases](https://github.com/buildergarlic/ginuni/releases)에서 확인할 수 있습니다.
- 현재 베타 설치본은 코드 서명 전이므로 Windows SmartScreen이 표시되면 게시자와 파일 출처를 확인한 뒤 실행하세요.

## 현재 버전

- 버전: `0.4.0-beta.5`
- 운영체제: Windows 10/11
- 입력 길이: 최대 3시간
- 기본 언어: 한국어
- 전사 엔진: 로컬 `whisper.cpp`(기본, API 불필요) 또는 OpenAI `gpt-4o-transcribe-diarize`
- 출력: 첨부 양식을 재현한 5열 HWPX, 그리고 검수한 대사 행 기준 SRT 자막

AI 결과는 검수 가능한 초안입니다. 중요한 납품 전에는 반드시 앱에서 영상을 재생하며 대사와 타임코드를 확인하세요.

## 사용자 빠른 시작

1. 설치 파일을 실행합니다.
2. 기본 **내 PC에서 분석**을 사용합니다. 처음 한 번 약 181MB 모델을 내려받으며 API 키와 사용료가 없습니다.
   자동 화자 분리가 필요할 때만 **설정**에서 OpenAI API 키를 등록하고 OpenAI 모드를 선택합니다.
3. **새 대본 만들기**에서 로컬 영상 또는 사용 권한이 있는 유튜브 링크를 선택합니다.
4. 프로젝트를 열고 **음성 분석 시작**을 누릅니다.
5. 영상과 표를 함께 보며 대사·화자·시작·종료를 수정합니다.
6. **HWPX 내보내기**를 눌러 저장 폴더를 선택합니다.

7. **SRT 내보내기**를 눌러 저장 폴더를 선택합니다. 대사 행만 저장됩니다.

앱의 **About GiNuNi**에서 버전·자동 업데이트·BuilderGarlic 연락처·GitHub 저장소를 확인할 수 있고, **개발자 후원** 메뉴에서 [BuilderGarlic GitHub Sponsors](https://github.com/sponsors/buildergarlic) 후원 단계를 선택할 수 있습니다.

프로젝트는 Windows 문서 폴더의 `화면해설 대본 도구\Projects`에 자동 저장됩니다. HWPX와 SRT는 같은 제목이 있으면 `V01`, `V02`처럼 새 버전으로 저장되고 기존 파일을 덮어쓰지 않습니다.

자세한 설명은 [사용자 안내서](docs/USER_GUIDE.md)를 참고하세요.

## 개발

```powershell
cd C:\GiNuNi\screen-description-script-maker
npm install
npm run sanitize:template
npm run sync:assets
npm run dev
```

검증과 설치본 생성:

```powershell
npm run verify
npm run dist:win
```

설치본은 `release` 폴더에 생성됩니다. 개발 과정에서 API 키를 소스나 `.env`에 커밋하지 마세요. 앱 설정 화면을 통한 입력을 권장합니다.

## 저장소 원칙

- 이 폴더가 유일한 개발 원본입니다: `C:\GiNuNi\screen-description-script-maker`
- `main`은 항상 빌드 가능한 상태로 유지합니다.
- 기능은 `feature/...` 브랜치에서 개발하고 검증 후 병합합니다.
- 릴리스는 SemVer 태그(`v0.1.0-beta.1`, `v1.0.0`)와 `CHANGELOG.md`로 기록합니다.
- 원격 저장소는 `https://github.com/buildergarlic/ginuni.git`입니다.
- `v*` 태그를 푸시하면 GitHub Actions가 설치본, `latest.yml`, 블록맵, SHA-256을 Releases에 게시하며 설치형 앱이 이를 자동 확인합니다.
- 앱 구조는 [아키텍처 문서](docs/ARCHITECTURE.md), 배포 절차는 [릴리스 문서](docs/RELEASE.md)에 고정합니다.

## 개인정보와 저작권

- 원본 로컬 영상은 복사하지 않고 경로만 참조합니다.
- 유튜브 입력은 전사용 음성을 프로젝트 폴더에 내려받습니다.
- 로컬 모드는 음성을 외부 서버로 보내지 않습니다. 모델 최초 다운로드 때만 인터넷이 필요합니다.
- OpenAI 모드를 선택한 경우에만 압축된 음성 파일이 OpenAI API로 전송됩니다.
- API 키·대사·오디오 내용은 앱 로그에 기록하지 않습니다.
- 사용자는 입력 영상과 음성을 처리할 권한을 확인해야 합니다.
