import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

// Supply the licensed Sintel 90-second validation clip and its 12-cue reference.
// This script uses isolated project/settings folders and never runs speech services.
const media = process.env.GINUNI_QA_MEDIA
const subtitle = process.env.GINUNI_QA_SRT
if (!media || !subtitle) throw new Error('GINUNI_QA_MEDIA and GINUNI_QA_SRT are required; see docs/SUBTITLE_WORKFLOW.md')
const require = createRequire(import.meta.url)
const playwright = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const root = await mkdtemp(join(tmpdir(), 'ginuni-subtitles-qa-'))
const exportsDirectory = join(root, 'exports')
const screenshots = resolve('output/playwright')
await Promise.all(['documents', 'user-data', 'exports'].map(name => mkdir(join(root, name))))
await mkdir(screenshots, { recursive: true })
const environment = { ...process.env, GINUNI_QA_ROOT: root, OPENAI_API_KEY: '' }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
let application, page, projectId
const checks = [], errors = []
const record = message => { checks.push(message); console.log(message) }
try {
  application = await playwright._electron.launch({ executablePath: require('electron'), args: [resolve('scripts/qa/workflow-boot.cjs')], cwd: process.cwd(), env: environment, timeout: 30000 })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await application.evaluate(({ dialog, shell }, paths) => {
    globalThis.qaSubtitlePath = paths.subtitle
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? paths.exportsDirectory : options.filters?.[0]?.extensions?.[0] === 'srt' ? globalThis.qaSubtitlePath : paths.media] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    shell.showItemInFolder = () => {}
  }, { media, subtitle, exportsDirectory })
  const persisted = () => page.evaluate(id => window.screenScript.loadProject(id), projectId)
  const waitForProject = async predicate => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const project = await persisted()
      if (predicate(project)) return project
      await delay(100)
    }
    throw new Error('Project did not reach expected state')
  }
  const openTools = () => page.getByRole('button', { name: '작업 도구', exact: true }).click()
  const closeTools = () => page.keyboard.press('Escape')
  const startProject = async (title, manual = false) => {
    await page.getByPlaceholder('비워두면 영상 제목을 사용합니다').fill(title)
    if (manual) await page.getByRole('button', { name: /^대사를 직접 입력/ }).click()
    await page.getByRole('button', { name: /동영상 또는 음성 파일 선택/ }).click()
    await page.getByRole('checkbox', { name: '이 영상·음성을 사용할 권리가 있습니다.' }).check()
    await page.getByRole('button', { name: manual ? '프로젝트 만들고 직접 입력' : '프로젝트 만들고 자막 선택', exact: true }).click()
    await page.getByRole('button', { name: '내 프로젝트', exact: true }).waitFor()
    projectId = await page.evaluate(async title => (await window.screenScript.bootstrap()).projects.find(p => p.title === title)?.id, title)
    assert.ok(projectId)
  }
  await startProject('공개 영상 자막 검증')
  const importer = page.getByRole('dialog', { name: '자막 파일로 시작', exact: true })
  // The new-project route opens the native SRT picker automatically.
  await importer.getByText('전체 12행 중 처음 12행을 표시합니다.', { exact: true }).waitFor()
  assert.equal((await persisted()).rows.length, 0)
  await page.screenshot({ path: join(screenshots, 'subtitle-preview.png'), fullPage: true })
  await importer.getByRole('button', { name: '새 초안 적용', exact: true }).click()
  let project = await waitForProject(p => p.rows.length === 12)
  assert.equal(project.rows[0].startMs, 7250)
  assert.equal(project.rows.at(-1).endMs, 55870)
  assert.ok(project.rows.every(r => r.kind === 'dialogue' && r.sourceCueIds.length === 1))
  assert.equal(project.runs.length, 0)
  assert.equal(project.segments.length, 0)
  assert.equal(project.subtitleWorkspace.cues.length, 12)
  const originalFirst = project.rows[0].content
  const originalSecondStart = project.rows[1].startMs
  record('local video and official Korean SRT create 12 exact-timed rows without speech models or invented gaps')

  await page.getByRole('row', { name: /^대사 00:07\.250/ }).click()
  await page.getByRole('textbox', { name: '선택한 행 대본 내용', exact: true }).fill('검증용으로 수정한 대사')
  await waitForProject(p => p.rows[0].content === '검증용으로 수정한 대사')
  await page.getByRole('button', { name: '확인 완료 · 다음', exact: true }).click()
  await waitForProject(p => p.rows[0].reviewStatus === 'approved')
  await page.getByRole('row', { name: /^대사 00:07\.250/ }).click()
  assert.ok(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - 7.25) < 0.1)
  await openTools()
  await page.getByText('선택한 행의 원문과 출처', { exact: true }).click()
  await page.locator('.source-segment').filter({ hasText: originalFirst }).waitFor()
  await page.getByText('대사 시간 전체 맞추기', { exact: true }).click()
  await page.getByLabel('시간차 (ms)', { exact: true }).fill('150')
  await page.getByRole('button', { name: '대사 시간 이동', exact: true }).click()
  project = await waitForProject(p => p.rows[0].startMs === 7400)
  assert.equal(project.rows[0].reviewStatus, 'unreviewed')
  assert.equal(project.subtitleWorkspace.cues[0].startMs, 7250)
  await page.getByRole('combobox', { name: /^이동할 범위/ }).selectOption('selected')
  await page.getByLabel('시간차 (ms)', { exact: true }).fill('-50')
  await page.getByRole('button', { name: '대사 시간 이동', exact: true }).click()
  await waitForProject(p => p.rows[0].startMs === 7350 && p.rows[1].startMs === originalSecondStart + 150)
  record('edit, approve, seek, source view, all/selected offset and approval invalidation work through real UI')
  await closeTools()
  await page.getByRole('button', { name: '내 프로젝트', exact: true }).click()
  await page.locator('.recent-main').filter({ hasText: '공개 영상 자막 검증' }).click()
  assert.equal((await persisted()).rows[0].content, '검증용으로 수정한 대사')
  record('edited subtitle project saves and reopens')
  for (const format of ['HWPX', 'SRT']) {
    await page.locator('summary').filter({ hasText: '대본 내보내기' }).click()
    await page.getByRole('button', { name: new RegExp(`^${format} 내보내기`) }).click()
    await waitForProject(p => p.exports.some(e => e.format === format.toLowerCase()))
  }
  project = await persisted()
  const exportedSrt = await readFile(project.exports.find(e => e.format === 'srt').path, 'utf8')
  assert.match(exportedSrt, /00:00:07,350 -->/)
  assert.match(exportedSrt, /검증용으로 수정한 대사/)
  assert.ok(project.exports.every(e => e.sourceAssetIds.length === 1 && e.unresolvedSourceCueIds.length === 0))
  record('HWPX and SRT export edited milliseconds and subtitle provenance')
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 31 })
  await page.screenshot({ path: join(screenshots, 'subtitle-review.png'), fullPage: true })

  const invalidSubtitle = join(root, 'invalid-encoding.srt')
  await writeFile(invalidSubtitle, Buffer.from([0xff, 0xff, 0xff]))
  await application.evaluate((_electron, path) => { globalThis.qaSubtitlePath = path }, invalidSubtitle)
  await openTools()
  await page.getByRole('button', { name: '자막 파일로 시작', exact: true }).click()
  await importer.getByRole('button', { name: /SRT 선택 및 미리보기$/ }).click()
  await importer.getByRole('alert').filter({ hasText: /인코딩/ }).waitFor()
  assert.equal((await persisted()).rows[0].content, '검증용으로 수정한 대사')
  await importer.getByRole('button', { name: '자막 가져오기 닫기', exact: true }).click()
  record('decoding errors appear inside the importer and preserve existing edited rows')

  await page.getByRole('button', { name: '내 프로젝트', exact: true }).click()
  await startProject('첫 행 직접 입력 검증', true)
  const composer = page.locator('.manual-row-composer')
  await composer.getByLabel('대사 내용', { exact: true }).fill('시간 없는 대본에서 붙여 넣은 문장')
  await page.getByRole('button', { name: '내 프로젝트', exact: true }).click()
  assert.equal(await composer.isVisible(), true)
  assert.equal((await persisted()).rows.length, 0)
  await composer.getByRole('button', { name: '행 추가', exact: true }).click()
  assert.equal((await persisted()).rows.length, 0)
  await composer.getByLabel(/^시작 시간/).fill('00:00.150')
  await composer.getByLabel(/^종료 시간/).fill('00:00.500')
  await composer.getByRole('button', { name: '행 추가', exact: true }).click()
  project = await waitForProject(p => p.rows.length === 1)
  assert.equal(project.rows[0].startMs, 150)
  assert.equal(project.rows[0].endMs, 500)
  assert.equal(project.runs.length, 0)
  record('manual first row guards missing times and unsaved navigation, then preserves 350ms duration')
  assert.deepEqual(errors, [])
  await writeFile(join(screenshots, 'subtitle-qa-result.json'), JSON.stringify({ passed: checks.length, checks, pageErrors: errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, checks, pageErrors: errors }, null, 2))
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(screenshots, 'subtitle-failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(screenshots, 'subtitle-failure.txt'), await page.locator('body').innerText()).catch(() => {})
  }
  console.error(error)
  process.exitCode = 1
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await application.close().catch(() => {})
  }
  if (!basename(root).startsWith('ginuni-subtitles-qa-')) throw new Error('Unexpected QA directory; refusing cleanup')
  await rm(root, { recursive: true, force: true })
}
