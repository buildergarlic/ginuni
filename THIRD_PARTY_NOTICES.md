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

## 웹 작업실 구성 요소

다음 버전과 고지는 2026-09-19 웹 구현 기준입니다. 웹 전용 `@huggingface/transformers`, `mediabunny`, `fflate`는 `devDependencies`에 두고 웹 정적 결과물에 묶습니다. Windows 앱에서 이 패키지를 가져오지 않으며 웹 모델과 네이티브 ONNX Node 런타임을 설치형 배포에 추가하지 않습니다. 웹에서 사용하는 모델은 사용자가 AI 분석을 실행할 때 내려받습니다.

- **Transformers.js / @huggingface/transformers 3.8.1** — Hugging Face, Apache License 2.0. 브라우저 음성 분석 파이프라인입니다. 설치 패키지의 `LICENSE`와 `package.json`에서 확인했습니다. [프로젝트](https://github.com/huggingface/transformers.js) · [라이선스 전문](https://github.com/huggingface/transformers.js/blob/3.8.1/LICENSE).
- **Whisper tiny 원본 모델** — Copyright (c) 2022 OpenAI, MIT License. OpenAI는 Whisper 코드와 모델 가중치에 MIT를 적용한다고 안내합니다. [원본 라이선스 안내](https://github.com/openai/whisper#license) · [MIT 전문](https://github.com/openai/whisper/blob/main/LICENSE).
- **Xenova/whisper-tiny ONNX 변환 모델** — 웹 앱이 실제로 내려받는 모델이며 고정 리비전은 `5332fcc35e32a33b86612b9a57a89be7906102b1`입니다. 이 배포본의 모델 카드에는 **Apache-2.0**이 명시되어 있으므로 원본 OpenAI 모델의 MIT 고지와 함께 구분해 보존합니다. [고정 리비전 모델 카드와 라이선스 표기](https://huggingface.co/Xenova/whisper-tiny/blob/5332fcc35e32a33b86612b9a57a89be7906102b1/README.md).
- **ONNX Runtime Web 1.22.0-dev.20250409-89f8206ba4** — Microsoft, MIT License. Transformers.js가 사용하는 브라우저 WASM 런타임입니다. [프로젝트와 라이선스](https://github.com/microsoft/onnxruntime).
- **fflate 0.8.3** — Copyright (c) 2026 Arjun Barrett, MIT License. 브라우저에서 HWPX ZIP 파일을 생성합니다. 설치 패키지의 `LICENSE`와 `package.json`에서 확인했습니다. [프로젝트](https://github.com/101arrowz/fflate) · [라이선스 전문](https://github.com/101arrowz/fflate/blob/v0.8.3/LICENSE).
- **MediaBunny / mediabunny 1.58.1** — Vanilagy, Mozilla Public License 2.0 (`MPL-2.0`). 브라우저에서 미디어 파일의 일부 구간을 읽고 오디오를 해독하는 데 사용합니다. 설치 패키지의 `LICENSE`와 `package.json`에서 확인했으며 라이브러리 원본 소스를 수정하지 않고 웹 빌드에 포함합니다. [해당 버전 소스](https://github.com/Vanilagy/mediabunny/tree/v1.58.1/src) · [라이선스 전문](https://github.com/Vanilagy/mediabunny/blob/v1.58.1/LICENSE).

모델은 Hugging Face 및 관련 CDN에서, WASM 런타임은 jsDelivr에서 가져오며 각 배포처의 고지도 적용됩니다. 라이브러리의 개발 의존성 분류는 웹 결과물 재배포 시 라이선스·저작권 고지를 보존할 의무를 없애지 않습니다.

## 웹 체험 영상

**A Trip Down Market Street Before the Fire (1906)** — Miles Brothers. [Internet Archive의 Prelinger Archives 배포 항목](https://archive.org/details/ATripDownMarketStreet_HD)은 **CC0 1.0 Universal**로 안내합니다. 해당 항목의 공개 H.264 판본에서 00:45~01:45의 60초를 발췌해 앱과 함께 제공합니다. 별도 음악이나 가상의 대사를 추가하지 않았으며, 포스터는 이 발췌본의 실제 프레임입니다. 한국어 해설 6행은 기누니의 편집용 초안입니다.

[미국 의회도서관 작품 기록](https://www.loc.gov/item/00694408/)도 원작을 포함한 컬렉션이 퍼블릭 도메인이라고 안내합니다. 실제 다운로드한 Archive 판본과 의회도서관 디지털 판본을 혼동하지 않도록 출처를 구분했습니다. 정확한 파일·크레딧·변환 방법·해시는 [샘플 영상 출처 문서](docs/SAMPLE_MEDIA.md)를 확인하세요.

## FFmpeg 배포별 대응 소스

현재 동기화 스크립트는 개발 PC 또는 CI에 설치된 FFmpeg를 복사하므로 위에서 확인한 버전이 모든 릴리스에 고정되는 것은 아닙니다. 릴리스마다 실제 실행 파일의 버전·빌드 옵션·라이선스와 SHA-256을 기록해야 합니다.

GPL 실행 파일을 배포할 때는 해당 바이너리와 포함 라이브러리에 대응하는 소스 및 필요한 빌드 스크립트를 수신자가 받을 수 있도록 제공해야 합니다. 위 FFmpeg·Gyan 링크는 프로젝트와 빌드 출처 안내이며, 배포 바이너리 전체의 대응 소스 제공을 완료했다는 뜻이 아닙니다. 실제 제공 위치를 확인하고 릴리스 다운로드 옆에 안내한 뒤 새 설치본을 공개하세요.
