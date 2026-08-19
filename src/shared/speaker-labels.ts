import type { ScriptProject } from './types'

export function supportsSpeakerLabels(project: ScriptProject): boolean {
  const latestSuccessfulRun = project.runs.filter((run) => run.completedAt && !run.errorCode).at(-1)
  if (latestSuccessfulRun?.provider === 'openai') return true
  return latestSuccessfulRun?.diarization?.status === 'succeeded'
}
