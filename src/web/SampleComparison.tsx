import { useMemo } from 'react'
import type { ScriptRow } from '../shared/types'
import { compareSampleTranscript } from './sample-comparison'
import { SAMPLE_MEDIA, SAMPLE_REFERENCE_CUES } from './sample-media'

const preciseTime = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, '0')}`
const signedSeconds = (ms: number) => `${ms >= 0 ? '+' : ''}${(ms / 1000).toFixed(3)}초`

export default function SampleComparison({ rows, onPlay }: {
  rows: ScriptRow[]
  onPlay: (startMs: number, endMs: number) => void
}) {
  const result = useMemo(() => compareSampleTranscript(SAMPLE_REFERENCE_CUES, rows), [rows])
  const errors = result.wordErrors
  return (
    <details className="sample-comparison">
      <summary>참고 자막과 대사·시간 비교</summary>
      <p>아래는 원본 배포처의 자동 자막입니다. 잘못 인식한 말도 있어 정답으로 간주하지 않습니다. 구간을 재생해 오른쪽 AI 초안과 원음을 직접 비교하세요.</p>
      {errors && (
        <div className="comparison-summary">
          <strong>참고 자막 대비 단어 차이 {errors.substitutions + errors.deletions + errors.insertions}개 / {errors.totalReferenceWords}단어</strong>
          <span>대치 {errors.substitutions} · 누락 {errors.deletions} · 추가 {errors.insertions}</span>
          <span>문장 전체가 대응하는 {result.matchedTimingCues.length}개 구간만 시간차를 비교합니다. 나머지는 원음을 확인하세요.</span>
        </div>
      )}
      <ol>
        {SAMPLE_REFERENCE_CUES.map(cue => {
          const timing = result.matchedTimingCues.find(item => item.referenceStartMs === cue.startMs && item.referenceEndMs === cue.endMs)
          return (
            <li key={`${cue.startMs}-${cue.endMs}`}>
              <button className="reference-play" onClick={() => onPlay(cue.startMs, cue.endMs)} aria-label={`참고 자막 구간 재생 ${preciseTime(cue.startMs)}`}>
                ▶ {preciseTime(cue.startMs)} – {preciseTime(cue.endMs)}
              </button>
              <p lang="en">{cue.content}</p>
              {timing && <small>대본 시간 {preciseTime(timing.actualStartMs)} – {preciseTime(timing.actualEndMs)} · 시작 {signedSeconds(timing.startErrorMs)}, 끝 {signedSeconds(timing.endErrorMs)}</small>}
            </li>
          )
        })}
      </ol>
      <a href={SAMPLE_MEDIA.referenceUrl} target="_blank" rel="noreferrer">원본 배포처 자동 자막 보기 ↗</a>
    </details>
  )
}
