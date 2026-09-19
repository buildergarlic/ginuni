# 웹 체험 영상 출처

기누니 웹 샘플은 Miles Brothers가 1906년에 촬영한 실제 무성 기록영화 **A Trip Down Market Street Before the Fire**의 60초 발췌본입니다. 영상 속 움직임과 인물은 생성한 것이 아니며, 샘플의 한국어 해설만 실제 프레임을 보고 작성한 편집용 초안입니다. 원작에 없는 대사·음악·효과음을 추가하지 않았습니다.

## 배포 출처와 권리 표기

- 실제 파일 출처: [Internet Archive / Prelinger Archives의 HD 판본](https://archive.org/details/ATripDownMarketStreet_HD). 이 항목의 Usage는 **CC0 1.0 Universal**이며, 2010년 SpyPost가 Prelinger 소장 프린트에서 새로 제작한 보존 필름을 디지털화했다고 안내합니다.
- 다운로드 파일: [ATripDownMarketStreet_HD.mp4](https://archive.org/download/ATripDownMarketStreet_HD/ATripDownMarketStreet_HD.mp4). 공개 HD 항목에서 제공하는 H.264 파생본을 사용했습니다. 미국 의회도서관 다운로드 파일과 같은 디지털 판본이라고 주장하지 않습니다.
- 원작 확인: [Library of Congress 작품 기록](https://www.loc.gov/item/00694408/). 의회도서관은 이 작품이 포함된 *Before and After the Great Earthquake and Fire: Early Films of San Francisco, 1897 to 1916* 컬렉션을 퍼블릭 도메인이며 자유롭게 이용·재이용할 수 있다고 안내합니다.
- 웹 표시 크레딧: **Miles Brothers · Prelinger Archives / Internet Archive · CC0 1.0**.

이 고지는 두 기관이 제공하는 권리 안내를 출처와 함께 기록한 것입니다. 모든 국가의 법률에 대해 독립적인 퍼블릭 도메인 판정을 내렸다는 뜻은 아닙니다. 새로운 음악이나 별도 복원·편집 판본을 추가할 경우 해당 자료의 권리를 따로 확인해야 합니다.

## 포함된 파일

| 파일 | 내용 |
| --- | --- |
| `src/web/assets/sample-market-street-1906.mp4` | 원본 공개 MP4의 00:45.000~01:45.000, 정확히 60초, 480×360, 30fps, H.264, 5,283,409바이트 |
| `src/web/assets/sample-market-street-1906.jpg` | 발췌 영상 00:02.000의 실제 프레임 |
| `src/web/sample-media.ts` | 출처 메타데이터와 실제 장면에 맞춘 한국어 해설 초안 6행 |

원본의 첫 부분에는 컬러바·필름 리더가 있어 이를 피한 구간을 선택했습니다. 인코딩 시 좌우의 검은 패딩만 제거하고 영상 속 화면은 보존했습니다. 원본 공개 MP4의 첫 90초 오디오 트랙은 FFmpeg 측정에서 최대 -91dB였으며, 발췌본에서는 오디오 트랙 자체를 제외했습니다. 프레임 속도는 브라우저 재생과 정확한 60초 길이를 위해 30fps로 정규화했습니다.

2026-09-19에 확인한 원본 MP4의 크기는 65,847,811바이트, SHA-1은 `2e518f5f8fb8048773b03f85544d66963eb1edee`이며 Archive 공개 메타데이터와 일치했습니다. 변환 결과 SHA-256은 다음과 같습니다.

```text
MP4  b1b310fa7a5f9494987da2dff53d5a05a9f14332f29bb7751ab4aefcaa7fd122
JPG  63f58b89edc1a70fc01abd4f8349e9c7b7bde425f1e2b92f8252956ee72c944e
```

재생 파일은 웹 앱과 함께 같은 사이트에서 제공하므로, 샘플을 재생할 때 Archive 또는 의회도서관에 접속할 필요가 없습니다. 출처 링크를 누르면 해당 기관의 사이트로 이동합니다.

## 변환 재현

원본 파일을 `output/playwright/market-street-source.mp4`로 받은 후 저장소 루트에서 실행한 명령입니다. 원본 전체와 프레임 검토용 파일은 Git에 포함하지 않습니다.

```powershell
& resources/bin/ffmpeg.exe -ss 45 -i output/playwright/market-street-source.mp4 -t 60 -map 0:v:0 -an -vf 'crop=480:360:80:0,setsar=1,fps=30' -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart src/web/assets/sample-market-street-1906.mp4
& resources/bin/ffmpeg.exe -ss 2 -i src/web/assets/sample-market-street-1906.mp4 -frames:v 1 -q:v 2 src/web/assets/sample-market-street-1906.jpg
```

시간별 원본 프레임을 확인해 거리·차량·마차·전차·보행자에 관한 해설을 작성했습니다. 해설은 검수 완료로 표시하지 않으며 사용자가 수정할 수 있습니다. 무성 영화이므로 대사 전사 결과나 음성 AI 품질을 보여 주는 샘플로 사용하지 않습니다.
