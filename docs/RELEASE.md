# 릴리스 관리

## 버전 규칙

- `0.x`: 베타와 화면해설작가 파일럿
- `1.0.0`: 코드 서명과 실제 파일럿 정확도 기준을 통과한 공개판
- 패치: 호환되는 버그 수정
- 마이너: 호환되는 기능 추가
- 메이저: 프로젝트 스키마 또는 사용 흐름의 비호환 변경

## 릴리스 절차

1. `main`에서 작업 트리가 깨끗한지 확인합니다.
2. `npm ci` 후 `npm run verify`를 실행합니다.
3. 한컴오피스 2022에서 테스트 HWPX가 복구 경고 없이 열리는지 확인합니다.
4. `npm run dist:win`으로 NSIS 설치본을 생성합니다.
5. 깨끗한 Windows 10/11 PC에서 설치, 실행, 제거, 한글 경로를 확인합니다.
6. `CHANGELOG.md`와 `package.json` 버전을 갱신합니다.
7. `git tag vX.Y.Z`를 만들고 원격 저장소에 푸시합니다.
8. GitHub Actions가 설치본, 블록맵, `latest.yml`, SHA-256을 Releases에 게시했는지 확인한 뒤 베타 참여자에게 전달합니다.

원격 저장소는 `https://github.com/buildergarlic/ginuni.git`으로 고정합니다. 일반 수정은 `agent/...`, `feature/...`, `fix/...` 브랜치에 푸시하고 PR 검증 후 `main`에 병합합니다.

설치형 앱은 시작 5초 후 공개 GitHub Releases를 확인합니다. 새 버전은 백그라운드에서 내려받고, 검수 중 수정 내용을 저장한 뒤 사용자가 **재시작하여 업데이트**를 눌렀을 때 NSIS로 교체합니다. 개발 모드에서는 업데이트 서버를 호출하지 않습니다.

## 공개 전환 체크리스트

- GitHub Sponsors 주소, `.github/FUNDING.yml`, 앱의 후원 CTA가 모두 `buildergarlic` 계정을 가리키는지 확인합니다.
- 소스를 공개할 경우 MIT, Apache-2.0 등 배포 범위에 맞는 라이선스를 소유자가 선택하고 `LICENSE`를 추가합니다. 현재 `UNLICENSED`를 임의로 변경하지 않습니다.
- 저장소 공개 전 API 키, 개인 영상 경로, 사용자 프로젝트, 민감한 HWPX 내용이 Git 이력에 없는지 검사합니다.
- 인증서가 없는 베타 설치본은 무서명 배포임과 Windows 경고 가능성을 릴리스 노트에 명확히 기록합니다. `1.0.0` 공개판 전에는 신뢰할 수 있는 코드 서명을 적용합니다.

## 코드 서명

인증서 발급 전 베타 설치본은 무서명으로 배포하므로 Windows SmartScreen에 **알 수 없는 게시자** 경고가 나타날 수 있습니다. 사용자는 반드시 공식 `buildergarlic/ginuni` Releases와 SHA-256을 확인해야 합니다. 자체 서명 인증서는 일반 사용자 PC에서 신뢰되지 않으므로 사용하지 않습니다.

릴리스 워크플로는 `WIN_CSC_LINK`와 `WIN_CSC_KEY_PASSWORD`가 모두 없으면 설치 프로그램과 앱 실행 파일이 실제 `NotSigned`인지 검사하고 베타판을 게시합니다. 두 비밀값이 모두 있으면 서명된 결과만 허용하고 Authenticode 상태가 `Valid`가 아니면 배포를 중단합니다. 하나만 등록된 잘못된 상태도 즉시 실패합니다.

### 인증서 준비

1. 신원 확인을 거치는 공개 신뢰 코드 서명 인증서 또는 CI에서 사용할 수 있는 코드 서명 서비스를 마련합니다.
2. `.pfx`/`.p12` 파일로 제공되는 인증서는 암호로 보호하고 Git 저장소와 공유 폴더에 넣지 않습니다.
3. 인증서의 게시자 이름, 유효기간, 코드 서명 용도를 확인합니다.

Microsoft Store의 MSIX 배포는 Microsoft가 서명하며, GitHub Releases에서 EXE를 직접 배포할 때는 별도의 Authenticode 서명이 필요합니다. Microsoft Artifact Signing이나 하드웨어·클라우드 키 방식 인증서를 선택하면 현재 PFX 방식 대신 해당 서비스용 GitHub Actions 연동을 별도로 구성해야 합니다.

### PFX 인증서를 GitHub Actions에 등록

PowerShell에서 실제 인증서 경로를 사용해 다음 명령을 실행합니다. Base64 문자열과 암호는 화면이나 로그에 출력하지 않습니다.

```powershell
$certificatePath = 'C:\안전한 위치\buildergarlic-code-signing.pfx'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($certificatePath)) | gh secret set WIN_CSC_LINK --repo buildergarlic/ginuni
gh secret set WIN_CSC_KEY_PASSWORD --repo buildergarlic/ginuni
```

두 번째 명령이 기다리면 인증서 암호를 입력하고 Enter를 누릅니다. 등록 여부는 값이 아니라 이름만 확인합니다.

```powershell
gh secret list --repo buildergarlic/ginuni
```

인증서가 생긴 뒤 서명 배포에 사용할 선택 비밀값은 `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`입니다. 두 값을 함께 등록하면 릴리스 워크플로가 설치 프로그램과 패키징된 앱의 Authenticode 상태가 `Valid`인지 검사합니다. 인증서가 없는 현재 베타 배포에는 등록하지 않습니다.

서명에는 SHA-256과 타임스탬프를 사용해야 인증서가 만료된 뒤에도 서명 시점의 유효성을 검증할 수 있습니다. 실제 인증서 등록 후 테스트 태그로 릴리스하고, 내려받은 설치본의 **속성 → 디지털 서명**과 다음 명령 결과를 확인합니다.

```powershell
Get-AuthenticodeSignature '.\ScreenDescriptionScriptMaker-X.Y.Z-Setup.exe' | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
```

## 파일럿 통과 기준

- 허가된 10분, 30분, 2시간 한국어 영상으로 테스트
- 명료한 음성에서 대사 경계 95%가 수동 정답 ±1초 이내
- 다화자, 동시 발화, 음악, 1초/2초 무음 사례 검수
- 모든 자동 오류를 앱에서 수정 가능
- HWPX가 한컴오피스 2022에서 복구 경고 없이 열림
- Windows 10/11에서 별도 FFmpeg·Python 설치 없이 동작

## 의존성 관리

- `package-lock.json`을 항상 커밋합니다.
- Dependabot PR은 CI 통과 후 한 번에 하나씩 병합합니다.
- Electron 보안 업데이트는 우선 처리합니다.
- FFmpeg·yt-dlp 변경 시 로컬 파일과 유튜브 링크를 모두 다시 검증합니다.
