import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import yauzl from 'yauzl'
import yazl from 'yazl'

export async function readZipEntries(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('ZIP 파일을 열 수 없습니다.'))
      const entries = new Map<string, Buffer>()

      zipFile.on('error', reject)
      zipFile.on('end', () => resolve(entries))
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          entries.set(entry.fileName, Buffer.alloc(0))
          zipFile.readEntry()
          return
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('ZIP 항목을 읽을 수 없습니다.'))
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('error', reject)
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zipFile.readEntry()
          })
        })
      })
      zipFile.readEntry()
    })
  })
}

export async function writeZipEntries(filePath: string, entries: Map<string, Buffer>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await new Promise<void>((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    const output = createWriteStream(tempPath)
    output.on('close', resolve)
    output.on('error', reject)
    zipFile.outputStream.on('error', reject)
    zipFile.outputStream.pipe(output)

    const mimetype = entries.get('mimetype') ?? Buffer.from('application/hwp+zip', 'utf8')
    zipFile.addBuffer(mimetype, 'mimetype', { compress: false })
    for (const [name, value] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (name === 'mimetype' || name.endsWith('/')) continue
      zipFile.addBuffer(value, name, { compress: true })
    }
    zipFile.end()
  })
  await rename(tempPath, filePath)
}

export async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

export function streamFile(filePath: string): NodeJS.ReadableStream {
  return createReadStream(filePath)
}
