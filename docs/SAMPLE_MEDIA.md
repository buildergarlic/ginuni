# 웹 체험 영상 출처

기누니의 현재 샘플은 Coronet Instructional Films의 실제 유성영화 **Shy Guy (1947)** 중 아버지와 아들이 작업실에서 이야기하는 60초입니다. 원래 영어 육성과 화면을 함께 보존했으며 합성 음성·가상 대사·추가 음악을 넣지 않았습니다. 한국어 번역 음성이 아닙니다.

## 배포 출처와 권리 표기

- [Internet Archive / Prelinger Archives 작품 항목](https://archive.org/details/ShyGuy1947)은 제작자를 **Coronet Instructional Films**, 제작 연도를 **1947**, Usage를 **Public Domain**으로 명시합니다.
- 해당 항목이 연결하는 권리 표기는 [Creative Commons의 기존 Public Domain Dedication / Certification](https://creativecommons.org/licenses/publicdomain/)입니다. CC0와 구분하며 앱에서도 **Public Domain**으로 표기합니다.
- 실제 다운로드 파일은 해당 항목의 공개 H.264 파생본 [ShyGuy1947.mp4](https://archive.org/download/ShyGuy1947/ShyGuy1947.mp4)입니다.
- 크레딧: **Coronet Instructional Films · Prelinger Archives / Internet Archive · Public Domain**.

위 내용은 배포 기관이 제공하는 권리 안내를 기록한 것입니다. 모든 국가에서 독립적으로 권리 상태를 판정했다는 뜻은 아닙니다. 별도의 더빙·음악·복원 판본은 사용하지 않았습니다.

## 발췌 파일과 장면

| 파일 | 내용 |
| --- | --- |
| `src/web/assets/sample-shy-guy-1947.mp4` | 공개 MP4 01:10.000–02:10.000, 정확히 60초, 480×360, 30fps, H.264/AAC, 2,801,001바이트 |
| `src/web/assets/sample-shy-guy-1947.jpg` | 발췌 영상 00:25.000의 실제 프레임 |
| `src/web/assets/sample-shy-guy-1947.reference.srt` | Archive 자동 자막 13–25행을 클립 시간으로 옮긴 참조용 SRT, 13행 |
| `src/web/sample-media.ts` | 출처·영어 음성·시간 오프셋·참조 자막 |
| `src/web/sample-transcript.json` | 실제 브라우저 모델 실행에서 저장한 미검수 대사와 타임스탬프 |

실제 프레임을 5초 간격으로 확인했습니다. 아버지가 계단에서 작업대 옆으로 다가오고, 아들이 앉아서 대화하며, 아버지가 부품을 손에 드는 장면입니다. 클립은 원래의 소리와 시간 흐름을 유지합니다. 웹 앱과 같은 사이트에서 파일을 제공하므로 재생에 Archive 접속은 필요하지 않습니다.

## 참조 자동 자막의 한계

참조 출처는 Archive가 공개한 [ShyGuy1947.asr.srt](https://archive.org/download/ShyGuy1947/ShyGuy1947.asr.srt)입니다. 사람이 검수한 자막이나 정확도 평가의 정답지가 아닙니다. 첫 문장의 `So well for.`, 이어지는 `five` / `hundred` 분절, `that goes fail` 등 의심스러운 인식과 잘못된 문장 구분이 원본에 있으며 이를 임의로 고치지 않았습니다. 모델 결과와 참조가 다르다는 이유만으로 모델 결과가 틀렸다고 판단할 수 없습니다. 원음을 듣고 단어·화자·시작과 끝 시간을 검토해야 합니다.

처리한 것은 큐 번호 1부터 다시 매기기, 70,000ms 빼기, 원본의 두 자리 소수 시간을 세 자리 밀리초 SRT 표기로 정규화하기뿐입니다. 영어 텍스트와 줄바꿈은 원본 13–25행을 그대로 보존했습니다. 첫 참조 발화는 클립 00:02.420, 마지막 참조 큐의 끝은 00:59.770이며 다음 원본 큐는 02:10.950에 시작합니다. 이 경계는 **원본 ASR 시간 기준**이고 사람이 발화를 정밀 검수했다는 뜻은 아닙니다.

샘플을 열 때는 실제 브라우저 실행 결과를 저장한 AI 초안을 표시합니다. **샘플 음성 AI 다시 분석**은 같은 영상의 음성을 현재 기기에서 새로 처리합니다. 초안은 모두 미검수 상태이며, 참고 자막의 문장을 모델 출력에 복사하지 않습니다.

## 파일 무결성과 변환 재현

2026-09-19에 원본 MP4 전체를 내려받아 크기 **84,910,850바이트**, SHA-1 **`ace8133f8bad2a9003d7666bb1d98452d596185e`**가 [Archive 공개 메타데이터](https://archive.org/metadata/ShyGuy1947)와 일치함을 확인했습니다. 발췌본 SHA-256은 다음과 같습니다.

```text
MP4  7fd3c9030b5d88ffa4c067c84c4c4361ad4be6d95e8cb494d8efeb952906f47c
JPG  071d207b135abdba4e4da6ab73e9e63a2ae6f6d52213a312dbe2a884f489bbed
```

원본 전체와 검토용 파일은 Git에 포함하지 않습니다. 저장소 루트에서 실행한 변환 명령입니다.

```powershell
& resources/bin/ffmpeg.exe -ss 70 -i output/playwright/shy-guy-source.mp4 -t 60 -map 0:v:0 -map 0:a:0 -vf 'scale=480:-2,setsar=1,fps=30' -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart src/web/assets/sample-shy-guy-1947.mp4
& resources/bin/ffmpeg.exe -ss 25 -i src/web/assets/sample-shy-guy-1947.mp4 -frames:v 1 -q:v 2 src/web/assets/sample-shy-guy-1947.jpg
```

이전 버전의 무성 기록영화 *A Trip Down Market Street Before the Fire (1906)*는 현재 음성 분석 샘플이 아닙니다. 이전에 저장한 대본을 새 영화와 자동으로 연결하지 않습니다.
