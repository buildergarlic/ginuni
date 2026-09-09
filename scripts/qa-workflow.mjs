import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const playwright = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const root = await mkdtemp(join(tmpdir(), 'ginuni-workflow-qa-'))
const documents = join(root, 'documents')
const exportsDirectory = join(root, 'exports')
const directory = join(documents, '화면해설 대본 도구', 'Projects', 'qa')
await Promise.all([mkdir(directory, { recursive: true }), mkdir(exportsDirectory), mkdir(join(root, 'user-data'))])
const now = new Date().toISOString()
const segment = (id, startMs, text) => ({ id, startMs, endMs: startMs + 2000, text, speakerId: '' })
const row = (id, startMs, content, sourceSegmentIds, kind = 'dialogue') => ({ id, kind, startMs, endMs: startMs + 2000, speakers: [], content, sourceSegmentIds, reviewed: false, reviewStatus: 'unreviewed' })
const fixture = {
  schemaVersion: 2, id: 'qa-workflow', title: '워크플로우 테스트 자료', createdAt: now, updatedAt: now, status: 'review', transcriptionEngine: 'local',
  localDiarization: { mode: 'none', speakerCount: null }, source: { kind: 'local', uri: join(root, 'synthetic.wav'), localMediaPath: join(root, 'synthetic.wav'), displayName: '합성 무음 테스트', sha256: 'a'.repeat(64) },
  media: { durationMs: 6000 }, segments: [segment('s1', 0, '첫 번째 대사'), segment('s2', 4000, '안녕 하세요')],
  rows: [row('r1', 0, '첫 번째 대사', ['s1']), row('r2', 2000, '※ (사람 목소리 없음) 해설 삽입 권장 구간', [], 'descriptionGap'), row('r3', 4000, '안녕 하세요', ['s2'])],
  runs: [], exports: [], workflow: { version: 1, revision: 0, consent: { rightsConfirmedAt: now }, events: [], proposals: [{ id: 'proposal', rowId: 'r3', before: '안녕 하세요', after: '안녕하세요', reason: '띄어쓰기 제안 (합성 테스트)', status: 'pending', createdAt: now, model: 'synthetic-fixture', promptVersion: 'test', runId: 'qa-proposal' }] }
}
await writeFile(join(directory, 'project.json'), JSON.stringify(fixture), 'utf8')
// Six seconds of generated silence; no user media is read or sent.
const wav = Buffer.alloc(44 + 16000 * 2 * 6)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24)
wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
await writeFile(join(root, 'synthetic.wav'), wav)
const environment = { ...process.env, GINUNI_QA_ROOT: root, OPENAI_API_KEY: '' }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
let application
const checks = []
try {
  application = await playwright._electron.launch({ executablePath: require('electron'), args: [resolve('scripts/qa/workflow-boot.cjs')], cwd: process.cwd(), env: environment, timeout: 30000 })
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  page.setDefaultTimeout(15000)
  await page.locator('.recent-main').filter({ hasText: '워크플로우 테스트 자료' }).click()
  const openTools = async () => {
    if (!(await page.getByRole('dialog').isVisible())) await page.getByRole('button', { name: '작업 도구', exact: true }).click()
  }
  const closeTools = async () => {
    if (await page.getByRole('dialog').isVisible()) await page.keyboard.press('Escape')
  }
  const openExport = async () => {
    if (!(await page.getByRole('button', { name: /^HWPX 내보내기/ }).isVisible())) await page.locator('summary').filter({ hasText: '대본 내보내기' }).click()
  }
  await openTools()
  await page.getByRole('heading', { name: '확인이 필요한 행 3개' }).waitFor()
  console.log('Opened review:', (await page.locator('body').innerText()).slice(0, 250))
  await closeTools()
  await page.getByRole('button', { name: '확인 완료 · 다음', exact: true }).click()
  const persisted = () => page.evaluate(() => window.screenScript.loadProject('qa-workflow'))
  const waitForProject = async (predicate) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const project = await persisted()
      if (predicate(project)) return project
      await delay(100)
    }
    throw new Error('Persisted project did not reach the expected state within 15 seconds')
  }
  await waitForProject((project) => project.rows[0].reviewStatus === 'approved')
  await closeTools()
  checks.push('explicit approval persists')
  console.log(checks.at(-1))
  await page.getByRole('row', { name: '대사 00:00 확인 완료', exact: true }).click()
  await page.getByRole('textbox', { name: '선택한 행 대본 내용' }).fill('작가가 직접 고친 첫 대사')
  await waitForProject((p) => p.rows[0].content === '작가가 직접 고친 첫 대사' && p.rows[0].reviewStatus === 'unreviewed')
  checks.push('editing clears approval and autosaves without leaving the text field')
  console.log(checks.at(-1))
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 4 })
  await page.getByRole('textbox', { name: '선택한 행 대본 내용' }).click()
  assert.equal(await page.getByRole('textbox', { name: '선택한 행 대본 내용' }).inputValue(), '작가가 직접 고친 첫 대사')
  assert.equal(await page.locator('video').evaluate(video => video.paused && video.currentTime < 0.1), true)
  checks.push('active local-video editor click seeks while preserving paused state and draft')
  await page.getByRole('row', { name: '해설 00:02 확인 필요', exact: true }).click()
  await page.getByRole('textbox', { name: '선택한 행 대본 내용' }).fill('문을 열고 여자가 들어온다.')
  await page.getByRole('button', { name: '확인 완료 · 다음', exact: true }).click()
  await waitForProject((p) => p.rows[1].content === '문을 열고 여자가 들어온다.' && p.rows[1].reviewStatus === 'approved')
  await closeTools()
  checks.push('approval flushes unsaved authored description')
  console.log(checks.at(-1))
  await page.getByRole('row', { name: '대사 00:04 확인 필요', exact: true }).click()
  await openTools()
  await page.getByText('선택한 대사 교정 제안 받기 · 선택 사항', { exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '선택한 대사 교정 요청 (유료)', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '제안 적용', exact: true }).click()
  await waitForProject((p) => p.rows[2].content === '안녕하세요')
  assert.equal((await persisted()).segments[1].text, '안녕 하세요')
  checks.push('paid request gated; proposal application preserves source text')
  console.log(checks.at(-1))
  await page.getByText('이전 상태로 복구', { exact: true }).click()
  await page.getByRole('button', { name: '이전 저장 목록 보기', exact: true }).click()
  await page.getByRole('button', { name: '선택한 저장본으로 복구', exact: true }).click()
  await waitForProject((p) => p.rows[2].content === '안녕 하세요')
  assert.equal((await persisted()).rows[1].content, '문을 열고 여자가 들어온다.')
  checks.push('snapshot restores draft without losing previously authored description')
  console.log(checks.at(-1))
  await closeTools()
  await application.evaluate(({ dialog, shell }, directory) => {
    globalThis.qaWarningOptions = []
    dialog.showMessageBox = async (_window, options) => { globalThis.qaWarningOptions.push(options); return { response: 1, checkboxChecked: false } }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    shell.showItemInFolder = () => {}
  }, exportsDirectory)
  await openExport()
  await page.getByRole('button', { name: /^HWPX 내보내기/ }).click()
  await page.locator('.writing-context').getByText(/^HWPX를 저장했습니다:/).waitFor()
  const exported = (await persisted()).exports[0]
  assert.match(exported.sha256, /^[0-9a-f]{64}$/)
  assert.equal((await application.evaluate(() => globalThis.qaWarningOptions[0].defaultId)), 0)
  await openExport()
  await page.getByRole('button', { name: /^SRT 내보내기/ }).click()
  await waitForProject((p) => p.exports.length === 2)
  const srt = await readFile((await persisted()).exports[1].path, 'utf8')
  assert.match(srt, /작가가 직접 고친 첫 대사/)
  assert.doesNotMatch(srt, /문을 열고/)
  checks.push('real IPC exports pass artifact checks and warn before unreviewed save')
  console.log(checks.at(-1))
  await page.getByRole('textbox', { name: '선택한 행 대본 내용' }).fill('내보낸 뒤에도 계속 편집')
  await page.getByRole('textbox', { name: '선택한 행 대본 내용' }).press('Tab')
  await waitForProject((p) => p.rows.some((row) => row.content === '내보낸 뒤에도 계속 편집'))
  checks.push('export revision reload permits subsequent edit')
  await mkdir(resolve('output/playwright'), { recursive: true })
  await page.locator('details').evaluateAll((elements) => { for (const element of elements) element.open = false })
  await page.locator('.media-panel').evaluate((element) => element.scrollTo(0, 0))
  await page.evaluate(() => window.scrollTo(0, 0))
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
  await page.screenshot({ path: resolve('output/playwright/workflow-1440.png'), fullPage: true })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720))
  await page.screenshot({ path: resolve('output/playwright/workflow-1100.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: checks.length, checks, pageErrors: errors }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await application.close().catch(() => {})
  }
  if (!basename(root).startsWith('ginuni-workflow-qa-')) throw new Error('Unexpected QA directory; refusing cleanup')
  await rm(root, { recursive: true, force: true })
}
