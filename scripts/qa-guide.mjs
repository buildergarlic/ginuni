import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// Uses an isolated profile, never the writer's projects, API keys or browser.
const require = createRequire(import.meta.url)
const playwright = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const root = resolve('output/playwright', `guide-qa-${Date.now()}`)
await Promise.all(['documents', 'user-data'].map(name => mkdir(join(root, name), { recursive: true })))
const env = { ...process.env, GINUNI_QA_ROOT: root, OPENAI_API_KEY: '' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let application
const failures = []
const passed = []
try {
  application = await playwright._electron.launch({ executablePath: require('electron'), args: [resolve('scripts/qa/workflow-boot.cjs')], env, timeout: 30000 })
  const page = await application.firstWindow()
  // The test bootstrap is a script rather than the packaged app; Electron otherwise
  // reports its own runtime version. Use the actual package version for this fixture.
  const version = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
  await application.evaluate(({ app }, version) => { app.getVersion = () => version }, version)
  await page.reload()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'About GiNuNi', exact: true }).click()
  await application.evaluate(({ shell }) => {
    globalThis.qaOpenedLinks = []
    shell.openExternal = async url => { globalThis.qaOpenedLinks.push(url) }
  })
  await page.getByRole('button', { name: 'Threads', exact: true }).click()
  try {
    assert.deepEqual(await application.evaluate(() => globalThis.qaOpenedLinks), ['https://www.threads.com/@buildergarlic'])
    assert.equal((await page.locator('body').innerText()).includes('@builder.garlic'), false)
    passed.push('About Threads button opens the requested URL through real IPC')
  } catch (error) { failures.push(error.message) }
  await page.getByRole('button', { name: '← 돌아가기', exact: true }).click()
  await page.getByRole('button', { name: '사용법', exact: true }).click()
  await page.getByRole('heading', { name: 'GiNuNi 사용법', exact: true }).waitFor()
  assert.equal(await page.locator('.manual-edition').innerText(), `작가를 위한 안내서 · v${version}`)
  try {
    const navigation = page.getByRole('navigation', { name: '사용법 목차' })
    await navigation.waitFor()
    const links = await navigation.getByRole('link').evaluateAll(elements => elements.map(a => a.getAttribute('href')))
    assert.equal(links.length, 5)
    for (const href of links) assert.equal(await page.locator(href).count(), 1, `Missing guide section: ${href}`)
    const demo = page.getByRole('button', { name: '해설 · 00:18 문을 열고 여자가 들어온다.' })
    await demo.click()
    assert.equal(await page.locator('.manual-demo output').innerText(), '00:18 · 일시정지')
    assert.equal(await demo.getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: '대사 · 00:12 “어서 와. 기다리고 있었어.”' }).click()
    assert.equal(await page.locator('.manual-demo output').innerText(), '00:12 · 일시정지')
    passed.push('Practice dialogue and description clicks update only the illustrated time')
    await navigation.getByRole('link', { name: '막혔을 때', exact: true }).click()
    assert.equal(await page.locator('#guide-help').evaluate(el => {
      const top = el.getBoundingClientRect().top
      return window.scrollY > 0 && top >= 0 && top < window.innerHeight
    }), true, 'Contents link must scroll its destination into view')
    const question = page.locator('summary').filter({ hasText: '저장 버튼을 누를 수 없어요' })
    await question.focus()
    await page.keyboard.press('Enter')
    assert.equal(await question.evaluate(el => el.parentElement.open), true)
    await page.keyboard.press('Enter')
    assert.equal(await question.evaluate(el => el.parentElement.open), false)
    passed.push('Guide contents navigate to real sections and FAQ opens by keyboard')
    // Hidden Electron windows do not reliably produce compositor screenshots on Windows.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    for (const width of [1440, 1100]) {
      await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
      await page.evaluate(() => window.scrollTo(0, 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Horizontal overflow at ${width}`)
      const smallText = await page.locator('.writer-guide p, .writer-guide li, .writer-guide summary').evaluateAll(elements => elements.filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).length)
      assert.equal(smallText, 0, 'Essential guide text must be at least 16px')
      await page.screenshot({ path: resolve(`output/playwright/guide-${width}.png`), fullPage: true })
      if (width === 1440) await page.screenshot({ path: resolve('output/playwright/guide-preview.png') })
    }
    passed.push('Guide is readable without horizontal overflow at 1440 and 1100 pixels')
  } catch (error) { failures.push(error.message) }
  await page.getByRole('button', { name: '← 돌아가기', exact: true }).click()
  await page.getByRole('button', { name: '사용법', exact: true }).waitFor()
  passed.push('Returning from guide restores project home')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed, failures, profile: root, pageErrors: errors }, null, 2))
  assert.deepEqual(failures, [])
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await application.close().catch(() => {})
  }
}
