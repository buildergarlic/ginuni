import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

const targetDirectory = join(process.cwd(), 'resources', 'bin')
await mkdir(targetDirectory, { recursive: true })

function resolveCommands(command) {
  try {
    const result = execFileSync('where.exe', [command], { encoding: 'utf8' })
    return result.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function commandIncludes(executable, value, args = ['--version']) {
  try {
    return execFileSync(executable, args, { encoding: 'utf8' }).includes(value)
  } catch {
    return false
  }
}

function commandRuns(executable, args = ['--help']) {
  try {
    execFileSync(executable, args, { stdio: 'ignore' })
    return true
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

async function downloadVerified(url, destination, expectedSha256) {
  await rm(destination, { force: true })
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`런타임 자료 다운로드 실패: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
  const actualHash = await fileSha256(destination)
  if (actualHash !== expectedSha256) {
    await rm(destination, { force: true })
    throw new Error(`런타임 자료 무결성 검사에 실패했습니다: ${basename(destination)}`)
  }
}

for (const [command, target] of [['ffmpeg', 'ffmpeg.exe'], ['ffprobe', 'ffprobe.exe']]) {
  const targetPath = join(targetDirectory, target)
  const expectedVersionText = `${command} version`

  if (await exists(targetPath) && commandIncludes(targetPath, expectedVersionText, ['-version'])) {
    process.stdout.write(`Verified ${command}: ${targetPath}\n`)
    continue
  }

  const chocolateyRoot = process.env.ChocolateyInstall ?? 'C:\\ProgramData\\chocolatey'
  const candidates = [
    join(chocolateyRoot, 'lib', 'ffmpeg', 'tools', 'ffmpeg', 'bin', target),
    join(chocolateyRoot, 'lib', 'ffmpeg', 'tools', 'bin', target),
    ...resolveCommands(command)
  ]
  const downloadPath = `${targetPath}.download`
  let synced = false

  await mkdir(dirname(targetPath), { recursive: true })
  for (const source of [...new Set(candidates)]) {
    if (!await exists(source) || source.toLowerCase() === targetPath.toLowerCase()) continue
    await rm(downloadPath, { force: true })
    await copyFile(source, downloadPath)

    // Chocolatey의 bin 경로는 실제 실행 파일이 아니라 상대 경로를 사용하는 shim일 수 있다.
    // 복사본 자체를 실행해 검증해야 설치본에 깨진 shim이 포함되지 않는다.
    if (!commandIncludes(downloadPath, expectedVersionText, ['-version'])) {
      await rm(downloadPath, { force: true })
      continue
    }

    await rm(targetPath, { force: true })
    await rename(downloadPath, targetPath)
    synced = true
    break
  }

  if (!synced || !commandIncludes(targetPath, expectedVersionText, ['-version'])) {
    throw new Error(`${command}의 독립 실행 가능한 바이너리를 찾을 수 없습니다.`)
  }
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

const sherpaVersion = 'v1.13.6'
const sherpaArchiveName = `sherpa-onnx-${sherpaVersion}-win-x64-shared-MD-MinSizeRel-no-tts.tar.bz2`
const sherpaArchiveUrl = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${sherpaVersion}/${sherpaArchiveName}`
const sherpaArchiveSha256 = 'bcb399a65cc3564d6001ffa8b9c0197beed1dcdac1c85f93ea75cb53856e1126'
const sherpaDirectory = join(targetDirectory, 'sherpa')
const sherpaModelDirectory = join(sherpaDirectory, 'models')
const sherpaFiles = [
  { name: 'sherpa-onnx-offline-speaker-diarization.exe', bytes: 286_208, sha256: 'd28626cb761e9c55917378ececebb9200068b502557877d88b6ce3fb715894bd' },
  { name: 'onnxruntime.dll', bytes: 13_860_352, sha256: '0b086b0dae785d85e2ef16d1db196852cfdfd5b0f01baa0b538b7111a375b1c0' },
  { name: 'onnxruntime_providers_shared.dll', bytes: 10_752, sha256: 'fda8cda01281a25f8472f1b77ff0ee42f292edd7b5840dc720f43019811a0db7' }
]

async function verifiedRuntimeFiles() {
  for (const file of sherpaFiles) {
    const path = join(sherpaDirectory, file.name)
    if (!await exists(path)) return false
    const details = await stat(path)
    if (details.size !== file.bytes || await fileSha256(path) !== file.sha256) return false
  }
  return true
}

if (!await verifiedRuntimeFiles()) {
  const archivePath = join(targetDirectory, `${sherpaArchiveName}.download`)
  const stagingDirectory = join(targetDirectory, '.sherpa-runtime-staging')
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })
  await downloadVerified(sherpaArchiveUrl, archivePath, sherpaArchiveSha256)
  execFileSync('tar.exe', ['-xjf', archivePath, '-C', stagingDirectory])
  const extractedBin = join(stagingDirectory, sherpaArchiveName.replace(/\.tar\.bz2$/, ''), 'bin')
  await mkdir(sherpaDirectory, { recursive: true })
  for (const file of sherpaFiles) {
    const source = join(extractedBin, file.name)
    const details = await stat(source)
    if (details.size !== file.bytes || await fileSha256(source) !== file.sha256) throw new Error(`sherpa-onnx 파일 검증 실패: ${file.name}`)
    await copyFile(source, join(sherpaDirectory, file.name))
  }
  await rm(archivePath, { force: true })
  await rm(stagingDirectory, { recursive: true, force: true })
}
// sherpa-onnx CLI는 정상적인 --help 내용도 stderr로 출력한다. 문자열이 stdout에
// 있는지보다 프로세스가 성공 종료하는지를 검사해야 패키지 동기화가 오판하지 않는다.
if (!await verifiedRuntimeFiles() || !commandRuns(join(sherpaDirectory, sherpaFiles[0].name), ['--help'])) {
  throw new Error(`sherpa-onnx ${sherpaVersion} 실행 파일 검증에 실패했습니다.`)
}
process.stdout.write(`Synced sherpa-onnx ${sherpaVersion}: ${sherpaDirectory}\n`)

const segmentationArchiveUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
const segmentationArchiveSha256 = '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488'
const segmentationTarget = join(sherpaModelDirectory, 'pyannote-segmentation-3.0.int8.onnx')
const segmentationBytes = 1_540_506
const segmentationSha256 = 'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d'

await mkdir(sherpaModelDirectory, { recursive: true })
let segmentationValid = false
if (await exists(segmentationTarget)) {
  const details = await stat(segmentationTarget)
  segmentationValid = details.size === segmentationBytes && await fileSha256(segmentationTarget) === segmentationSha256
}
if (!segmentationValid) {
  const archivePath = join(targetDirectory, 'pyannote-segmentation-3.0.tar.bz2.download')
  const stagingDirectory = join(targetDirectory, '.sherpa-model-staging')
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })
  await downloadVerified(segmentationArchiveUrl, archivePath, segmentationArchiveSha256)
  execFileSync('tar.exe', ['-xjf', archivePath, '-C', stagingDirectory])
  const source = join(stagingDirectory, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.int8.onnx')
  const details = await stat(source)
  if (details.size !== segmentationBytes || await fileSha256(source) !== segmentationSha256) throw new Error('Pyannote 화자 분리 모델 검증에 실패했습니다.')
  await copyFile(source, segmentationTarget)
  await rm(archivePath, { force: true })
  await rm(stagingDirectory, { recursive: true, force: true })
}

const embeddingUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'
const embeddingTarget = join(sherpaModelDirectory, '3dspeaker-eres2net-base-16k.onnx')
const embeddingBytes = 39_593_761
const embeddingSha256 = '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b'
let embeddingValid = false
if (await exists(embeddingTarget)) {
  const details = await stat(embeddingTarget)
  embeddingValid = details.size === embeddingBytes && await fileSha256(embeddingTarget) === embeddingSha256
}
if (!embeddingValid) {
  const downloadPath = `${embeddingTarget}.download`
  await downloadVerified(embeddingUrl, downloadPath, embeddingSha256)
  const details = await stat(downloadPath)
  if (details.size !== embeddingBytes) throw new Error('3D-Speaker 모델 크기 검증에 실패했습니다.')
  await rm(embeddingTarget, { force: true })
  await rename(downloadPath, embeddingTarget)
}
process.stdout.write(`Synced speaker diarization models: ${sherpaModelDirectory}\n`)
