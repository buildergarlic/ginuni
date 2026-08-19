import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronState.userData } }))

import { localModelPath, localModelStatus } from '@main/services/local-model'

let tempDirectory = ''

afterEach(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  tempDirectory = ''
})

describe('로컬 모델 무결성 상태', () => {
  it('모델이 없으면 missing으로 표시한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-model-'))
    electronState.userData = tempDirectory
    await expect(localModelStatus()).resolves.toMatchObject({ installed: false, integrity: 'missing' })
  })

  it('예상 크기와 다른 모델은 invalid로 표시한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-model-'))
    electronState.userData = tempDirectory
    await mkdir(join(tempDirectory, 'models', 'whisper'), { recursive: true })
    await writeFile(localModelPath(), 'not-a-whisper-model', 'utf8')
    await expect(localModelStatus()).resolves.toMatchObject({ installed: false, integrity: 'invalid' })
  })
})

