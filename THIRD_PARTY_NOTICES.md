# 제3자 구성 요소 고지

설치본은 다음 실행 파일을 포함합니다. 공개 배포 전 실제 포함 버전과 라이선스를 다시 확인하세요.

- **FFmpeg / FFprobe** — FFmpeg 프로젝트. 현재 개발 PC의 full build를 패키지에 복사합니다. 해당 빌드가 GPL 기능을 포함할 수 있으므로 배포 시 라이선스 고지와 대응 소스 제공 의무를 확인해야 합니다. <https://ffmpeg.org/legal.html>
- **yt-dlp 2026.07.04** — 코어 프로젝트는 The Unlicense이며, 공식 Windows 독립 실행 파일에는 ISC·MIT 등 별도 라이선스 구성 요소가 함께 포함됩니다. 고정 SHA-256으로 검증해 포함하며 배포 파일에 포함된 제3자 라이선스도 적용됩니다. <https://github.com/yt-dlp/yt-dlp>
- **Deno 2.9.5** — MIT License. 최신 유튜브 플레이어 스크립트 해석을 위해 Windows x64 실행 파일을 고정 SHA-256으로 검증해 포함합니다. <https://github.com/denoland/deno>
- **whisper.cpp v1.9.2** — MIT License. Windows x64 CPU 실행 파일을 설치본에 포함합니다. <https://github.com/ggml-org/whisper.cpp>
- **Whisper small-q5_1 모델** — 앱에서 사용자가 선택하면 Hugging Face의 `ggerganov/whisper.cpp` 저장소로부터 내려받습니다. 원본 Whisper 모델 및 변환 모델의 라이선스 고지를 따릅니다. <https://huggingface.co/ggerganov/whisper.cpp>
- **Electron, React, OpenAI Node SDK 및 npm 의존성** — 각 패키지의 `package.json` 라이선스를 따릅니다.

`resources/bin`의 실행 파일은 Git 저장소에 커밋하지 않으며 설치본 생성 직전에 `npm run sync:assets`로 준비합니다.
