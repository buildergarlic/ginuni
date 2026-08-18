import { access, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sanitizeHwpxTemplate } from '../src/main/services/hwpx'

const sourceArgument = process.argv[2]
if (!sourceArgument) throw new Error('원본 HWPX 경로를 첫 번째 인수로 입력하세요.')
const sourcePath = resolve(sourceArgument)
const targetPath = resolve(process.argv[3] ?? 'resources/templates/screen-description-template.hwpx')

await access(sourcePath)
await mkdir(dirname(targetPath), { recursive: true })
await sanitizeHwpxTemplate(sourcePath, targetPath)
process.stdout.write(`Sanitized template: ${targetPath}\n`)
