// Isolated Electron bootstrap used only by qa-workflow.mjs, never packaged.
const { app } = require('electron')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
if (!process.env.GINUNI_QA_ROOT) throw new Error('GINUNI_QA_ROOT is required')
app.setPath('documents', join(process.env.GINUNI_QA_ROOT, 'documents'))
app.setPath('userData', join(process.env.GINUNI_QA_ROOT, 'user-data'))
app.on('browser-window-created', (_event, window) => { window.show = () => {} })
import(pathToFileURL(resolve('out/main/index.js')).href)
