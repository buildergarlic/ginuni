import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { access, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DESCRIPTION_TEXT } from '@shared/constants'
import { formatTimecode, intervalSeconds } from '@shared/timecode'
import type { ScriptRow } from '@shared/types'
import { readZipEntries, writeZipEntries } from './zip'

const SECTION_PATH = 'Contents/section0.xml'
const CONTENT_PATH = 'Contents/content.hpf'
const PREVIEW_TEXT_PATH = 'Preview/PrvText.txt'
const PREVIEW_IMAGE_PATH = 'Preview/PrvImage.png'

function directChildren(element: XmlElement, tagName: string): XmlElement[] {
  const result: XmlElement[] = []
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const node = element.childNodes.item(index)
    if (node?.nodeType === 1 && (node as XmlElement).tagName === tagName) result.push(node as XmlElement)
  }
  return result
}

function firstElement(root: XmlDocument | XmlElement, tagName: string): XmlElement {
  const element = root.getElementsByTagName(tagName).item(0)
  if (!element) throw new Error(`HWPX 템플릿에 ${tagName} 요소가 없습니다.`)
  return element
}

function setCellText(cell: XmlElement, value: string): void {
  const textNodes = cell.getElementsByTagName('hp:t')
  if (textNodes.length === 0) throw new Error('HWPX 표 셀에 텍스트 요소가 없습니다.')
  const firstText = textNodes.item(0)!
  while (firstText.firstChild) firstText.removeChild(firstText.firstChild)
  const lines = value.split(/\r?\n/)
  lines.forEach((line, index) => {
    firstText.appendChild(firstText.ownerDocument!.createTextNode(line))
    if (index < lines.length - 1) firstText.appendChild(firstText.ownerDocument!.createElement('hp:lineBreak'))
  })
  for (let index = 1; index < textNodes.length; index += 1) textNodes.item(index)!.textContent = ''
}

function removeLayoutCaches(document: XmlDocument): void {
  const caches = document.getElementsByTagName('hp:linesegarray')
  const nodes: XmlElement[] = []
  for (let index = 0; index < caches.length; index += 1) {
    const cache = caches.item(index)
    if (cache) nodes.push(cache)
  }
  nodes.forEach((cache) => cache.parentNode?.removeChild(cache))
}

function estimateDialogueHeight(content: string): number {
  let units = 0
  let lines = 1
  for (const character of content) {
    if (character === '\n') {
      lines += 1
      units = 0
      continue
    }
    units += /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(character) ? 1 : 0.58
    if (units >= 38) {
      lines += 1
      units = 0
    }
  }
  return 2469 + Math.max(0, lines - 1) * 1903
}

function setRowGeometry(row: XmlElement, rowIndex: number, height: number): void {
  const cells = directChildren(row, 'hp:tc')
  cells.forEach((cell) => {
    const address = firstElement(cell, 'hp:cellAddr')
    address.setAttribute('rowAddr', String(rowIndex))
    const size = firstElement(cell, 'hp:cellSz')
    size.setAttribute('height', String(height))
  })
}

function rowValues(row: ScriptRow): string[] {
  return [
    row.kind === 'dialogue' ? '대사' : '해설',
    formatTimecode(row.startMs),
    formatTimecode(row.endMs),
    String(intervalSeconds(row.startMs, row.endMs)),
    row.kind === 'descriptionGap' ? DESCRIPTION_TEXT : row.content
  ]
}

function updateSection(sectionXml: string, title: string, rows: ScriptRow[]): string {
  const document = new DOMParser().parseFromString(sectionXml, 'application/xml')
  const parseError = document.getElementsByTagName('parsererror').item(0)
  if (parseError) throw new Error('HWPX 본문 XML을 읽을 수 없습니다.')

  firstElement(document, 'hp:t').textContent = `화면해설대본 - ${title}`
  const table = firstElement(document, 'hp:tbl')
  const originalRows = directChildren(table, 'hp:tr')
  if (originalRows.length < 3) throw new Error('HWPX 템플릿 표에는 머리글·해설·대사 기본 행이 필요합니다.')
  const headerTemplate = originalRows[0]
  const gapTemplate = originalRows[1]
  const dialogueTemplate = originalRows[2]

  originalRows.forEach((row) => table.removeChild(row))
  const header = headerTemplate.cloneNode(true) as XmlElement
  setRowGeometry(header, 0, 2469)
  table.appendChild(header)

  let totalHeight = 2469
  rows.forEach((scriptRow, index) => {
    const row = (scriptRow.kind === 'dialogue' ? dialogueTemplate : gapTemplate).cloneNode(true) as XmlElement
    const values = rowValues(scriptRow)
    const cells = directChildren(row, 'hp:tc')
    if (cells.length !== 5) throw new Error('HWPX 표의 열 개수가 5개가 아닙니다.')
    cells.forEach((cell, cellIndex) => setCellText(cell, values[cellIndex]))
    const height = scriptRow.kind === 'dialogue' ? estimateDialogueHeight(values[4]) : 2753
    setRowGeometry(row, index + 1, height)
    totalHeight += height
    table.appendChild(row)
  })

  table.setAttribute('rowCnt', String(rows.length + 1))
  const tableSize = directChildren(table, 'hp:sz')[0]
  if (tableSize) tableSize.setAttribute('height', String(totalHeight))
  removeLayoutCaches(document)
  return new XMLSerializer().serializeToString(document)
}

function updateContentMetadata(contentXml: string, title: string): string {
  const document = new DOMParser().parseFromString(contentXml, 'application/xml')
  const titleElement = document.getElementsByTagName('opf:title').item(0)
  if (titleElement) titleElement.textContent = `화면해설대본 - ${title}`
  const metas = document.getElementsByTagName('opf:meta')
  for (let index = 0; index < metas.length; index += 1) {
    const meta = metas.item(index)!
    if (meta.getAttribute('name') === 'ModifiedDate') meta.textContent = new Date().toISOString()
    if (meta.getAttribute('name') === 'creator') meta.textContent = '화면해설 대본 도구'
    if (meta.getAttribute('name') === 'description') meta.textContent = '화면해설 대본 도구에서 생성'
  }
  return new XMLSerializer().serializeToString(document)
}

function previewText(title: string, rows: ScriptRow[]): string {
  const lines = [
    `화면해설대본 - ${title}`,
    '※ [스타일] 해설 부분 스타일 적용 방법 원하는 곳 선택 후 “Ctrl+2”를 누르면 진하게 바뀜',
    '<분류><시작><종료><간격><화자/내용>'
  ]
  for (const row of rows) {
    const values = rowValues(row)
    lines.push(values.map((value) => `<${value}>`).join(''))
  }
  return lines.join('\r\n')
}

async function outputExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export function safeFileName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim()
  return clean.slice(0, 120) || '새 프로젝트'
}

export async function nextVersionedHwpxPath(outputDirectory: string, title: string): Promise<string> {
  await mkdir(outputDirectory, { recursive: true })
  const base = `${safeFileName(title)}_화면해설대본`
  for (let version = 1; version <= 999; version += 1) {
    const filePath = join(outputDirectory, `${base}_V${String(version).padStart(2, '0')}.hwpx`)
    if (!(await outputExists(filePath))) return filePath
  }
  throw new Error('내보내기 버전 번호가 999를 초과했습니다.')
}

export async function buildHwpx(options: {
  templatePath: string
  outputPath: string
  title: string
  rows: ScriptRow[]
}): Promise<void> {
  const entries = await readZipEntries(options.templatePath)
  const section = entries.get(SECTION_PATH)?.toString('utf8')
  const content = entries.get(CONTENT_PATH)?.toString('utf8')
  if (!section || !content) throw new Error('HWPX 템플릿 핵심 XML이 없습니다.')

  entries.set(SECTION_PATH, Buffer.from(updateSection(section, options.title, options.rows), 'utf8'))
  entries.set(CONTENT_PATH, Buffer.from(updateContentMetadata(content, options.title), 'utf8'))
  entries.set(PREVIEW_TEXT_PATH, Buffer.from(previewText(options.title, options.rows), 'utf8'))
  entries.delete(PREVIEW_IMAGE_PATH)
  entries.set('mimetype', Buffer.from('application/hwp+zip', 'utf8'))
  await writeZipEntries(options.outputPath, entries)
}

export async function sanitizeHwpxTemplate(sourcePath: string, targetPath: string): Promise<void> {
  const placeholderRows: ScriptRow[] = [
    {
      id: 'template-gap',
      kind: 'descriptionGap',
      startMs: 0,
      endMs: 2_000,
      speakers: [],
      content: DESCRIPTION_TEXT,
      sourceSegmentIds: [],
      reviewed: false
    },
    {
      id: 'template-dialogue',
      kind: 'dialogue',
      startMs: 2_000,
      endMs: 4_000,
      speakers: ['화자1'],
      content: '[화자1] [화자1] 대사',
      sourceSegmentIds: [],
      reviewed: false
    }
  ]
  await buildHwpx({ templatePath: sourcePath, outputPath: targetPath, title: '새 프로젝트', rows: placeholderRows })
}

export function templateName(filePath: string): string {
  return basename(filePath)
}
