import { app, safeStorage } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'

interface SettingsFile {
  encryptedApiKey?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<SettingsFile> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as SettingsFile
  } catch {
    return {}
  }
}

async function writeSettings(settings: SettingsFile): Promise<void> {
  await writeFileAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8' })
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const normalized = apiKey.trim()
  if (normalized.length < 20) throw new Error('OpenAI API 키 형식이 올바르지 않습니다.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 Windows 계정에서 보안 저장소를 사용할 수 없습니다.')
  const settings = await readSettings()
  settings.encryptedApiKey = safeStorage.encryptString(normalized).toString('base64')
  await writeSettings(settings)
}

export async function getApiKey(): Promise<string | null> {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim()
  const settings = await readSettings()
  if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'))
  } catch {
    return null
  }
}

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await getApiKey())
}

export async function clearApiKey(): Promise<void> {
  const settings = await readSettings()
  delete settings.encryptedApiKey
  if (Object.keys(settings).length === 0) {
    await rm(settingsPath(), { force: true })
    return
  }
  await writeSettings(settings)
}
