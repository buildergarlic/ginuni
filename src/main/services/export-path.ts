import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { safeFileName } from './file-name'

async function outputExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function nextVersionedExportPath(
  outputDirectory: string,
  title: string,
  extension: 'hwpx' | 'srt'
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true })
  const base = `${safeFileName(title)}_화면해설대본`
  for (let version = 1; version <= 999; version += 1) {
    const filePath = join(outputDirectory, `${base}_V${String(version).padStart(2, '0')}.${extension}`)
    if (!(await outputExists(filePath))) return filePath
  }
  throw new Error('내보내기 버전 번호가 999를 초과했습니다.')
}

