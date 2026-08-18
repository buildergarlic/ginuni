import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

const targetDirectory = join(process.cwd(), 'resources', 'bin')
await mkdir(targetDirectory, { recursive: true })

function resolveCommand(command) {
  const result = execFileSync('where.exe', [command], { encoding: 'utf8' })
  return result.split(/\r?\n/).map((value) => value.trim()).find(Boolean)
}

function commandIncludes(executable, value) {
  try {
    return execFileSync(executable, ['--version'], { encoding: 'utf8' }).includes(value)
  } catch {
    return false
  }
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function fileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

for (const [command, target] of [['ffmpeg', 'ffmpeg.exe'], ['ffprobe', 'ffprobe.exe']]) {
  const source = resolveCommand(command)
  if (!source) throw new Error(`${command} 실행 파일을 찾을 수 없습니다.`)
  const targetPath = join(targetDirectory, target)
  await mkdir(dirname(targetPath), { recursive: true })
  await copyFile(source, targetPath)
  process.stdout.write(`Synced ${command}: ${targetPath}\n`)
}

const ytDlpVersion = '2026.07.04'
const ytDlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${ytDlpVersion}/yt-dlp.exe`
const ytDlpSha256 = '52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8'
const ytDlpPath = join(targetDirectory, 'yt-dlp.exe')
if (!await exists(ytDlpPath) || await fileSha256(ytDlpPath) !== ytDlpSha256) {
  const downloadPath = `${ytDlpPath}.download`
  await rm(downloadPath, { force: true })
  const response = await fetch(ytDlpUrl, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`yt-dlp ${ytDlpVersion} 다운로드 실패: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(downloadPath))
  const actualHash = await fileSha256(downloadPath)
  if (actualHash !== ytDlpSha256) {
    await rm(downloadPath, { force: true })
    throw new Error(`yt-dlp ${ytDlpVersion} 무결성 검사에 실패했습니다.`)
  }
  await rm(ytDlpPath, { force: true })
  await rename(downloadPath, ytDlpPath)
}
process.stdout.write(`Synced yt-dlp ${ytDlpVersion}: ${ytDlpPath}\n`)

async function extractSingleFile(zipPath, expectedName, outputPath) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return finish(openError ?? new Error(`${expectedName} 압축 파일을 열 수 없습니다.`))
      zip.readEntry()
      zip.on('entry', (entry) => {
        if (basename(entry.fileName.replace(/\\/g, '/')) !== expectedName) return zip.readEntry()
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return finish(streamError ?? new Error(`${expectedName} 압축 해제 실패`))
          pipeline(stream, createWriteStream(outputPath)).then(() => finish(), finish)
        })
      })
      zip.on('end', () => finish(new Error(`${expectedName}을 압축 파일에서 찾지 못했습니다.`)))
      zip.on('error', finish)
    })
  })
}

const denoVersion = '2.9.5'
const denoArchiveUrl = `https://github.com/denoland/deno/releases/download/v${denoVersion}/deno-x86_64-pc-windows-msvc.zip`
const denoArchiveSha256 = '171efab55ac6b9881fd53ee4c20f8bf3bb1340ffc618483746909014db12216a'
const denoExecutableSha256 = '98f8c2a2d470e4ccb04c935c86ff8050817d877762aec5eaeeb9e409ccb3b9fd'
const denoPath = join(targetDirectory, 'deno.exe')
if (!await exists(denoPath) || await fileSha256(denoPath) !== denoExecutableSha256 || !commandIncludes(denoPath, `deno ${denoVersion}`)) {
  const archivePath = join(targetDirectory, `deno-v${denoVersion}.zip.download`)
  const executableDownloadPath = `${denoPath}.download`
  await rm(archivePath, { force: true })
  await rm(executableDownloadPath, { force: true })
  const response = await fetch(denoArchiveUrl, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Deno ${denoVersion} 다운로드 실패: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath))
  const actualHash = await fileSha256(archivePath)
  if (actualHash !== denoArchiveSha256) {
    await rm(archivePath, { force: true })
    throw new Error(`Deno ${denoVersion} 무결성 검사에 실패했습니다.`)
  }
  await extractSingleFile(archivePath, 'deno.exe', executableDownloadPath)
  await rm(archivePath, { force: true })
  await rm(denoPath, { force: true })
  await rename(executableDownloadPath, denoPath)
}
if (await fileSha256(denoPath) !== denoExecutableSha256 || !commandIncludes(denoPath, `deno ${denoVersion}`)) {
  throw new Error(`Deno ${denoVersion} 무결성 또는 실행 검증에 실패했습니다.`)
}
process.stdout.write(`Synced Deno ${denoVersion}: ${denoPath}\n`)

const whisperVersion = 'v1.9.2'
const whisperUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperVersion}/whisper-bin-x64.zip`
const whisperDirectory = join(targetDirectory, 'whisper')
const whisperExecutable = join(whisperDirectory, 'whisper-cli.exe')
const whisperFiles = new Set([
  'whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll',
  'ggml-cpu-alderlake.dll', 'ggml-cpu-cannonlake.dll', 'ggml-cpu-cascadelake.dll',
  'ggml-cpu-haswell.dll', 'ggml-cpu-icelake.dll', 'ggml-cpu-sandybridge.dll',
  'ggml-cpu-skylakex.dll', 'ggml-cpu-sse42.dll', 'ggml-cpu-x64.dll'
])

async function extractWhisper(zipPath) {
  await mkdir(whisperDirectory, { recursive: true })
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('whisper.cpp 압축 파일을 열 수 없습니다.'))
      zip.readEntry()
      zip.on('entry', (entry) => {
        const name = basename(entry.fileName.replace(/\\/g, '/'))
        if (!whisperFiles.has(name)) return zip.readEntry()
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error(`${name} 압축 해제 실패`))
          pipeline(stream, createWriteStream(join(whisperDirectory, name)))
            .then(() => zip.readEntry(), reject)
        })
      })
      zip.on('end', resolve)
      zip.on('error', reject)
    })
  })
}

if (!await exists(whisperExecutable)) {
  const zipPath = join(targetDirectory, `whisper-${whisperVersion}.zip`)
  process.stdout.write(`Downloading whisper.cpp ${whisperVersion}...\n`)
  const response = await fetch(whisperUrl, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`whisper.cpp 다운로드 실패: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath))
  await extractWhisper(zipPath)
  await rm(zipPath, { force: true })
}
process.stdout.write(`Synced whisper.cpp ${whisperVersion}: ${whisperExecutable}\n`)

const vadPath = join(whisperDirectory, 'ggml-silero-v6.2.0.bin')
const vadUrl = `https://raw.githubusercontent.com/ggml-org/whisper.cpp/${whisperVersion}/models/for-tests-silero-v6.2.0-ggml.bin`
const vadSha256 = '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'
if (!await exists(vadPath)) {
  process.stdout.write('Downloading Silero VAD model...\n')
  const response = await fetch(vadUrl)
  if (!response.ok || !response.body) throw new Error(`Silero VAD 모델 다운로드 실패: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(vadPath))
}
const actualVadHash = createHash('sha256').update(await readFile(vadPath)).digest('hex')
if (actualVadHash !== vadSha256) throw new Error('Silero VAD 모델 무결성 검사에 실패했습니다.')
process.stdout.write(`Synced Silero VAD: ${vadPath}\n`)
