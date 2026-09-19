import videoUrl from './assets/sample-shy-guy-1947.mp4?url'
import posterUrl from './assets/sample-shy-guy-1947.jpg?url'
import referenceSrtUrl from './assets/sample-shy-guy-1947.reference.srt?url'

/** Actual spoken film; source Public Domain notice is recorded in docs/SAMPLE_MEDIA.md. */
export const SAMPLE_MEDIA = {
  id: 'shy-guy-1947',
  url: videoUrl,
  poster: posterUrl,
  title: 'Shy Guy (1947) · 아버지와 아들의 대화',
  durationMs: 60_000,
  sourceUrl: 'https://archive.org/details/ShyGuy1947',
  sourceTitle: 'Shy Guy (1947)',
  credit: 'Coronet Instructional Films · Prelinger Archives / Internet Archive · Public Domain',
  originalStartMs: 70_000,
  originalEndMs: 130_000,
  language: 'english',
  silent: false,
  referenceUrl: 'https://archive.org/download/ShyGuy1947/ShyGuy1947.asr.srt',
  referenceSource: 'Internet Archive 자동 생성 ASR 자막 · 미검수',
  referenceSrtUrl
} as const

export const SAMPLE_REFERENCE_SRT_URL = referenceSrtUrl

/** Archive ASR cues 13–25, offset by 70 seconds. Not corrected or human-verified. */
export const SAMPLE_REFERENCE_CUES: Array<{
  startMs: number
  endMs: number
  content: string
}> = [
  { startMs: 2_420, endMs: 3_600, content: 'So well for.' },
  { startMs: 6_840, endMs: 10_430, content: 'Your record transmitter microphone going.' },
  {
    startMs: 13_100, endMs: 19_860,
    content: "I can't figure out where to connect. I\nknow I have to connect. But where this is."
  },
  { startMs: 19_880, endMs: 22_580, content: 'Why not a store and get more information.' },
  {
    startMs: 22_600, endMs: 27_160,
    content: 'By the way how things are\ngoing in school. Oh OK.'
  },
  {
    startMs: 28_870, endMs: 34_120,
    content: "But school here isn't like I was back in\nMorristown But you know maybe school is"
  },
  { startMs: 34_120, endMs: 35_600, content: 'like your radio.' },
  { startMs: 35_610, endMs: 37_640, content: 'This oscillator will do its work well' },
  {
    startMs: 38_520, endMs: 43_330,
    content: 'but as you said you still have to fit it\nin so it can work with all the other five'
  },
  {
    startMs: 44_180, endMs: 49_810,
    content: "hundred what you're driving at. Dad But I\ndon't think I ever will fit in here on."
  },
  {
    startMs: 50_000, endMs: 52_780,
    content: "I'm different from the guys\nin this town but as far as"
  },
  {
    startMs: 52_780, endMs: 56_310,
    content: "that goes fail everybody's different.\nThat's what makes people interesting."
  },
  { startMs: 56_860, endMs: 59_770, content: 'Maybe you know.' }
]
