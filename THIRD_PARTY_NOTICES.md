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

다음 버전과 고지는 2026-09-20 웹 구현 기준입니다. 웹 전용 `@huggingface/transformers`, `onnxruntime-web`, `mediabunny`, `fflate`는 `devDependencies`에 두고 웹 정적 결과물에 묶습니다. Windows 앱에서 이 패키지를 가져오지 않으며 웹 모델과 네이티브 ONNX Node 런타임을 설치형 배포에 추가하지 않습니다. Whisper·번역 모델은 사용자가 해당 AI 기능을 실행할 때 외부 배포처에서 내려받고, 아래 Silero VAD 모델은 웹 정적 결과물에 포함해 같은 사이트에서 제공합니다.

- **Transformers.js / @huggingface/transformers 3.8.1** — Hugging Face, Apache License 2.0. 브라우저 음성 분석 파이프라인입니다. 설치 패키지의 `LICENSE`와 `package.json`에서 확인했습니다. [프로젝트](https://github.com/huggingface/transformers.js) · [라이선스 전문](https://github.com/huggingface/transformers.js/blob/3.8.1/LICENSE).
- **Whisper 원본 모델(tiny, small, base.en, large-v3-turbo)** — Copyright (c) 2022 OpenAI, MIT License. OpenAI는 Whisper 코드와 모델 가중치에 MIT를 적용한다고 안내합니다. `resources/licenses/whisper-MIT.txt`에 고지와 전문을 보존합니다. [원본 라이선스 안내](https://github.com/openai/whisper#license) · [MIT 전문](https://github.com/openai/whisper/blob/main/LICENSE) · [large-v3-turbo 원본 모델의 MIT 표기](https://huggingface.co/openai/whisper-large-v3-turbo).
- **onnx-community/whisper-large-v3-turbo ONNX 변환 모델** — 한국어 정밀 분석의 WebGPU 모델입니다. 고정 리비전 `360ebcde2559d60bb474678be3c1de9ef347d01a`에서 encoder fp16과 decoder q4를 사용합니다. 해당 리비전의 모델 카드는 OpenAI의 원본 모델을 지정하며 별도 `license` 메타데이터는 기재하지 않습니다. 원본 Whisper의 MIT 고지·전문을 보존합니다. [고정 리비전 모델 카드](https://huggingface.co/onnx-community/whisper-large-v3-turbo/blob/360ebcde2559d60bb474678be3c1de9ef347d01a/README.md).
- **Xenova/whisper-small ONNX 변환 모델** — 한국어 CPU 호환 분석의 q8 모델입니다. 고정 리비전은 `2d67713f236afa48a18992566e7647f6ca848e13`이며 모델 카드에는 **Apache-2.0**이 명시되어 있습니다. 원본 Whisper MIT 고지를 함께 보존합니다. [고정 리비전 모델 카드와 라이선스 표기](https://huggingface.co/Xenova/whisper-small/blob/2d67713f236afa48a18992566e7647f6ca848e13/README.md).
- **Xenova/whisper-tiny ONNX 변환 모델** — 웹 앱이 실제로 내려받는 모델이며 고정 리비전은 `5332fcc35e32a33b86612b9a57a89be7906102b1`입니다. 이 배포본의 모델 카드에는 **Apache-2.0**이 명시되어 있으므로 원본 OpenAI 모델의 MIT 고지와 함께 구분해 보존합니다. [고정 리비전 모델 카드와 라이선스 표기](https://huggingface.co/Xenova/whisper-tiny/blob/5332fcc35e32a33b86612b9a57a89be7906102b1/README.md).
- **Xenova/whisper-base.en ONNX 변환 모델** — 영어 원음을 전사할 때 사용하는 영어 전용 모델입니다. 고정 리비전은 `95bf40a508535962c6483ead40270b2e32267508`이며 모델 카드의 라이선스는 **Apache-2.0**입니다. 원본 Whisper MIT 고지를 함께 보존합니다. [고정 리비전 모델 카드](https://huggingface.co/Xenova/whisper-base.en/blob/95bf40a508535962c6483ead40270b2e32267508/README.md).
- **ONNX Runtime Web 1.22.0-dev.20250409-89f8206ba4** — Microsoft, MIT License. Transformers.js의 WASM·WebGPU 추론과 Silero VAD에서 같은 버전의 브라우저 런타임을 사용합니다. 전문은 `resources/licenses/onnxruntime-MIT.txt`에 포함됩니다. [프로젝트와 라이선스](https://github.com/microsoft/onnxruntime).
- **Silero VAD ONNX 모델** — Copyright (c) 2020-present Silero Team, **MIT License**. 한국어 발화 구간을 검출합니다. 공식 `snakers4/silero-vad` 저장소의 커밋 `60b7ffa243625ebdc1070275a29f18c87843786a`, `src/silero_vad/data/silero_vad.onnx`를 수정 없이 `src/web/assets/silero-vad.onnx`로 포함합니다. 파일 크기는 **2,327,524바이트**, SHA-256은 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`입니다. 저작권·MIT 전문은 `resources/licenses/silero-vad-MIT.txt`와 웹 `licenses.txt`에 포함합니다. [고정 모델 원본](https://github.com/snakers4/silero-vad/blob/60b7ffa243625ebdc1070275a29f18c87843786a/src/silero_vad/data/silero_vad.onnx) · [고정 라이선스 전문](https://github.com/snakers4/silero-vad/blob/60b7ffa243625ebdc1070275a29f18c87843786a/LICENSE).
- **fflate 0.8.3** — Copyright (c) 2026 Arjun Barrett, MIT License. 브라우저에서 HWPX ZIP 파일을 생성합니다. 설치 패키지의 `LICENSE`와 `package.json`에서 확인했습니다. [프로젝트](https://github.com/101arrowz/fflate) · [라이선스 전문](https://github.com/101arrowz/fflate/blob/v0.8.3/LICENSE).
- **MediaBunny / mediabunny 1.58.1** — Vanilagy, Mozilla Public License 2.0 (`MPL-2.0`). 브라우저에서 미디어 파일의 일부 구간을 읽고 오디오를 해독하는 데 사용합니다. 설치 패키지의 `LICENSE`와 `package.json`에서 확인했으며 라이브러리 원본 소스를 수정하지 않고 웹 빌드에 포함합니다. [해당 버전 소스](https://github.com/Vanilagy/mediabunny/tree/v1.58.1/src) · [라이선스 전문](https://github.com/Vanilagy/mediabunny/blob/v1.58.1/LICENSE).

- **M2M100 / Xenova/m2m100_418M** — 외국어 대사를 한국어로 번역하는 다국어 모델입니다. ONNX 변환본의 고정 리비전은 `9c374f0b7aca709787cea97b047bfbbd1559d177`입니다. 원본 모델은 Facebook의 **MIT License**이며 Copyright (c) Facebook, Inc. and its affiliates. 고지를 보존합니다. [원본 모델과 MIT 표기](https://huggingface.co/facebook/m2m100_418M) · [고정 ONNX 변환본](https://huggingface.co/Xenova/m2m100_418M/tree/9c374f0b7aca709787cea97b047bfbbd1559d177) · [원본 라이선스](https://github.com/facebookresearch/fairseq/blob/main/LICENSE). 전문은 `resources/licenses/m2m100-MIT.txt` 및 웹 `licenses.txt`에 포함됩니다.

Whisper·번역 모델은 Hugging Face 및 관련 CDN에서, WASM 런타임은 jsDelivr에서 가져오며 각 배포처의 고지도 적용됩니다. Silero VAD는 위 고정 모델을 사이트에 포함해 제공합니다. 음성 인식·발화 검출·번역은 사용자 기기에서 실행합니다. 라이브러리의 개발 의존성 분류는 웹 결과물 재배포 시 라이선스·저작권 고지를 보존할 의무를 없애지 않습니다.

## 웹 체험 영상

**Shy Guy (1947)** — Coronet Instructional Films. [Internet Archive의 Prelinger Archives 배포 항목](https://archive.org/details/ShyGuy1947)은 **Public Domain**으로 안내하며 [기존 Creative Commons Public Domain Dedication / Certification](https://creativecommons.org/licenses/publicdomain/)을 연결합니다. CC0로 표기하지 않습니다. 해당 공개 H.264 판본의 01:10–02:10을 발췌했으며, 아버지와 아들이 나누는 실제 영어 대화와 원음을 보존했습니다. 합성 음성·가상 대사·추가 음악은 없고 포스터는 발췌본의 실제 프레임입니다.

참조 자막은 같은 항목의 [공개 자동 생성 SRT](https://archive.org/download/ShyGuy1947/ShyGuy1947.asr.srt) 13–25행입니다. 클립에 맞게 시간을 조정했으며 텍스트 오인식을 임의로 고치지 않았습니다. 사람이 검수한 정답 자막이 아닙니다. 정확한 파일·크레딧·변환 방법·해시·자막 한계는 [샘플 영상 출처 문서](docs/SAMPLE_MEDIA.md)를 확인하세요.

## FFmpeg 배포별 대응 소스

현재 동기화 스크립트는 개발 PC 또는 CI에 설치된 FFmpeg를 복사하므로 위에서 확인한 버전이 모든 릴리스에 고정되는 것은 아닙니다. 릴리스마다 실제 실행 파일의 버전·빌드 옵션·라이선스와 SHA-256을 기록해야 합니다.

GPL 실행 파일을 배포할 때는 해당 바이너리와 포함 라이브러리에 대응하는 소스 및 필요한 빌드 스크립트를 수신자가 받을 수 있도록 제공해야 합니다. 위 FFmpeg·Gyan 링크는 프로젝트와 빌드 출처 안내이며, 배포 바이너리 전체의 대응 소스 제공을 완료했다는 뜻이 아닙니다. 실제 제공 위치를 확인하고 릴리스 다운로드 옆에 안내한 뒤 새 설치본을 공개하세요.
