import type { ScriptProject } from './types'

export function supportsSpeakerLabels(project: ScriptProject): boolean {
  const dialogue = project.rows.filter(row => row.kind === 'dialogue')
  if (dialogue.length && dialogue.every(row => row.sourceCueIds?.length && !row.sourceSegmentIds.length)) return false
  const latestSuccessfulRun = project.runs.filter((run) => run.completedAt && !run.errorCode).at(-1)
  if (latestSuccessfulRun?.provider === 'openai') return true
  return latestSuccessfulRun?.diarization?.status === 'succeeded'
}
