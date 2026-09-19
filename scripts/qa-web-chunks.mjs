import assert from 'node:assert/strict'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

// Provide a >5-minute, >100MiB movie with audible Korean speech after minute five.
const fixture = process.env.GINUNI_CHUNK_MEDIA
if (!fixture) throw new Error('Set GINUNI_CHUNK_MEDIA to the large-video fixture path.')
const fixtureInfo = await stat(fixture)
assert.ok(fixtureInfo.size > 100 * 1024 * 1024)
const { chromium } = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.GINUNI_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } })
await context.addInitScript(({ fixtureName }) => {
  window.chunkQA = { wholeFileReads: 0, maxSliceBytes: 0, maxReadBytes: 0, totalReadBytes: 0, reads: 0, workers: 0, chunks: [], progress: [] }
  const tracked = new WeakSet()
  const isTracked = blob => tracked.has(blob) || (blob instanceof File && blob.name === fixtureName)
  const recordRead = bytes => {
    window.chunkQA.reads++
    window.chunkQA.maxReadBytes = Math.max(window.chunkQA.maxReadBytes, bytes)
    window.chunkQA.totalReadBytes += bytes
  }
  const arrayBuffer = File.prototype.arrayBuffer
  File.prototype.arrayBuffer = function () {
    if (this.name === fixtureName) {
      window.chunkQA.wholeFileReads++
      throw new Error('QA: whole large-file reads are forbidden')
    }
    return arrayBuffer.call(this)
  }
  const slice = Blob.prototype.slice
  Blob.prototype.slice = function (start = 0, end = this.size, type) {
    const result = slice.call(this, start, end, type)
    if (isTracked(this)) {
      tracked.add(result)
      window.chunkQA.maxSliceBytes = Math.max(window.chunkQA.maxSliceBytes, Math.min(this.size, end) - start)
    }
    return result
  }
  const blobArrayBuffer = Blob.prototype.arrayBuffer
  Blob.prototype.arrayBuffer = function () {
    if (isTracked(this)) recordRead(this.size)
    return blobArrayBuffer.call(this)
  }
  // A Blob slice is only a view; measure actual stream reads, not its virtual size.
  const stream = Blob.prototype.stream
  Blob.prototype.stream = function () {
    const result = stream.call(this)
    if (isTracked(this)) {
      const getReader = result.getReader.bind(result)
      result.getReader = (...args) => {
        const reader = getReader(...args)
        const read = reader.read.bind(reader)
        reader.read = async (...readArgs) => {
          const chunk = await read(...readArgs)
          if (chunk.value) recordRead(chunk.value.byteLength)
          return chunk
        }
        return reader
      }
    }
    return result
  }
  const NativeWorker = window.Worker
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      if (String(url).includes('transcription.worker')) {
        window.chunkQA.workers++
        const post = this.postMessage.bind(this)
        this.postMessage = (message, transfer) => {
          if (message.type === 'transcribe') window.chunkQA.chunks.push({ id: message.chunkId, samples: message.audio.length, durationMs: message.durationMs })
          return post(message, transfer)
        }
      }
    }
  }
}, { fixtureName: basename(fixture) })
const page = await context.newPage()
const errors = [], uploads = [], failedResponses = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
context.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) uploads.push(request.method() + ' ' + new URL(request.url()).origin) })
context.on('response', response => { if (response.status() >= 400) failedResponses.push(response.status() + ' ' + response.url().split('?')[0]) })
const start = Date.now()
let timer
try {
  await page.goto(process.env.GINUNI_WEB_URL || 'http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '내 영상으로 시작', exact: true }).click()
  await page.getByRole('checkbox', { name: '선택할 영상·음성·자막을 사용할 권리가 있습니다.' }).check()
  await page.getByLabel('영상·음성 파일', { exact: true }).setInputFiles(fixture)
  await page.getByRole('status').filter({ hasText: '파일을 연결했습니다' }).waitFor()
  // Keep a writer's existing row: cancellation must not replace it with partial chunks.
  await page.getByRole('button', { name: '대사 +', exact: true }).click()
  await page.getByRole('textbox', { name: '대사 내용', exact: true }).fill('취소해도 보존해야 할 기존 대사')
  await page.getByRole('button', { name: 'AI로 대사 만들기', exact: true }).click()
  await page.getByRole('button', { name: '분석 취소', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '취소했습니다' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '대사 내용', exact: true }).inputValue(), '취소해도 보존해야 할 기존 대사')
  console.log('Cancellation preserves writer draft.')
  await page.evaluate(() => { window.chunkQA.workers = 0; window.chunkQA.chunks = [] })
  await page.getByRole('button', { name: 'AI로 대사 만들기', exact: true }).click()
  timer = setInterval(async () => {
    try {
      const snapshot = await page.locator('.analysis-progress').innerText({ timeout: 500 })
      console.log('PROGRESS', Math.round((Date.now() - start) / 1000), snapshot.replace(/\n/g, ' '))
    } catch {}
  }, 20000)
  await page.waitForFunction(() => {
    const meter = document.querySelector('.analysis-progress progress')
    if (meter) window.chunkQA.progress.push(meter.value)
    return [...document.querySelectorAll('[role="status"]')].some(node => node.textContent.includes('AI 초안을 만들었습니다')) || !!document.querySelector('[role="alert"]')
  }, undefined, { timeout: 600000, polling: 1000 })
  const outcome = await page.getByRole('status').allTextContents()
  const alert = await page.getByRole('alert').allTextContents()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ginuni-web-projects-v1'))[0])
  const qa = await page.evaluate(() => window.chunkQA)
  const evidence = { url: page.url(), fixtureBytes: fixtureInfo.size, elapsedSeconds: (Date.now() - start) / 1000, outcome, alert, qa, errors, uploads, failedResponses, durationMs: saved.durationMs, rows: saved.rows }
  await writeFile(resolve(output, 'web-chunks-qa.json'), JSON.stringify(evidence, null, 2))
  await page.screenshot({ path: resolve(output, 'web-chunks-qa.png'), fullPage: true })
  assert.deepEqual(alert, [])
  assert.ok(outcome.join(' ').includes('AI 초안을 만들었습니다'))
  assert.ok(saved.durationMs > 300000)
  assert.ok(saved.rows.some(row => row.kind === 'dialogue' && row.startMs > 300000), 'Speech after minute five must retain its original timestamp.')
  assert.equal(qa.wholeFileReads, 0)
  assert.ok(qa.reads > 1 && qa.maxReadBytes <= 8 * 1024 * 1024, 'Decode must use bounded range reads.')
  assert.equal(qa.workers, 1, 'Reuse the same model worker.')
  assert.ok(qa.chunks.length > 5)
  assert.ok(qa.chunks.every(chunk => chunk.samples <= 64 * 16000))
  assert.ok(qa.progress.every((value, index) => !index || value >= qa.progress[index - 1]))
  assert.ok(saved.rows.filter(row => row.kind === 'dialogue').every(row => !/(.)\1{8,}/u.test(row.content) && row.endMs - row.startMs <= 20_000), 'Long digital silence must not become repeated text or a stretched dialogue.')
  assert.deepEqual(errors, [])
  assert.deepEqual(uploads, [])
  assert.deepEqual(failedResponses, [])
  console.log('PASS', JSON.stringify({ durationMs: saved.durationMs, fileBytes: fixtureInfo.size, chunks: qa.chunks.length, workers: qa.workers, maxReadBytes: qa.maxReadBytes, transcriptRows: saved.rows.filter(row => row.kind === 'dialogue').length, elapsedSeconds: evidence.elapsedSeconds }))
} finally { clearInterval(timer); await context.close(); await browser.close() }
