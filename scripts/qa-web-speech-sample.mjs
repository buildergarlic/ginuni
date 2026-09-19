import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true })
const page = await context.newPage()
const errors = [], failedResponses = [], uploads = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
context.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) uploads.push(request.method() + ' ' + request.url()) })
context.on('response', response => { if (response.status() >= 400) failedResponses.push(response.status() + ' ' + response.url().split('?')[0]) })
const started = Date.now()
let timer
try {
  await page.goto(process.env.GINUNI_WEB_URL || 'http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '샘플로 바로 체험하기', exact: false }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.ok((await page.locator('video').getAttribute('src')).includes('sample-shy-guy-1947'))
  await page.getByRole('button', { name: '영상 재생', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.4)
  const audio = await page.locator('video').evaluate(video => ({ muted: video.muted, volume: video.volume, decodedBytes: video.webkitAudioDecodedByteCount }))
  assert.equal(audio.muted, false)
  assert.ok(audio.volume > 0 && audio.decodedBytes > 0, 'The real sample must contain decoded audible audio.')
  await page.getByRole('button', { name: '영상 일시 정지', exact: true }).click()
  const analysisStarted = Date.now()
  await page.getByRole('button', { name: '샘플 음성 AI 다시 분석', exact: true }).click()
  timer = setInterval(async () => { try { console.log(await page.locator('.analysis-progress strong').innerText({ timeout: 500 })) } catch {} }, 20000)
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(node => node.textContent.includes('AI 초안을 만들었습니다')) || !!document.querySelector('[role="alert"]'), undefined, { timeout: 300000, polling: 1000 })
  const alerts = await page.getByRole('alert').allTextContents()
  assert.deepEqual(alerts, [])
  const analysisSeconds = (Date.now() - analysisStarted) / 1000
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('ginuni-web-projects-v1'))[0])
  const dialogue = project.rows.filter(row => row.kind === 'dialogue')
  assert.equal(project.source, 'transcription')
  assert.ok(dialogue.length >= 6)
  assert.ok(/school|radio/i.test(dialogue.map(row => row.content).join(' ')), 'Speech must stay in English and concern the actual scene.')
  assert.ok(dialogue.every(row => row.startMs >= 0 && row.endMs > row.startMs && row.endMs <= 60000))
  await page.waitForFunction(count => document.querySelector('video').textTracks[0]?.cues?.length === count, dialogue.length)
  const cues = await page.locator('video').evaluate(video => [...video.textTracks[0].cues].map(cue => ({ startMs: Math.round(cue.startTime * 1000), endMs: Math.round(cue.endTime * 1000), content: cue.text })))
  assert.deepEqual(cues, dialogue.map(({ startMs, endMs, content }) => ({ startMs, endMs, content })))
  const probe = dialogue.find(row => row.endMs - row.startMs >= 1500)
  await page.locator('video').evaluate((video, startMs) => { video.currentTime = (startMs + 100) / 1000 }, probe.startMs)
  await page.waitForFunction(text => [...document.querySelector('video').textTracks[0].activeCues].some(cue => cue.text === text), probe.content)
  await page.locator('.sample-comparison summary').click()
  const comparisonText = await page.locator('.sample-comparison').innerText()
  // Independent source cue: compare identical words and both boundaries, not just
  // whether the app copied its own timestamps into a subtitle track.
  const anchor = dialogue.find(row => row.content.toLowerCase().replace(/[^a-z ]/g, '').trim() === 'this oscillator will do its work well')
  const timingCheck = anchor && {
    text: anchor.content,
    referenceSource: 'Internet Archive ASR (unreviewed, not human ground truth)',
    referenceStartMs: 35610, referenceEndMs: 37640,
    actualStartMs: anchor.startMs, actualEndMs: anchor.endMs,
    startDifferenceMs: anchor.startMs - 35610, endDifferenceMs: anchor.endMs - 37640
  }
  await page.locator(`#row-${probe.id} .row-select`).click()
  await page.getByRole('button', { name: '선택한 대사 구간 재생', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('video').paused)
  const rangeStartMs = await page.locator('video').evaluate(video => Math.round(video.currentTime * 1000))
  await page.waitForFunction(() => document.querySelector('video').paused, undefined, { timeout: 15000 })
  const rangeEndMs = await page.locator('video').evaluate(video => Math.round(video.currentTime * 1000))
  assert.ok(rangeStartMs >= probe.startMs && rangeStartMs < probe.startMs + 500)
  assert.ok(rangeEndMs >= probe.endMs && rangeEndMs < probe.endMs + 500)
  const evidence = { url: page.url(), generatedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000, analysisSeconds, audio, project, cues, timingCheck, selectedRange: { startMs: probe.startMs, endMs: probe.endMs, rangeStartMs, rangeEndMs }, comparisonText, errors, uploads, failedResponses }
  await writeFile(resolve(output, 'web-speech-sample-result.json'), JSON.stringify(evidence, null, 2))
  await page.screenshot({ path: resolve(output, 'web-speech-sample-result.png'), fullPage: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(uploads, [])
  assert.deepEqual(failedResponses, [])
  const transcriptText = dialogue.map(row => row.content).join(' ').toLowerCase()
  for (const word of ['microphone', 'connect', 'school', 'radio', 'different']) assert.ok(transcriptText.includes(word), `Missing actual spoken word: ${word}`)
  assert.ok(dialogue[0].startMs <= 3600, 'The opening conversation must not be omitted.')
  assert.ok(timingCheck, 'Expected independently captioned spoken sentence.')
  assert.ok(Math.abs(timingCheck.startDifferenceMs) <= 1000 && Math.abs(timingCheck.endDifferenceMs) <= 1000, 'Reference sentence boundaries must agree within one second.')
  assert.ok(transcriptText.split(/\s+/).length < 250, 'Reject invented repetitive transcript on this fixed 60-second scene.')
  const frequencies = new Map()
  for (const row of dialogue) {
    const key = row.content.toLowerCase().replace(/[^a-z ]/g, '').trim()
    frequencies.set(key, (frequencies.get(key) || 0) + 1)
    assert.ok(key.split(/\s+/).length < 5 || frequencies.get(key) <= 2, 'Reject repeated invented sentences on this fixture.')
  }
  console.log('PASS', JSON.stringify({ seconds: evidence.elapsedSeconds, dialogueRows: dialogue.length, audioBytes: audio.decodedBytes, cuesMatchMilliseconds: true }))
  console.log(JSON.stringify(dialogue.map(({ startMs, endMs, content }) => ({ startMs, endMs, content })), null, 2))
} finally { clearInterval(timer); await context.close(); await browser.close() }
