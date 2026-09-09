import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Catches missing/replaced/cropped/recolored original artwork and native icon wiring.
// The hashes identify the user's selected unmodified artwork, not generated fixtures.
const expected = {
  logo: '8c7cb0b35360affaa46062d339d7877c99a4c3213648852916f5e87c4a107dbe',
  icon: '3e1b1a76133495b6edcde9603b2dfce5e02407ca5a276165418b928a0bc42849',
  ico: '23732b31cafa0f817798634e665ea4812d3374af670563c5a5eeb4e1d2fd7066'
}
const require = createRequire(import.meta.url)
const playwright = process.env.GINUNI_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.GINUNI_PLAYWRIGHT_MODULE).href)
  : await import('playwright')
const root = resolve('output/playwright', `branding-qa-${Date.now()}`)
await Promise.all(['documents', 'user-data'].map(name => mkdir(join(root, name), { recursive: true })))
const env = { ...process.env, GINUNI_QA_ROOT: root, OPENAI_API_KEY: '' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const passed = []
const failures = []
const screenshots = []
const errors = []
const check = async (name, action) => {
  try { await action(); passed.push(name) } catch (error) { failures.push({ name, message: error.message }) }
}
const assetHash = async url => {
  const bytes = url.startsWith('data:') ? Buffer.from(url.split(',')[1], 'base64') : await readFile(fileURLToPath(url))
  return createHash('sha256').update(bytes).digest('hex')
}
let application
try {
  application = await playwright._electron.launch({ executablePath: require('electron'), args: [resolve('scripts/qa/branding-boot.cjs')], env, timeout: 30000 })
  const page = await application.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  // The isolated bootstrap is not the packaged entry, so supply its package version.
  const version = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
  await application.evaluate(({ app }, version) => { app.getVersion = () => version }, version)
  await page.reload()
  await page.getByRole('button', { name: 'About GiNuNi', exact: true }).waitFor()

  await check('Native BrowserWindow receives the selected valid ICO', async () => {
    const native = await application.evaluate(({ nativeImage }) => {
      const icon = globalThis.qaBrandingWindowIcon
      if (typeof icon !== 'string') return { path: null, empty: true }
      const image = nativeImage.createFromPath(icon)
      return { path: icon, empty: image.isEmpty(), size: image.getSize() }
    })
    assert.ok(native.path, 'The actual BrowserWindow native icon setter received no icon path')
    assert.equal(native.empty, false, `Native icon did not decode: ${native.path}`)
    assert.equal(createHash('sha256').update(await readFile(native.path)).digest('hex'), expected.ico)
  })

  await check('Favicon loads the original square artwork', async () => {
    const favicon = page.locator('link[rel="icon"]')
    assert.equal(await favicon.count(), 1, 'Renderer has no favicon')
    const url = await favicon.evaluate(el => el.href)
    assert.equal(await assetHash(url), expected.icon)
    const dimensions = await page.evaluate(async url => {
      const img = new Image()
      img.src = url
      await img.decode()
      return [img.naturalWidth, img.naturalHeight]
    }, url)
    assert.deepEqual(dimensions, [1254, 1254])
  })

  const verifyLogo = async (screen, width) => {
    const logo = page.getByRole('img', { name: '기누니 GiNuNi', exact: true })
    assert.equal(await logo.count(), 1, `${screen} has no original GiNuNi logo`)
    const state = await logo.evaluate(async img => {
      await img.decode()
      const rect = img.getBoundingClientRect()
      const style = getComputedStyle(img)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(img, 0, 0)
      return {
        src: img.currentSrc, natural: [img.naturalWidth, img.naturalHeight],
        width: rect.width, height: rect.height, left: rect.left, right: rect.right,
        top: rect.top, bottom: rect.bottom, viewport: [innerWidth, innerHeight],
        objectFit: style.objectFit, filter: style.filter, opacity: style.opacity,
        blendMode: style.mixBlendMode, background: style.backgroundColor,
        corner: [...context.getImageData(0, 0, 1, 1).data]
      }
    })
    assert.deepEqual(state.natural, [2172, 724], 'Original logo dimensions changed')
    assert.equal(await assetHash(state.src), expected.logo, 'Rendered logo differs from supplied original')
    assert.ok(state.width > 100 && Math.abs(state.width / state.height - 3) < 0.01, 'Logo is distorted or too small')
    assert.ok(state.left >= 0 && state.right <= width && state.top >= 0 && state.bottom <= state.viewport[1], 'Logo is clipped or outside the viewport')
    assert.equal(state.objectFit, 'contain', 'Logo must retain the complete artwork')
    assert.equal(state.filter, 'none', 'Logo color was filtered')
    assert.equal(state.opacity, '1')
    assert.equal(state.blendMode, 'normal')
    assert.equal(state.background, 'rgb(255, 255, 255)')
    assert.ok(state.corner.slice(0, 3).every(channel => channel >= 250) && state.corner[3] === 255, 'Original white background must stay opaque')
  }

  for (const [width, height] of [[1440, 1024], [800, 600]]) {
    await application.evaluate(({ BrowserWindow }, dimensions) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(...dimensions)
      win.showInactive()
    }, [width, height])
    await page.evaluate(() => scrollTo(0, 0))
    for (const screen of ['home', 'about']) {
      if (screen === 'about') await page.getByRole('button', { name: 'About GiNuNi', exact: true }).click()
      await check(`${screen} preserves complete original logo on white at ${width}`, () => verifyLogo(screen, width))
      await check(`${screen} remains within ${width}px with working navigation`, async () => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Horizontal overflow')
        if (screen === 'home') assert.equal(await page.getByRole('button', { name: '사용법', exact: true }).isVisible(), true)
        else assert.equal(await page.getByRole('heading', { name: '화면해설 대본 도구', exact: true }).isVisible(), true)
      })
      const screenshot = join(root, `branding-${screen}-${width}.png`)
      await page.screenshot({ path: screenshot })
      screenshots.push(screenshot)
      if (screen === 'about') await page.getByRole('button', { name: /돌아가기/ }).click()
    }
  }
  await check('Branding produces no renderer exceptions', async () => assert.deepEqual(errors, []))
  const report = { passed, failures, profile: root, screenshots, pageErrors: errors }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(failures, [])
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await application.close().catch(() => {})
  }
}
