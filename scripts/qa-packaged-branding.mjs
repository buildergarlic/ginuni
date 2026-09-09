import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { NtExecutable, NtExecutableResource, Resource } from 'resedit'

// Read-only verification of actual PE resources, not of build configuration text.
// Pass explicit EXE paths to inspect downloaded releases as well as local builds.
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const icon = await readFile(process.env.GINUNI_QA_ICON || 'resources/branding/ginuni-app.ico')
assert.equal(icon.readUInt16LE(2), 1, 'Source must be an ICO')
const sourceFrames = Array.from({ length: icon.readUInt16LE(4) }, (_, i) => {
  const offset = 6 + i * 16
  const size = icon.readUInt32LE(offset + 8)
  const start = icon.readUInt32LE(offset + 12)
  return { width: icon[offset] || 256, height: icon[offset + 1] || 256, data: icon.subarray(start, start + size) }
})
assert.ok(sourceFrames.some(frame => frame.width === 16), 'Small Windows icon must be supplied')
assert.ok(sourceFrames.some(frame => frame.width === 256), 'Large Windows icon must be supplied')
const paths = process.argv.slice(2)
if (!paths.length) paths.push(
  `release/win-unpacked/${packageJson.build.productName}.exe`,
  `release/ScreenDescriptionScriptMaker-${packageJson.version}-Setup.exe`
)
const results = []
for (const path of paths) {
  const binary = await readFile(path)
  const executable = NtExecutable.from(binary, { ignoreCert: true })
  const resources = NtExecutableResource.from(executable)
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries)
  const match = groups.find(group => sourceFrames.every(source => group.icons.some(frame => {
    if ((frame.width || 256) !== source.width || (frame.height || 256) !== source.height) return false
    const entry = resources.entries.find(entry => entry.type === 3 && entry.id === frame.iconID && entry.lang === group.lang)
    return entry && Buffer.from(entry.bin).equals(source.data)
  })))
  assert.ok(match, `${path}: no icon group contains every unchanged source frame`)
  results.push({ file: resolve(path), iconGroup: match.id, sizes: sourceFrames.map(frame => frame.width), sha256: createHash('sha256').update(binary).digest('hex') })
}
console.log(JSON.stringify({ passed: true, binaries: results }, null, 2))
