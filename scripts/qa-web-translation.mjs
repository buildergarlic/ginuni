import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

// Actual browser + actual downloaded translation model. No worker, network, or model mocks.
const { chromium } = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
// Use an isolated context as in the existing web QA; reused Edge profiles can
// retain broken download state across runs. Model caching still works within this run.
const browser = await chromium.launch({ channel: process.env.GINUNI_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true })
const page = await context.newPage()
const errors = [], failedResponses = [], uploads = [], checks = []
const modelRequests = new Set()
const started = Date.now()
let activeId, progressTimer, closing = false
const evidence = { startedAt: new Date().toISOString(), checks, errors, failedResponses, uploads }
page.on('pageerror', error => errors.push(error.message))
page.on('crash', () => { evidence.browserPageCrashedAt = new Date().toISOString() })
context.on('close', () => { if (!closing) evidence.browserUnexpectedlyClosedAt = new Date().toISOString() })
page.on('dialog', dialog => dialog.accept())
context.on('request', request => {
  if (!['GET', 'HEAD'].includes(request.method())) uploads.push(`${request.method()} ${request.url()}`)
  if (/m2m100|model_quantized|encoder_model|decoder_model/.test(request.url())) modelRequests.add(request.url().split('?')[0])
})
context.on('response', response => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url().split('?')[0]}`) })
const record = text => { checks.push(text); console.log(text) }
const projects = () => page.evaluate(() => JSON.parse(localStorage.getItem('ginuni-web-projects-v1') || '[]'))
const current = async () => (await projects()).find(project => project.id === activeId)
const originalRows = rows => rows.map(({ id, kind, startMs, endMs, content, speakers, sourceSegmentIds, sourceCueIds }) => ({ id, kind, startMs, endMs, content, speakers, sourceSegmentIds, sourceCueIds }))
const visibleCues = (rows, korean) => rows.filter(row => row.kind === 'dialogue').map(row => ({ startMs: row.startMs, endMs: row.endMs, content: korean && row.translation ? row.translation.content : row.content }))
const chooseRow = id => page.locator(`#row-${id} .row-select`).click()
const switchView = async korean => {
  await page.getByRole('button', { name: korean ? '한국어 보기' : '원문 보기', exact: true }).click()
  await page.waitForFunction(({ id, language }) => JSON.parse(localStorage.getItem('ginuni-web-projects-v1')).find(item => item.id === id)?.dialogueLanguage === language, { id: activeId, language: korean ? 'korean' : 'original' })
}
async function translate() {
  const began = Date.now()
  await page.getByRole('button', { name: /^한국어로 (다시 )?번역$/ }).click()
  await page.waitForFunction(id => {
    if (document.querySelector('[role="alert"]')) return true
    const project = JSON.parse(localStorage.getItem('ginuni-web-projects-v1') || '[]').find(item => item.id === id)
    return project?.dialogueLanguage === 'korean' && project.rows.filter(row => row.kind === 'dialogue' && row.content.trim()).every(row => row.translation?.content.trim()) && !document.querySelector('.analysis-progress')
  }, activeId, { timeout: 600000, polling: 1000 })
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  return (Date.now() - began) / 1000
}
async function assertCaptions(expected, language) {
  await page.waitForFunction(({ expected, language }) => {
    const track = document.querySelector('video')?.textTracks[0]
    if (!track || track.language !== language || track.cues?.length !== expected.length) return false
    return [...track.cues].every((cue, index) => cue.getCueAsHTML().textContent === expected[index].content && Math.round(cue.startTime * 1000) === expected[index].startMs && Math.round(cue.endTime * 1000) === expected[index].endMs)
  }, { expected, language })
  assert.deepEqual(await page.locator('video').evaluate(video => [...video.textTracks[0].cues].map(cue => ({ startMs: Math.round(cue.startTime * 1000), endMs: Math.round(cue.endTime * 1000), content: cue.getCueAsHTML().textContent }))), expected)
}
async function download(button, extension, basename) {
  if ((await page.locator('.export-menu').getAttribute('open')) === null) await page.locator('.export-menu summary').click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: false }).click()
  const file = await pending
  assert.ok(file.suggestedFilename().endsWith(extension))
  const path = resolve(output, `${basename}${extension}`)
  await file.saveAs(path)
  if ((await page.locator('.export-menu').getAttribute('open')) !== null) await page.locator('.export-menu summary').click()
  return path
}
async function restoreFixture(project, name) {
  await page.getByRole('button', { name: '작업 목록으로', exact: true }).click()
  const ids = (await projects()).map(item => item.id)
  await page.getByLabel('JSON 백업 파일', { exact: true }).setInputFiles({
    name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project))
  })
  await page.getByRole('status').filter({ hasText: '복원했습니다' }).waitFor()
  const restored = (await projects()).find(item => !ids.includes(item.id))
  assert.ok(restored)
  activeId = restored.id
  return restored
}
function parseSrt(text) {
  const ms = value => { const [h, m, s, fraction] = value.split(/[:,]/).map(Number); return h * 3600000 + m * 60000 + s * 1000 + fraction }
  return text.trim().split(/\r?\n\s*\r?\n/).map(block => {
    const [, time, ...lines] = block.split(/\r?\n/)
    const [start, end] = time.split(' --> ')
    return { startMs: ms(start), endMs: ms(end), content: lines.join('\n') }
  })
}
function clock(ms) {
  const seconds = Math.floor(ms / 1000), fraction = ms % 1000
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(3, '0')}` : ''}`
}
async function assertExports(project, korean, basename) {
  const expected = visibleCues(project.rows, korean)
  assert.deepEqual(parseSrt(await readFile(await download('SRT 자막', '.srt', basename), 'utf8')), expected)
  const files = unzipSync(new Uint8Array(await readFile(await download('HWPX 한글 대본', '.hwpx', basename))))
  assert.equal(strFromU8(files.mimetype), 'application/hwp+zip')
  const document = new DOMParser().parseFromString(strFromU8(files['Contents/section0.xml']), 'text/xml')
  const table = document.getElementsByTagName('hp:tbl')[0]
  const actualRows = [...table.childNodes].filter(node => node.nodeName === 'hp:tr').slice(1)
  assert.equal(actualRows.length, project.rows.length)
  actualRows.forEach((row, index) => {
    const cells = [...row.childNodes].filter(node => node.nodeName === 'hp:tc')
    const text = cells.map(cell => [...cell.getElementsByTagName('hp:t')].map(node => node.textContent).join(''))
    const source = project.rows[index]
    assert.equal(text[1], clock(source.startMs))
    assert.equal(text[2], clock(source.endMs))
    assert.equal(text[4], korean && source.kind === 'dialogue' && source.translation ? source.translation.content : source.content)
  })
}

try {
  await page.goto(process.env.GINUNI_WEB_URL || 'http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.removeItem('ginuni-web-projects-v1'))
  await page.reload({ waitUntil: 'networkidle' })
  evidence.url = page.url()
  await page.getByRole('button', { name: '샘플로 바로 체험하기', exact: false }).click()
  activeId = (await projects())[0].id
  let source = await current()
  assert.equal(source.sampleId, 'shy-guy-1947')
  assert.equal(source.rows.filter(row => row.kind === 'dialogue').length, 21)
  await page.getByRole('button', { name: '확인 완료 · 다음 →', exact: true }).click()
  source = await current()
  assert.equal(source.rows[0].reviewed, true)
  const sourceSnapshot = structuredClone(source.rows)
  await page.getByRole('button', { name: '한국어로 번역', exact: true }).click()
  await page.getByRole('button', { name: '번역 취소', exact: true }).click()
  await page.locator('.analysis-progress').waitFor({ state: 'detached' })
  assert.deepEqual((await current()).rows, sourceSnapshot)
  record('Immediate cancellation preserves all source rows and existing approval.')
  progressTimer = setInterval(async () => { try { console.log(await page.locator('.analysis-progress strong').innerText({ timeout: 500 })) } catch {} }, 20000)
  evidence.translationSeconds = await translate()
  const translated = await current()
  evidence.translatedProject = translated
  assert.deepEqual(originalRows(translated.rows), originalRows(sourceSnapshot))
  assert.deepEqual(translated.rows.map(row => row.reviewed), sourceSnapshot.map(row => row.reviewed))
  assert.ok(translated.rows.every(row => row.translation?.sourceContent === row.content && row.translation.content === row.translation.draft && !row.translation.reviewed))
  assert.ok(translated.rows.filter(row => /[가-힣]/.test(row.translation.content)).length >= Math.ceil(translated.rows.length * 0.85), 'At least 85% of the actual model outputs must contain Korean, not copied English.')
  evidence.cachedModelUrls = await page.evaluate(async () => {
    const urls = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) {
      if (/m2m100/.test(request.url)) urls.push(request.url)
    }
    return urls
  })
  assert.ok(modelRequests.size > 0 || evidence.cachedModelUrls.length > 0, 'The run must use the actual downloaded translation model, including its browser cache on repeat runs.')
  await assertCaptions(visibleCues(translated.rows, true), 'ko')
  record('Real model translated 21 English dialogue rows while preserving source IDs, text, times, kinds, speakers and review; Korean native captions match every millisecond.')
  await writeFile(resolve(output, 'web-translation-inference.json'), JSON.stringify({
    ...evidence, modelRequests: [...modelRequests], inferenceCompletedAt: new Date().toISOString()
  }, null, 2))

  const first = translated.rows[0], second = translated.rows[1]
  await chooseRow(first.id)
  assert.ok(!(await page.locator(`#row-${first.id}`).getAttribute('class')).includes('reviewed'))
  await switchView(false)
  assert.ok((await page.locator(`#row-${first.id}`).getAttribute('class')).includes('reviewed'))
  assert.equal(await page.getByRole('textbox', { name: '대사 내용', exact: true }).inputValue(), first.content)
  await assertCaptions(visibleCues(translated.rows, false), 'en')
  await switchView(true)
  const editedKorean = '첫 번째 대사의 한국어 번역을 검수용으로 수정했습니다.'
  await page.getByRole('textbox', { name: '한국어 대사 내용', exact: true }).fill(editedKorean)
  let edited = await current()
  assert.equal(edited.rows[0].content, first.content)
  assert.equal(edited.rows[0].translation.content, editedKorean)
  assert.equal(edited.rows[0].translation.draft, first.translation.draft)
  assert.equal(edited.rows[0].reviewed, true)
  assert.equal(edited.rows[0].translation.reviewed, false)
  await chooseRow(second.id)
  await page.getByRole('button', { name: '확인 완료 · 다음 →', exact: true }).click()
  edited = await current()
  assert.equal(edited.rows[1].reviewed, false)
  assert.equal(edited.rows[1].translation.reviewed, true)
  await switchView(false)
  assert.ok(!(await page.locator(`#row-${second.id}`).getAttribute('class')).includes('reviewed'))
  await assertExports(await current(), false, 'web-translation-original')
  await switchView(true)
  await assertExports(await current(), true, 'web-translation-korean')
  record('Korean editing and approval stay separate from the source; both SRT and HWPX export the selected language with original timestamps.')

  await chooseRow(first.id)
  const beforeRestore = (await current()).rows
  await page.getByRole('button', { name: '이 대사 처음 번역으로 복원', exact: true }).click()
  assert.equal((await current()).rows[0].translation.content, first.translation.draft)
  await page.getByRole('button', { name: '↶ 되돌리기', exact: true }).click()
  assert.deepEqual((await current()).rows, beforeRestore)
  const backupPath = await download('JSON 작업 백업', '.json', 'web-translation-backup')
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  assert.deepEqual(backup.rows, beforeRestore)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.project-open').filter({ hasText: 'Shy Guy (1947)' }).click()
  assert.deepEqual((await current()).rows, backup.rows)
  assert.equal((await current()).dialogueLanguage, 'korean')
  const idsBeforeRestore = (await projects()).map(project => project.id)
  await page.getByRole('button', { name: '작업 목록으로', exact: true }).click()
  await page.getByLabel('JSON 백업 파일', { exact: true }).setInputFiles(backupPath)
  await page.getByRole('status').filter({ hasText: '복원했습니다' }).waitFor()
  const restored = (await projects()).find(project => !idsBeforeRestore.includes(project.id))
  assert.ok(restored)
  activeId = restored.id
  assert.deepEqual(restored.rows, backup.rows)
  assert.equal(restored.dialogueLanguage, 'korean')
  evidence.restoredProject = restored
  record('Per-row draft restore, undo, browser reopen and new-project JSON restore preserve both texts and their review states.')
  await page.screenshot({ path: resolve(output, 'web-translation-result.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390px translation workspace must not overflow horizontally.')
  await page.screenshot({ path: resolve(output, 'web-translation-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1040 })
  record('390px translated workspace has no horizontal overflow.')

  await switchView(false)
  await chooseRow(first.id)
  await page.getByRole('textbox', { name: '대사 내용', exact: true }).fill(`${first.content} [source changed]`)
  await switchView(true)
  await page.locator('.translation-warning').waitFor()
  let unexpectedDownload = false
  const catchDownload = () => { unexpectedDownload = true }
  page.on('download', catchDownload)
  if ((await page.locator('.export-menu').getAttribute('open')) === null) await page.locator('.export-menu summary').click()
  await page.getByRole('button', { name: 'SRT 자막', exact: false }).click()
  await page.getByRole('alert').filter({ hasText: '원문이 바뀐 번역' }).waitFor()
  assert.equal(unexpectedDownload, false)
  await page.getByRole('button', { name: '오류 메시지 닫기', exact: true }).click()
  await page.getByRole('button', { name: 'HWPX 한글 대본', exact: false }).click()
  await page.getByRole('alert').filter({ hasText: '원문이 바뀐 번역' }).waitFor()
  assert.equal(unexpectedDownload, false)
  page.off('download', catchDownload)
  assert.equal((await current()).rows[0].translation.sourceContent, first.content)
  assert.equal((await current()).rows[0].translation.content, editedKorean)
  record('Source edits preserve Korean drafts but visibly mark them stale and block Korean SRT/HWPX export.')

  // A separate real Japanese translation checks the multilingual path using the same context/cache.
  await page.getByRole('button', { name: '작업 목록으로', exact: true }).click()
  const idsBeforeJapanese = (await projects()).map(project => project.id)
  await page.getByRole('button', { name: '내 영상으로 시작', exact: true }).click()
  activeId = (await projects()).find(project => !idsBeforeJapanese.includes(project.id)).id
  await page.getByRole('checkbox', { name: '선택할 영상·음성·자막을 사용할 권리가 있습니다.' }).check()
  await page.getByLabel('SRT 자막 파일', { exact: true }).setInputFiles({ name: 'japanese.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,200 --> 00:00:02,500\nこんにちは。今日はいい天気です。\n\n2\n00:00:03,000 --> 00:00:05,000\n学校へ一緒に行きましょう。\n') })
  await page.getByRole('status').filter({ hasText: '자막을 가져왔습니다' }).waitFor()
  await page.getByLabel('번역할 원문 언어', { exact: true }).selectOption('ja')
  const japaneseSource = structuredClone((await current()).rows)
  evidence.japaneseSeconds = await translate()
  const japanese = await current()
  const japaneseDialogue = japanese.rows.filter(row => row.kind === 'dialogue')
  assert.equal(japanese.translationSourceLanguage, 'ja')
  assert.deepEqual(originalRows(japanese.rows), originalRows(japaneseSource))
  assert.ok(japaneseDialogue.every(row => row.translation.sourceContent === row.content && /[가-힣]/.test(row.translation.content)))
  assert.match(japaneseDialogue.map(row => row.translation.content).join(' '), /학교/)
  evidence.japaneseProject = japanese
  record('Actual Japanese SRT → Korean translation also preserves original text/times and produces Korean school dialogue.')

  const staleFixture = structuredClone(backup)
  staleFixture.title = '원문이 변경된 번역 백업'
  staleFixture.rows = [staleFixture.rows[0]]
  staleFixture.rows[0].content += ' [changed before backup]'
  staleFixture.rows[0].translation.reviewed = true
  staleFixture.rows[0].translation.approvedAt = new Date().toISOString()
  await restoreFixture(staleFixture, 'stale-approved-translation')
  await page.locator('.translation-warning').waitFor()
  assert.ok(!(await page.locator(`#row-${first.id}`).getAttribute('class')).includes('reviewed'), 'A stale translation from a backup must never appear approved.')
  record('An approved translation restored from a stale-source backup is displayed as unreviewed.')
  await switchView(false)
  await chooseRow(first.id)
  await page.getByRole('textbox', { name: '대사 내용', exact: true }).fill('')
  await switchView(true)
  for (const name of ['SRT 자막', 'HWPX 한글 대본']) {
    if ((await page.locator('.export-menu').getAttribute('open')) === null) await page.locator('.export-menu summary').click()
    await page.getByRole('button', { name, exact: false }).click()
    await page.getByRole('alert').filter({ hasText: '원문이 바뀐 번역' }).waitFor()
    await page.getByRole('button', { name: '오류 메시지 닫기', exact: true }).click()
  }
  await page.locator('.export-menu summary').click()
  record('Clearing the source text of a stale restored translation still blocks Korean SRT and HWPX export.')

  const manualFixture = structuredClone(backup)
  manualFixture.title = '원문 없이 수동으로 쓴 한국어 대사'
  manualFixture.rows = [{ ...manualFixture.rows[0], content: '', reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined,
    translation: { sourceContent: '', content: '직접 작성한 한국어 대사입니다.', draft: '', reviewed: false } }]
  await restoreFixture(manualFixture, 'manual-korean-only')
  await chooseRow(first.id)
  assert.equal(await page.getByRole('textbox', { name: '한국어 대사 내용', exact: true }).inputValue(), '직접 작성한 한국어 대사입니다.')
  assert.ok(await page.getByRole('button', { name: '처음 번역으로 복원', exact: true }).isDisabled())
  await switchView(false)
  assert.equal(await page.getByRole('textbox', { name: '대사 내용', exact: true }).inputValue(), '')
  await switchView(true)
  assert.equal(await page.getByRole('textbox', { name: '한국어 대사 내용', exact: true }).inputValue(), '직접 작성한 한국어 대사입니다.')
  await assertExports(await current(), true, 'web-translation-manual-korean')
  record('A project containing only manually written Korean keeps both language controls and exports without erasing the manual text.')
  assert.deepEqual(errors, [])
  assert.deepEqual(uploads, [])
  assert.deepEqual(failedResponses, [])
  evidence.passed = true
  console.log('PASS', JSON.stringify({ translationSeconds: evidence.translationSeconds, japaneseSeconds: evidence.japaneseSeconds, checks: checks.length }))
} catch (error) {
  evidence.passed = false
  evidence.failure = error instanceof Error ? error.stack : String(error)
  await page.screenshot({ path: resolve(output, 'web-translation-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  clearInterval(progressTimer)
  evidence.elapsedSeconds = (Date.now() - started) / 1000
  evidence.modelRequests = [...modelRequests]
  await writeFile(resolve(output, 'web-translation-result.json'), JSON.stringify(evidence, null, 2))
  closing = true
  await context.close()
  await browser.close()
}
