export function safeFileName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim()
  return clean.slice(0, 120) || '새 프로젝트'
}

