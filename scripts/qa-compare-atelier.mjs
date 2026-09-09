import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'

// Lossless visual-analysis contact sheets only. Does not change source images.
const require = createRequire(import.meta.url)
const sharp = require(process.env.GINUNI_SHARP_MODULE || 'sharp')
const sourcePath = resolve('docs/design/references/balanced-atelier.png')
const implementationPath = resolve('output/playwright/atelier-review-1440.png')
const source = sharp(sourcePath)
const implementation = sharp(implementationPath)
const sourceMetadata = await source.metadata()
const implementationMetadata = await implementation.metadata()
const width = 1440
const height = 1024
const sourceView = await source.resize(width, height, { fit: 'contain', background: '#ffffff' }).png().toBuffer()
const implementationView = await implementation.resize(width, height, { fit: 'contain', background: '#ffffff' }).png().toBuffer()
await sharp({ create: { width: width * 2 + 24, height, channels: 3, background: '#dce4e0' } })
  .composite([{ input: sourceView, left: 0, top: 0 }, { input: implementationView, left: width + 24, top: 0 }])
  .png().toFile(resolve('output/playwright/atelier-comparison-full.png'))
const crop = { left: 630, top: 115, width: 790, height: 570 }
const sourceDetail = await sharp(sourceView).extract(crop).png().toBuffer()
const implementationDetail = await sharp(implementationView).extract(crop).png().toBuffer()
await sharp({ create: { width: crop.width * 2 + 24, height: crop.height, channels: 3, background: '#dce4e0' } })
  .composite([{ input: sourceDetail, left: 0, top: 0 }, { input: implementationDetail, left: crop.width + 24, top: 0 }])
  .png().toFile(resolve('output/playwright/atelier-comparison-detail.png'))
await writeFile(resolve('output/playwright/atelier-comparison.json'), JSON.stringify({
  sourcePath, implementationPath,
  sourcePixels: [sourceMetadata.width, sourceMetadata.height],
  implementationPixels: [implementationMetadata.width, implementationMetadata.height],
  comparisonPixelsPerPanel: [width, height], fit: 'contain',
  note: 'Left source, right implementation. Source includes illustrated native title bar; renderer capture excludes native frame. Video containment intentionally corrects source portrait crop. Compare layout within these constraints.'
}, null, 2))
