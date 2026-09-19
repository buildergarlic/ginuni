# 제3자 구성 요소 고지

GiNuNi 자체 소스 코드에는 GNU Affero General Public License v3.0 (AGPL-3.0-only)이 적용됩니다. 아래 제3자 소프트웨어·모델 등은 각각의 원래 저작권과 라이선스를 유지하며, GiNuNi의 라이선스로 재허가되지 않습니다.

프로젝트 `LICENSE`·`NOTICE`·이 파일과 `resources/licenses`의 고지·전문은 설치 폴더의 `resources/licenses`에도 포함됩니다. 설치본은 다음 구성 요소를 포함하거나 내려받아 사용합니다. 공개 배포 전 실제 포함 버전과 라이선스를 다시 확인하세요.

- **FFmpeg / FFprobe** — FFmpeg 프로젝트. 2026-09-16 개발 원본에서 확인한 실행 파일은 Gyan `8.1.1-full_build-www.gyan.dev`이며 `--enable-gpl --enable-version3`로 빌드되어 GPL-3.0-or-later가 적용됩니다. Copyright (c) 2000-2026 the FFmpeg developers (FFmpeg), Copyright (c) 2007-2026 the FFmpeg developers (FFprobe). GPL 조건에 따라 재배포·수정할 수 있으며 보증 없이 제공됩니다. GPL v3 전문은 `resources/licenses/GPL-3.0.txt`에 포함됩니다. 앱에서는 별도 실행 파일을 호출합니다. 배포별 대응 소스 확인은 아래 안내를 따르세요. <https://ffmpeg.org/legal.html> / <https://www.gyan.dev/ffmpeg/builds/>
- **yt-dlp 2026.07.04** — 코어 프로젝트는 The Unlicense이며, 공식 Windows 독립 실행 파일에는 ISC·MIT 등 별도 라이선스 구성 요소가 함께 포함됩니다. 고정 SHA-256으로 검증해 포함하며 배포 파일에 포함된 제3자 라이선스도 적용됩니다. <https://github.com/yt-dlp/yt-dlp>
- **Deno 2.9.5** — MIT License. 최신 유튜브 플레이어 스크립트 해석을 위해 Windows x64 실행 파일을 고정 SHA-256으로 검증해 포함합니다. <https://github.com/denoland/deno>
- **whisper.cpp v1.9.2** — MIT License. Windows x64 CPU 실행 파일을 설치본에 포함합니다. <https://github.com/ggml-org/whisper.cpp>
- **Whisper small-q5_1 모델** — 앱에서 사용자가 선택하면 Hugging Face의 `ggerganov/whisper.cpp` 저장소로부터 내려받습니다. 원본 Whisper 모델 및 변환 모델의 라이선스 고지를 따릅니다. <https://huggingface.co/ggerganov/whisper.cpp>
- **sherpa-onnx v1.13.6 / ONNX Runtime** — Windows x64 화자 분리 CLI와 필요한 공유 라이브러리만 고정 버전·SHA-256으로 검증해 포함합니다. sherpa-onnx는 Apache License 2.0이며 설치본의 `licenses` 폴더에 고지와 전문을 포함합니다. <https://github.com/k2-fsa/sherpa-onnx>
- **Pyannote segmentation 3.0 int8** — 화자 발화 구간 모델. MIT License이며 설치본의 `licenses` 폴더에 전문을 포함합니다. <https://huggingface.co/pyannote/segmentation-3.0>
- **3D-Speaker ERes2Net base 16k** — 화자 임베딩 모델. Apache License 2.0 고지와 함께 설치본에 포함합니다. <https://github.com/modelscope/3D-Speaker>
- **Electron, React, OpenAI Node SDK 및 npm 의존성** — 각 패키지의 `package.json` 라이선스를 따릅니다.
- **Fluent UI System Icons / @fluentui/react-icons** — Microsoft Corporation, MIT License. 전문은 `resources/licenses/fluent-ui-system-icons-LICENSE.txt`에 포함됩니다. <https://github.com/microsoft/fluentui-system-icons>

`resources/bin`의 실행 파일·DLL·ONNX 모델은 Git 저장소에 커밋하지 않으며 설치본 생성 직전에 `npm run sync:assets`로 준비합니다.

## FFmpeg 배포별 대응 소스

현재 동기화 스크립트는 개발 PC 또는 CI에 설치된 FFmpeg를 복사하므로 위에서 확인한 버전이 모든 릴리스에 고정되는 것은 아닙니다. 릴리스마다 실제 실행 파일의 버전·빌드 옵션·라이선스와 SHA-256을 기록해야 합니다.

GPL 실행 파일을 배포할 때는 해당 바이너리와 포함 라이브러리에 대응하는 소스 및 필요한 빌드 스크립트를 수신자가 받을 수 있도록 제공해야 합니다. 위 FFmpeg·Gyan 링크는 프로젝트와 빌드 출처 안내이며, 배포 바이너리 전체의 대응 소스 제공을 완료했다는 뜻이 아닙니다. 실제 제공 위치를 확인하고 릴리스 다운로드 옆에 안내한 뒤 새 설치본을 공개하세요.
