import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'

// Run against `npm run preview:web`. Uses an isolated browser profile, no user data.
const { chromium } = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.GINUNI_BROWSER_CHANNEL || 'msedge',
  headless: true
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 1040 },
  acceptDownloads: true
})
const page = await context.newPage()
const errors = [],
  checks = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const record = (text) => {
  checks.push(text)
  console.log(text)
}
const persisted = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('ginuni-web-projects-v1'))
  )
function silentWav(seconds) {
  const dataBytes = seconds * 16000 * 2
  const bytes = Buffer.alloc(44 + dataBytes)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(dataBytes + 36, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24)
  bytes.writeUInt32LE(32000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(dataBytes, 40)
  return bytes
}
async function download(button, extension) {
  if ((await page.locator('.export-menu').getAttribute('open')) === null)
    await page.locator('.export-menu summary').click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button }).click()
  const file = await pending
  assert.ok(file.suggestedFilename().endsWith(extension))
  const path = resolve(output, `web-export${extension}`)
  await file.saveAs(path)
  return path
}
try {
  await page.goto(process.env.GINUNI_WEB_URL || 'http://127.0.0.1:4174/', {
    waitUntil: 'networkidle'
  })
  assert.equal(await page.title(), '기누니 GiNuNi · 웹 작업실')
  assert.equal(await page.locator('a[href$=".exe"],a[href$=".apk"]').count(), 0)
  await page.screenshot({
    path: resolve(output, 'web-home-desktop.png'),
    fullPage: true
  })
  await page
    .getByRole('button', { name: '샘플로 바로 체험하기', exact: false })
    .click()
  assert.equal(await page.locator('.script-row').count(), 6)
  assert.equal(await page.locator('.sample-scene, .walkers').count(), 0)
  await page.waitForFunction(
    () => document.querySelector('video')?.readyState >= 2
  )
  assert.equal(
    Math.round(await page.locator('video').evaluate((video) => video.duration)),
    60
  )
  assert.ok(
    (await page.locator('video').getAttribute('src')).includes(
      'sample-market-street-1906'
    )
  )
  assert.equal(
    await page
      .getByRole('link', { name: '원본 영상·퍼블릭도메인 출처 확인 ↗' })
      .getAttribute('href'),
    'https://archive.org/details/ATripDownMarketStreet_HD'
  )
  await page.getByRole('button', { name: '영상 재생', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('video').currentTime > 0.2
  )
  await page
    .getByRole('button', { name: '영상 일시 정지', exact: true })
    .click()
  record(
    'Bundled public-domain film loads and actually plays, with its source visible.'
  )
  await page
    .getByRole('textbox', { name: '화면해설 내용', exact: true })
    .fill('철로를 따라 마차와 자동차가 오가는 실제 거리 모습.')
  await page.getByRole('button', { name: '해설', exact: true }).click()
  await page.getByRole('button', { name: '확인 완료 · 다음 →' }).click()
  assert.equal(await page.locator('.script-row.selected.gap').count(), 1)
  assert.equal(await page.locator('.row-editor textarea:focus').count(), 1)
  record(
    'Sample editing, description-only next review, and keyboard focus pass.'
  )
  await page.getByRole('button', { name: '전체', exact: true }).click()
  await page
    .getByRole('button', { name: '00:00 해설 선택', exact: true })
    .click()
  await page.getByRole('textbox', { name: '시작 시간', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.equal((await persisted())[0].rows[0].reviewed, true)
  record('Focusing unchanged time preserves approval.')
  const hwpx = unzipSync(
    new Uint8Array(await readFile(await download('HWPX 한글 대본', '.hwpx')))
  )
  assert.ok(
    strFromU8(hwpx['Contents/section0.xml']).includes('철로를 따라 마차')
  )
  assert.equal(strFromU8(hwpx.mimetype), 'application/hwp+zip')
  await page.getByRole('button', { name: 'SRT 자막' }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'SRT로 저장할 대사 행이 없습니다' })
    .waitFor()
  record('Silent-film sample contains no invented dialogue or SRT transcript.')
  const backupPath = await download('JSON 작업 백업', '.json')
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  assert.equal(backup.rows[0].reviewed, true)
  record('Actual-film HWPX and canonical JSON downloads pass.')
  await page.screenshot({
    path: resolve(output, 'web-workspace-desktop.png'),
    fullPage: true
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page
    .locator('.project-open')
    .filter({ hasText: '1906년 샌프란시스코' })
    .click()
  assert.equal(
    await page
      .getByRole('textbox', { name: '화면해설 내용', exact: true })
      .inputValue(),
    backup.rows[0].content
  )
  record('Reload and reopen preserve edited text and review state.')
  await page.getByRole('button', { name: '작업 목록으로' }).click()
  await page
    .getByLabel('JSON 백업 파일', { exact: true })
    .setInputFiles(backupPath)
  await page.getByRole('status').filter({ hasText: '복원했습니다' }).waitFor()
  assert.equal((await persisted()).length, 2)
  record(
    'Backup restoration creates a separate project without overwriting original.'
  )
  await page.getByRole('button', { name: '작업 목록으로' }).click()
  await page
    .getByRole('button', { name: '내 영상으로 시작', exact: true })
    .click()
  await page
    .getByRole('checkbox', {
      name: '선택할 영상·음성·자막을 사용할 권리가 있습니다.'
    })
    .check()
  await page.getByLabel('영상·음성 파일', { exact: true }).setInputFiles({
    name: 'twelve.wav',
    mimeType: 'audio/wav',
    buffer: silentWav(12)
  })
  await page
    .getByRole('status')
    .filter({ hasText: '파일을 연결했습니다' })
    .waitFor()
  assert.ok(
    Math.abs(
      (await page.locator('video').evaluate((video) => video.duration)) - 12
    ) < 0.1
  )
  // Delay only metadata probes detached from the document. The real player and
  // decoder still load actual WAVs; no model or application method is mocked.
  await page.evaluate(() => {
    const originalCreate = document.createElement.bind(document)
    const held = []
    document.createElement = function (name, options) {
      const element = originalCreate(name, options)
      if (name.toLowerCase() === 'video') {
        element.addEventListener('loadedmetadata', event => {
          if (!element.isConnected) {
            event.stopImmediatePropagation()
            held.push(element)
          }
        }, true)
      }
      return element
    }
    window.__metadataGate = {
      held,
      release(index, fail = false) {
        const element = held[index]
        const handler = fail ? element.onerror : element.onloadedmetadata
        handler?.call(element, new Event(fail ? 'error' : 'loadedmetadata'))
      },
      restore() { document.createElement = originalCreate }
    }
  })
  const chooseDelayedMedia = async name => {
    await page.getByLabel('영상·음성 파일', { exact: true }).setInputFiles({
      name, mimeType: 'audio/wav', buffer: silentWav(15)
    })
  }
  const analyzeButton = page.getByRole('button', { name: 'AI로 대사 만들기', exact: true })
  await chooseDelayedMedia('delayed-first.wav')
  await page.waitForFunction(() => window.__metadataGate.held.length === 1)
  assert.equal(await analyzeButton.isDisabled(), true, 'AI must not analyze the old file during a pending media replacement.')
  await analyzeButton.evaluate(button => button.click())
  assert.equal(await page.locator('.analysis-progress').count(), 0)
  await chooseDelayedMedia('delayed-latest.wav')
  await page.waitForFunction(() => window.__metadataGate.held.length === 2)
  await page.evaluate(async () => {
    window.__metadataGate.release(0)
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  assert.equal(await analyzeButton.isDisabled(), true, 'An older metadata result must not unlock analysis while the latest selection is pending.')
  assert.ok((await page.locator('.file-name').innerText()).includes('twelve.wav'))
  await page.evaluate(() => window.__metadataGate.release(1))
  await page.locator('.file-name').filter({ hasText: 'delayed-latest.wav' }).waitFor()
  assert.equal(await analyzeButton.isEnabled(), true)
  await chooseDelayedMedia('stale-failure.wav')
  await page.waitForFunction(() => window.__metadataGate.held.length === 3)
  await chooseDelayedMedia('latest-success.wav')
  await page.waitForFunction(() => window.__metadataGate.held.length === 4)
  await page.evaluate(() => window.__metadataGate.release(3))
  await page.locator('.file-name').filter({ hasText: 'latest-success.wav' }).waitFor()
  await page.evaluate(async () => {
    window.__metadataGate.release(2, true)
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    window.__metadataGate.restore()
  })
  assert.equal(await page.getByRole('alert').count(), 0, 'A stale metadata failure must not replace the current successful selection with an error.')
  assert.equal(await analyzeButton.isEnabled(), true)
  assert.ok((await page.locator('.file-name').innerText()).includes('latest-success.wav'))
  record('Pending media blocks old-file AI analysis; latest selection wins and stale metadata failures stay quiet.')
  await page.getByLabel('영상·음성 파일', { exact: true }).setInputFiles({
    name: 'twelve.wav', mimeType: 'audio/wav', buffer: silentWav(12)
  })
  await page.locator('.file-name').filter({ hasText: 'twelve.wav' }).waitFor()
  await page.getByLabel('영상·음성 파일', { exact: true }).setInputFiles({
    name: 'fifteen.wav',
    mimeType: 'audio/wav',
    buffer: silentWav(15)
  })
  await page.locator('.file-name').filter({ hasText: 'fifteen.wav' }).waitFor()
  await page.getByRole('button', { name: '↶ 되돌리기', exact: true }).click()
  await page.locator('.file-name').filter({ hasText: 'twelve.wav' }).waitFor()
  await page.waitForFunction(
    () => Math.abs(document.querySelector('video').duration - 12) < 0.1
  )
  record(
    'Changing media and undo restore both project metadata and actual playable file.'
  )
  await page.getByLabel('SRT 자막 파일', { exact: true }).setInputFiles({
    name: 'test.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '1\n00:00:02,000 --> 00:00:04,000\n테스트 대사입니다.\n\n2\n00:00:08,000 --> 00:00:10,000\n두 번째 대사입니다.'
    )
  })
  await page
    .getByRole('status')
    .filter({ hasText: '자막을 가져왔습니다' })
    .waitFor()
  const srt = await readFile(await download('SRT 자막', '.srt'), 'utf8')
  assert.ok(srt.includes('00:00:02,000 --> 00:00:04,000'))
  assert.ok(srt.includes('테스트 대사입니다.'))
  assert.ok(!srt.includes('해설 후보'))
  record('Imported dialogue exports as SRT without description candidates.')
  const rowCount = await page.locator('.script-row').count()
  await page.getByLabel('SRT 자막 파일', { exact: true }).setInputFiles({
    name: 'broken.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from('incorrect')
  })
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.script-row').count(), rowCount)
  record(
    'SRT import creates gap candidates; malformed SRT leaves current draft intact.'
  )
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  )
  await page.screenshot({
    path: resolve(output, 'web-workspace-mobile.png'),
    fullPage: true
  })
  await page.getByRole('button', { name: '작업 목록으로' }).click()
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  )
  await page.screenshot({
    path: resolve(output, 'web-home-mobile.png'),
    fullPage: true
  })
  record('390px mobile home and workspace have no horizontal overflow.')
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'web-qa-results.json'),
    JSON.stringify({ checks, errors }, null, 2)
  )
  record('No browser runtime errors.')
} finally {
  await context.close()
  await browser.close()
}
