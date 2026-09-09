// Observe the icon passed to the real native setter and preserve its native effects.
// This bootstrap is test-only and is never included in the packaged app.
const { BrowserWindow } = require('electron')
const setNativeIcon = BrowserWindow.prototype.setIcon
BrowserWindow.prototype.setIcon = function (icon) {
  const result = setNativeIcon.call(this, icon)
  globalThis.qaBrandingWindowIcon = icon
  return result
}
require('./workflow-boot.cjs')
