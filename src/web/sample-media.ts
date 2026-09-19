import videoUrl from './assets/sample-market-street-1906.mp4?url'
import posterUrl from './assets/sample-market-street-1906.jpg?url'

/** Actual 1906 film, excerpted from the Prelinger Archives' CC0 distribution. */
export const SAMPLE_MEDIA = {
  id: 'market-street-1906',
  url: videoUrl,
  poster: posterUrl,
  title: '1906년 샌프란시스코, 마켓 스트리트',
  durationMs: 60_000,
  sourceUrl: 'https://archive.org/details/ATripDownMarketStreet_HD',
  sourceTitle: 'A Trip Down Market Street Before the Fire (1906)',
  credit: 'Miles Brothers · Prelinger Archives / Internet Archive · CC0 1.0',
  originalStartMs: 45_000,
  silent: true
} as const

/** Editable, unreviewed description drafts based on the excerpt's actual frames. */
export const SAMPLE_DESCRIPTION_ROWS: Array<{
  startMs: number
  endMs: number
  content: string
}> = [
  {
    startMs: 0,
    endMs: 8_000,
    content:
      '흑백 화면. 건물이 늘어선 넓은 거리 한가운데, 철로가 곧게 뻗어 있다.'
  },
  {
    startMs: 8_000,
    endMs: 18_000,
    content: '지붕을 덮은 자동차가 화면 앞을 지나 오른쪽으로 앞서 간다.'
  },
  {
    startMs: 18_000,
    endMs: 29_000,
    content:
      '앞서 가는 마차 옆으로 밝은색 자동차가 달리고, 다른 자동차가 가까이 지나간다.'
  },
  {
    startMs: 29_000,
    endMs: 40_000,
    content:
      '카메라가 철로를 따라 나아간다. 자동차와 마차들이 길을 나누어 달린다.'
  },
  {
    startMs: 40_000,
    endMs: 49_000,
    content:
      '둥근 통을 실은 마차가 오른쪽 길을 따라간다. 말과 마차가 가까이 스쳐 지난다.'
  },
  {
    startMs: 49_000,
    endMs: 60_000,
    content:
      '반대편 철로의 전차가 가까워져 왼쪽을 스쳐 간다. 오른쪽 인도에는 사람들이 늘어서 있다.'
  }
]
