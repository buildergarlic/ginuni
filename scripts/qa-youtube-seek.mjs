import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

// Exercise the real Electron UI/IPC. Only the external YouTube iframe is replaced
// by a controlled message endpoint; this is not a live YouTube playback test.
const require = createRequire(import.meta.url)
const live = process.argv.includes('--live')
const playwright = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const root = await mkdtemp(join(tmpdir(), 'ginuni-youtube-qa-'))
const projectDir = join(root, 'documents', '화면해설 대본 도구', 'Projects', 'qa')
await mkdir(projectDir, { recursive: true })
await mkdir(join(root, 'user-data'))
const now = new Date().toISOString()
const fixture = {
  schemaVersion: 2, id: 'qa-youtube', title: '유튜브 이동 테스트', createdAt: now, updatedAt: now, status: 'review', transcriptionEngine: 'local',
  localDiarization: { mode: 'none', speakerCount: null },
  source: { kind: 'youtube', uri: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', youtubeVideoId: 'M7lc1UVf-VE', displayName: '합성 iframe 테스트' },
  media: { durationMs: 60000 }, segments: [], runs: [], exports: [],
  rows: [
    { id: 'r1', kind: 'dialogue', startMs: 1250, endMs: 5000, content: '첫 번째 대사', speakers: [], sourceSegmentIds: [], reviewed: false },
    { id: 'r2', kind: 'descriptionGap', startMs: 10500, endMs: 15000, content: '여자가 창문을 연다.', speakers: [], sourceSegmentIds: [], reviewed: false }
  ],
  workflow: { version: 1, revision: 0, consent: { rightsConfirmedAt: now }, events: [], proposals: [] }
}
await writeFile(join(projectDir, 'project.json'), JSON.stringify(fixture), 'utf8')
const iframeHtml = `<!doctype html><html><body>Controlled YouTube boundary<script>
window.qa = { ready: false, currentTime: 0, playerState: 2, commands: [] };
window.report = () => parent.postMessage(JSON.stringify({ event: 'infoDelivery', info: { currentTime: qa.currentTime, playerState: qa.playerState, duration: 60 } }), '*');
window.addEventListener('message', event => {
  let data; try { data = JSON.parse(event.data); } catch { return; }
  if (data.channel !== 'widget' || data.id !== 'screen-description-player') return;
  if (data.event === 'listening' && qa.ready) report();
  if (data.event !== 'command' || !qa.ready) return;
  qa.commands.push(data);
  if (data.func === 'seekTo') { qa.currentTime = data.args[0]; if (qa.playerState !== 2) qa.playerState = 1; }
  if (data.func === 'playVideo') qa.playerState = 1;
  if (data.func === 'pauseVideo') qa.playerState = 2;
  report();
});
</script></body></html>`
const environment = { ...process.env, GINUNI_QA_ROOT: root, OPENAI_API_KEY: '' }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
let application
let qaPage
const checks = []
try {
  application = await playwright._electron.launch({ executablePath: require('electron'), args: [resolve('scripts/qa/workflow-boot.cjs')], cwd: process.cwd(), env: environment, timeout: 30000 })
  const page = await application.firstWindow()
  qaPage = page
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(10000)
  if (live) await page.addInitScript(() => {
    window.qaPlayerMessages = []
    window.addEventListener('message', event => {
      if (window.qaPlayerMessages.length < 30) window.qaPlayerMessages.push({ origin: event.origin, data: typeof event.data === 'string' ? event.data.slice(0, 1400) : event.data })
    })
  })
  if (!live) await page.route(/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: iframeHtml }))
  await page.getByRole('button', { name: /유튜브 이동 테스트/ }).click()
  await page.locator('iframe').waitFor()
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame()
  assert.ok(frame)
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) { if (await predicate()) return; await delay(50) }
    throw new Error(message)
  }
  if (live) {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    await frame.waitForURL(/\/embed\//, { timeout: 20000 })
    await frame.waitForLoadState('domcontentloaded')
    console.log('Live YouTube frame:', (await frame.locator('body').innerText()).slice(0, 1600))
    console.log('Live player controls:', await frame.locator('body').ariaSnapshot())
    const play = frame.getByRole('button', { name: /^(동영상 재생|Play|Play video|재생)( \(k\))?$/ }).first()
    await play.click({ timeout: 20000 })
    await waitFor(() => frame.evaluate(() => { const video = document.querySelector('video'); return !!video && video.currentTime > 0 && !video.paused }), 'Live YouTube did not start playback')
    await frame.evaluate(() => document.querySelector('video').pause())
    await waitFor(async () => (await page.locator('.playhead-card').innerText()).includes('00:'), 'Live player clock missing')
    await delay(600)
    await page.getByText('여자가 창문을 연다.', { exact: true }).click()
    await waitFor(() => frame.evaluate(() => { const video = document.querySelector('video'); return video.paused && Math.abs(video.currentTime - 10.5) < 1.2 }), 'Live description selection failed to seek while paused')
    const editor = page.getByRole('textbox', { name: '선택한 행 대본 내용' })
    await editor.fill('실제 유튜브 재생 위치 확인용 합성 해설')
    await frame.evaluate(() => { document.querySelector('video').currentTime = 30 })
    await waitFor(async () => (await page.locator('.playhead-card').innerText()).includes('00:30'), 'Live YouTube clock did not reach 30 seconds')
    await editor.click()
    await waitFor(() => frame.evaluate(() => { const video = document.querySelector('video'); return video.paused && Math.abs(video.currentTime - 10.5) < 1.2 }), 'Live active editor click failed to seek while paused')
    assert.equal(await editor.inputValue(), '실제 유튜브 재생 위치 확인용 합성 해설')
    await page.getByText('첫 번째 대사', { exact: true }).click()
    await waitFor(() => frame.evaluate(() => { const video = document.querySelector('video'); return video.paused && Math.abs(video.currentTime - 1.25) < 0.8 }), 'Live dialogue selection failed to seek while paused')
    await editor.fill('실제 유튜브 재생 위치 확인용 합성 대사')
    await frame.evaluate(() => { document.querySelector('video').currentTime = 30 })
    await waitFor(async () => (await page.locator('.playhead-card').innerText()).includes('00:30'), 'Live dialogue clock did not reach 30 seconds')
    await editor.click()
    await waitFor(() => frame.evaluate(() => { const video = document.querySelector('video'); return video.paused && Math.abs(video.currentTime - 1.25) < 0.8 }), 'Live active dialogue editor failed to seek while paused')
    assert.equal(await editor.inputValue(), '실제 유튜브 재생 위치 확인용 합성 대사')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: 4, checks: ['live YouTube description selection seeks while paused', 'live active description editor seeks and preserves draft', 'live dialogue selection seeks while paused', 'live active dialogue editor seeks and preserves draft'], externalYouTube: 'public IFrame API example M7lc1UVf-VE, no download or AI request' }, null, 2))
  } else {
  await frame.waitForFunction(() => !!window.qa)
  const state = () => frame.evaluate(() => window.qa)
  const editor = page.getByRole('textbox', { name: '선택한 행 대본 내용' })
  await page.getByText('여자가 창문을 연다.', { exact: true }).click()
  await frame.evaluate(() => { qa.ready = true; parent.postMessage(JSON.stringify({ event: 'onReady' }), '*'); report() })
  await waitFor(async () => (await state()).commands.some(command => command.func === 'seekTo' && command.args[0] === 10.5), 'Latest pre-ready row selection was not delivered')
  checks.push('selection before iframe readiness seeks to the latest description row')
  await editor.fill('작성 중인 해설을 지우지 않는다.')
  await frame.evaluate(() => { qa.currentTime = 30; qa.commands = []; report() })
  await waitFor(async () => (await page.locator('.playhead-card').innerText()).includes('00:30'), 'Player clock did not synchronize')
  await editor.click()
  await waitFor(async () => (await state()).commands.some(command => command.func === 'seekTo' && command.args[0] === 10.5), 'Clicking the active description editor did not seek to its start')
  assert.equal(await editor.inputValue(), '작성 중인 해설을 지우지 않는다.')
  assert.equal((await state()).playerState, 2)
  checks.push('active description editor click seeks without losing text or starting paused playback')
  await page.getByText('첫 번째 대사', { exact: true }).click()
  await waitFor(async () => (await state()).currentTime === 1.25, 'Dialogue selection lost fractional start time')
  await editor.fill('작성 중인 대사')
  await frame.evaluate(() => { qa.currentTime = 40; qa.commands = []; report() })
  await waitFor(async () => (await page.locator('.playhead-card').innerText()).includes('00:40'), 'Player clock did not synchronize')
  await editor.click()
  await waitFor(async () => (await state()).commands.some(command => command.func === 'seekTo' && command.args[0] === 1.25), 'Clicking the active dialogue editor did not seek to its start')
  assert.equal(await editor.inputValue(), '작성 중인 대사')
  assert.equal((await state()).playerState, 2)
  checks.push('active dialogue editor click retains fractional seek, paused state and draft')
  await waitFor(async () => (await page.evaluate(() => window.screenScript.loadProject('qa-youtube'))).rows[0].content === '작성 중인 대사', 'Draft was not autosaved')
  checks.push('click-seeking retains focused autosave')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: checks.length, checks, pageErrors: errors, externalYouTube: 'controlled boundary, not live playback' }, null, 2))
  }
} catch (error) {
  console.error(error)
  if (live && qaPage) {
    console.log('Live frame diagnostics:', JSON.stringify(await Promise.all(qaPage.frames().map(async frame => ({ url: frame.url(), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 1000), messages: await frame.evaluate(() => window.qaPlayerMessages).catch(() => []) }))), null, 2))
  }
  process.exitCode = 1
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await application.close().catch(() => {})
  }
  if (!basename(root).startsWith('ginuni-youtube-qa-')) throw new Error('Unexpected QA directory; refusing cleanup')
  await rm(root, { recursive: true, force: true })
}
