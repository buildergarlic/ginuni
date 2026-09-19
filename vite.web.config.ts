import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/web'),
  base: process.env.GINUNI_WEB_BASE || './',
  plugins: [
    react(),
    {
      name: 'web-license-notices',
      generateBundle() {
        const paths = [
          'LICENSE',
          'NOTICE',
          'THIRD_PARTY_NOTICES.md',
          'node_modules/react/LICENSE',
          'node_modules/react-dom/LICENSE',
          'node_modules/zod/LICENSE',
          'node_modules/@xmldom/xmldom/LICENSE',
          'node_modules/fflate/LICENSE',
          'node_modules/@huggingface/transformers/LICENSE',
          'node_modules/mediabunny/LICENSE',
          'docs/SAMPLE_MEDIA.md',
          'resources/licenses/onnxruntime-MIT.txt',
          'resources/licenses/whisper-MIT.txt',
          'resources/licenses/m2m100-MIT.txt'
        ]
        this.emitFile({
          type: 'asset',
          fileName: 'licenses.txt',
          source: paths
            .map((path) => `${path}\n${readFileSync(resolve(path), 'utf8')}`)
            .join('\n\n--------------------\n\n')
        })
      }
    }
  ],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true,
    assetsInlineLimit: 0
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5174 },
  preview: { host: '127.0.0.1', port: 4174 }
})
