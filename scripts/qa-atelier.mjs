import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

// Synthetic fixture + isolated profile only. No writer projects, keys or cloud calls.
// Artifacts are retained under ignored output/playwright for visual review.
const require = createRequire(import.meta.url)
const playwright = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const output = resolve('output/playwright')
const root = join(output, `atelier-qa-${Date.now()}`)
const directory = join(root, 'documents', '화면해설 대본 도구', 'Projects', 'atelier-qa')
const exportsDirectory = join(root, 'exports')
await Promise.all([mkdir(directory, { recursive: true }), mkdir(exportsDirectory, { recursive: true }), mkdir(join(root, 'user-data'), { recursive: true })])
const now = new Date().toISOString()
let mediaPath = process.env.GINUNI_QA_MEDIA ? resolve(process.env.GINUNI_QA_MEDIA) : join(root, 'synthetic.wav')
if (!process.env.GINUNI_QA_MEDIA) {
  const wav = Buffer.alloc(44 + 16000 * 2 * 760)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  await writeFile(mediaPath, wav)
}
const authored = '여자가 파란 대문을 열고 골목으로 나온다.\n잠시 멈춰 서서 길 건너편을 바라본다.'
const sourceSha256 = createHash('sha256').update(await readFile(mediaPath)).digest('hex')
const entries = [
  [78, 84, '대사', '여기서 잠깐 기다려 주세요.'],
  [84, 90, '해설', authored],
  [90, 95, '대사', '어디로 가면 될까요?'],
  [95, 102, '해설', '골목 끝에 있는 작은 카페가 보인다.'],
  [102, 106, '대사', '저기가 맞는 것 같아요.'],
  [106, 112, '해설', '여자가 카페 쪽으로 천천히 걸어간다.'],
  [112, 118, '대사', '좋은 날이네요.'],
  [118, 124, '해설', '카페 앞에 멈춰 서서 간판을 바라본다.'],
  [124, 130, '대사', '문이 열려 있네요.']
]
const rows = entries.map(([start, end, kind, content], i) => ({
  id: `r${i + 1}`, kind: kind === '대사' ? 'dialogue' : 'descriptionGap', startMs: start * 1000, endMs: end * 1000,
  content, speakers: [], sourceSegmentIds: kind === '대사' ? [`s${i + 1}`] : [],
  reviewed: i === 0, reviewStatus: i === 0 ? 'approved' : 'unreviewed', ...(i === 0 ? { approvedAt: now } : {})
}))
const fixture = {
  schemaVersion: 2, id: 'qa-atelier', title: '골목의 오후', createdAt: now, updatedAt: now, status: 'review', transcriptionEngine: 'local',
  localDiarization: { mode: 'none', speakerCount: null },
  source: { kind: 'local', uri: mediaPath, localMediaPath: mediaPath, displayName: '가상 영상 · 디자인 검증용', sha256: sourceSha256 },
  media: { durationMs: 760000 },
  segments: rows.filter(row => row.kind === 'dialogue').map(row => ({ id: row.sourceSegmentIds[0], startMs: row.startMs, endMs: row.endMs, text: row.content, speakerId: '' })),
  rows, runs: [], exports: [], workflow: { version: 1, revision: 0, consent: { rightsConfirmedAt: now }, events: [], proposals: [] }
}
await writeFile(join(directory, 'project.json'), JSON.stringify(fixture), 'utf8')
const env = { ...process.env, GINUNI_QA_ROOT: root, OPENAI_API_KEY: '' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let application
const checks = []
const errors = []
const evidence = []
try {
  application = await playwright._electron.launch({ executablePath: require('electron'), args: [resolve('scripts/qa/workflow-boot.cjs')], env, timeout: 30000 })
  const page = await application.firstWindow()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  const version = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
  await application.evaluate(({ app }, version) => { app.getVersion = () => version }, version)
  await page.reload()
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 1024)
    win.showInactive()
  })
  const minimum = await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { outer: win.getMinimumSize(), frameWidth: win.getSize()[0] - win.getContentSize()[0] }
  })
  assert.ok(minimum.outer[0] - minimum.frameWidth <= 800, `Native minimum content width: ${JSON.stringify(minimum)}`)
  const capture = async name => {
    const path = join(output, `atelier-${name}.png`)
    await page.screenshot({ path })
    evidence.push(path)
  }
  await page.locator('.recent-main').filter({ hasText: '골목의 오후' }).waitFor()
  await capture('home-1440')
  await page.locator('.recent-main').filter({ hasText: '골목의 오후' }).click()
  await page.getByRole('heading', { name: '대본 쓰기', exact: true }).waitFor()
  const persisted = () => page.evaluate(() => window.screenScript.loadProject('qa-atelier'))
  const waitForProject = async predicate => {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const project = await persisted()
      if (predicate(project)) return project
      await delay(80)
    }
    throw new Error('Fixture did not reach expected persisted state')
  }
  const editor = page.getByRole('textbox', { name: '선택한 행 대본 내용', exact: true })
  const confirm = page.getByRole('button', { name: '확인 완료 · 다음', exact: true })
  const tools = page.getByRole('button', { name: '작업 도구', exact: true })
  await page.getByRole('row', { name: '해설 01:24 확인 필요', exact: true }).click()
  await page.locator('video').evaluate(video => { video.pause() })
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.readyState >= 4 && !video.seeking })
  // Chromium's native loading-control fade out can outlast decoded-frame readiness.
  await delay(2000)
  await capture('review-1440')
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).objectFit), 'contain')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  const tableBox = await page.locator('.table-wrap').boundingBox()
  const eighthRow = await page.locator('.script-table tbody tr').nth(7).boundingBox()
  assert.ok(tableBox && eighthRow && eighthRow.y + eighthRow.height <= tableBox.y + tableBox.height + 1, 'Eight normal-size script rows should be visible at 1440px')
  checks.push('selected layout opens with actual data, contained media and no page overflow')

  if (process.argv.includes('--preview')) {
    console.log(JSON.stringify({ preview: true, profile: root, syntheticMedia: mediaPath, note: 'Isolated GiNuNi preview is open. Close its window when finished.' }, null, 2))
    await new Promise(resolve => application.process().once('exit', resolve))
  } else {
  const nextReview = page.getByRole('button', { name: '다음 확인할 행', exact: true })
  for (let step = 0; step < 7; step++) await nextReview.click()
  assert.match(await page.locator('.selected-row').getAttribute('aria-label'), /^대사 02:04/)
  const selectedTextVisible = async () => {
    // Selection reveal runs after the editor sizing animation frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const geometry = await page.locator('.selected-row textarea').evaluate(el => {
    const viewport = document.querySelector('.table-wrap').getBoundingClientRect()
    const header = document.querySelector('.script-table thead th').getBoundingClientRect()
    const footer = document.querySelector('.review-footer').getBoundingClientRect()
    const editor = el.getBoundingClientRect()
    const bottom = Math.min(viewport.bottom, window.innerHeight, footer.top)
    return { visible: editor.top >= Math.max(viewport.top, header.bottom, 0) - 1 && editor.top + Math.min(editor.height, 65) <= bottom + 1, editorTop: editor.top, editorHeight: editor.height, tableTop: viewport.top, tableBottom: viewport.bottom, headerBottom: header.bottom, footerTop: footer.top, scrollY, windowHeight: innerHeight }
    })
    if (!geometry.visible) console.log('Selected text geometry:', JSON.stringify(geometry))
    return geometry.visible
  }
  assert.equal(await selectedTextVisible(), true, 'Next offscreen row must reveal its text below the sticky header')
  await capture('next-offscreen-1440')
  await nextReview.click()
  assert.match(await page.locator('.selected-row').getAttribute('aria-label'), /^해설 01:24/)
  assert.equal(await selectedTextVisible(), true, 'Wraparound must reveal the first remaining row')
  checks.push('next-unreviewed reveals offscreen text and wraparound below the table header')
  const startInput = page.getByRole('textbox', { name: '선택한 행 시작 시간', exact: true })
  await startInput.fill('01:')
  assert.equal(await confirm.isDisabled(), true)
  await page.locator('.inline-error-hint').first().waitFor()
  assert.equal(await startInput.inputValue(), '01:')
  assert.equal((await persisted()).rows[1].reviewStatus, 'unreviewed')
  assert.equal(await editor.inputValue(), authored)
  await startInput.fill('01:24')
  checks.push('invalid focused time blocks confirm and preserves the current segment')

  await editor.fill(`${authored}\n파란 문이 천천히 닫힌다.`)
  await confirm.dblclick()
  await waitForProject(project => project.rows[1].reviewStatus === 'approved' && project.rows[1].content.endsWith('닫힌다.'))
  await page.getByRole('row', { name: '대사 01:30 확인 필요', exact: true }).locator('textarea').waitFor()
  assert.equal(await editor.inputValue(), '어디로 가면 될까요?')
  assert.equal((await persisted()).rows[2].reviewStatus, 'unreviewed')
  assert.equal(await page.locator('video').evaluate(video => video.paused && Math.abs(video.currentTime - 90) < 1), true)
  checks.push('double-click confirm-next approves only focused draft, selects next unapproved row and seeks while paused')

  await tools.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const consent = page.getByRole('checkbox', { name: /교정을 요청할 때/ })
  const consentSummary = page.getByText('사용 권리와 외부 전송 설정', { exact: true })
  if (!(await consent.isVisible())) await consentSummary.click()
  await consent.check()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true)
  await capture('tools-1440')
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), false)
  assert.equal(await tools.evaluate(el => el === document.activeElement), true)
  await tools.click()
  assert.equal(await consent.isChecked(), true)
  assert.equal(Boolean((await persisted()).workflow.consent.cloudCorrectionConsentAt), false)
  await page.keyboard.press('Escape')
  checks.push('tools dialog retains unsaved consent, contains focus, closes with Escape and restores trigger focus')

  await application.evaluate(({ dialog, shell }, directory) => {
    globalThis.qaWarningOptions = []
    dialog.showMessageBox = async (_window, options) => { globalThis.qaWarningOptions.push(options); return { response: 1, checkboxChecked: false } }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    shell.showItemInFolder = () => {}
  }, exportsDirectory)
  const openExport = async () => {
    const button = page.getByRole('button', { name: /^HWPX 내보내기/ })
    if (!(await button.isVisible())) await page.locator('summary').filter({ hasText: '대본 내보내기' }).click()
    await button.waitFor()
  }
  await openExport()
  await capture('export-1440')
  await page.getByRole('button', { name: /^HWPX 내보내기/ }).click()
  await waitForProject(project => project.exports.length === 1)
  await openExport()
  await page.getByRole('button', { name: /^SRT 내보내기/ }).click()
  await waitForProject(project => project.exports.length === 2)
  const srt = await readFile((await persisted()).exports[1].path, 'utf8')
  assert.match(srt, /여기서 잠깐 기다려 주세요/)
  assert.doesNotMatch(srt, /파란 대문/)
  assert.equal((await persisted()).exports.every(item => /^[a-f0-9]{64}$/.test(item.sha256)), true)
  checks.push('new export disclosure uses real HWPX/SRT IPC and preserves different content rules')

  await page.keyboard.press('Escape')
  await page.getByRole('row', { name: '해설 01:24 확인 완료', exact: true }).click()
  await editor.fill(authored)
  await waitForProject(project => project.rows[1].content === authored && project.rows[1].reviewStatus === 'unreviewed')
  await page.locator('video').evaluate(video => { video.currentTime = 110; video.pause() })
  await editor.click()
  assert.equal(await editor.inputValue(), authored)
  assert.equal(await page.locator('video').evaluate(video => video.paused && Math.abs(video.currentTime - 84) < 1), true)
  checks.push('editing reopens approved row; clicking active editor seeks without losing text')

  for (const [width, height] of [[1440, 1024], [1100, 900], [800, 900]]) {
    await application.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [width, height])
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Overflow at ${width}px`)
    await confirm.scrollIntoViewIfNeeded()
    const box = await confirm.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, `Confirm clipped at ${width}px`)
    await page.evaluate(() => window.scrollTo(0, 0))
    const notifications = await page.locator('.toast:visible, .review-notice:visible').all()
    assert.ok(notifications.length > 0, 'Export result should remain available as a visible notification')
    for (const notice of notifications) {
      const notification = await notice.boundingBox()
      assert.ok(notification)
      const actions = await page.locator('.review-footer-actions button').all()
      for (const action of actions) {
        const button = await action.boundingBox()
        assert.ok(!button || notification.x + notification.width <= button.x || button.x + button.width <= notification.x || notification.y + notification.height <= button.y || button.y + button.height <= notification.y, `Notification obscures footer action at ${width}px`)
      }
    }
    await capture(`responsive-${width}`)
  }
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900))
  await startInput.fill('125:43.250')
  assert.equal(await startInput.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Full supported precise time must be visible without horizontal input scrolling')
  await capture('precise-time-1100')
  await startInput.fill('01:24')
  await page.getByRole('slider', { name: '검수 창 글자 크기', exact: true }).focus()
  await page.keyboard.press('End')
  await editor.fill('작가가 직접 확인한 긴 한글 문장입니다. '.repeat(18))
  await waitForProject(project => project.rows[1].content.startsWith('작가가 직접 확인한 긴'))
  assert.equal(await editor.evaluate(el => getComputedStyle(el).fontSize), '28px')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  for (let step = 0; step < 7; step++) await nextReview.click()
  assert.equal(await selectedTextVisible(), true, 'Large-text next row must be readable')
  await nextReview.click()
  assert.equal(await selectedTextVisible(), true, 'Large-text wraparound must reveal the beginning of a tall editor')
  await capture('large-text-1100')
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await capture('high-contrast-1100')
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 900))
  await nextReview.click()
  assert.equal(await selectedTextVisible(), true, 'Compact layout selection must be visible in the window above its sticky footer')
  await capture('next-compact-800')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600))
  await nextReview.click()
  assert.equal(await selectedTextVisible(), true, 'Minimum window selection must reveal readable text above its footer')
  await capture('next-minimum-800x600')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 900))
  for (let step = 0; step < 6; step++) await nextReview.click()
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900))
  checks.push('responsive workspace at 1440/1100/800px, unobscured footer, precise times, 28px script and high contrast')

  // Inject an isolated IPC failure only after other checks. Production services remain unchanged.
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('project:save-rows')
    ipcMain.handle('project:save-rows', () => { throw new Error('테스트 전용 저장 실패') })
  })
  const previous = (await persisted()).rows[1].content
  await editor.fill('저장 실패에도 잃지 않아야 하는 작성 내용')
  await confirm.click()
  await page.getByText(/테스트 전용 저장 실패/).first().waitFor()
  assert.equal(await editor.inputValue(), '저장 실패에도 잃지 않아야 하는 작성 내용')
  assert.equal((await persisted()).rows[1].content, previous)
  assert.equal((await persisted()).rows[1].reviewStatus, 'unreviewed')
  assert.match(await page.locator('.selected-row').getAttribute('aria-label'), /^해설 01:24/)
  checks.push('failed save preserves focused draft and selection; no approval or advance')
  assert.deepEqual(errors, [])
  const report = { passed: checks.length, checks, pageErrors: errors, profile: root, evidence, syntheticMedia: mediaPath }
  await writeFile(join(output, 'atelier-qa-result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  }
} catch (error) {
  if (application) {
    const page = await application.firstWindow()
    await page.screenshot({ path: join(output, 'atelier-failure.png') }).catch(() => {})
    await writeFile(join(output, 'atelier-failure-dom.txt'), await page.locator('body').innerText()).catch(() => {})
  }
  console.error(error)
  console.log(JSON.stringify({ checks, errors, profile: root, evidence }, null, 2))
  process.exitCode = 1
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await application.close().catch(() => {})
  }
}
