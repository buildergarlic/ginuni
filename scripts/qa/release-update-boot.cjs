// Release-only smoke check: real updater/network, isolated cache, NEVER install.
const assert = require('node:assert/strict')
const { app } = require('electron')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const root = process.env.GINUNI_QA_ROOT
const config = process.env.GINUNI_QA_UPDATE_CONFIG
const previous = process.env.GINUNI_QA_PREVIOUS_VERSION
const expected = process.env.GINUNI_QA_EXPECTED_VERSION
if (!root || !config || !previous || !expected) throw new Error('Explicit QA root, config and versions required')
app.setPath('userData', join(root, 'user-data'))
app.setPath('documents', join(root, 'documents'))

app.whenReady().then(async () => {
  const blocked = () => { throw new Error('Installation/relaunch is prohibited by this read-only release QA') }
  const adapter = {
    version: previous, name: 'ginuni-release-qa', isPackaged: true,
    appUpdateConfigPath: resolve(config), userDataPath: join(root, 'user-data'),
    baseCachePath: join(root, 'cache'), whenReady: () => app.whenReady(),
    quit: blocked, relaunch: blocked, onQuit: () => {}
  }
  const updater = new NsisUpdater(null, adapter)
  updater.httpExecutor = new ElectronHttpExecutor(() => {})
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.autoRunAppAfterInstall = false
  updater.allowPrerelease = true
  updater.fullChangelog = false
  updater.logger = null
  updater.quitAndInstall = blocked
  const events = []
  updater.on('update-available', info => events.push({ event: 'available', version: info.version }))
  updater.on('update-downloaded', info => events.push({ event: 'downloaded', version: info.version }))
  const result = await updater.checkForUpdates()
  assert.equal(result?.updateInfo.version, expected, 'Previous beta must find the requested release')
  assert.equal(result?.isUpdateAvailable, true)
  const files = await updater.downloadUpdate()
  assert.equal(files.length, 1)
  const data = await readFile(files[0])
  const report = {
    previousVersion: previous, availableVersion: result.updateInfo.version,
    downloadedFile: files[0], bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'), events,
    installed: false, scope: 'Real NSIS updater with previous-version adapter and isolated cache; not an installed-app migration test'
  }
  assert.deepEqual(events, [{ event: 'available', version: expected }, { event: 'downloaded', version: expected }])
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'update-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
