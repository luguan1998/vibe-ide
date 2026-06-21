type FileKind = 'code' | 'style' | 'markup' | 'data' | 'docs' | 'image' | 'config' | 'script' | 'default'

const FILE_KINDS: Record<string, { kind: FileKind; color: string }> = {
  ts: { kind: 'code', color: 'text-ide-accent' }, tsx: { kind: 'code', color: 'text-ide-accent' },
  js: { kind: 'code', color: 'text-ide-warning' }, jsx: { kind: 'code', color: 'text-ide-warning' }, mjs: { kind: 'code', color: 'text-ide-warning' }, cjs: { kind: 'code', color: 'text-ide-warning' },
  py: { kind: 'code', color: 'text-[#3572A5]' },
  go: { kind: 'code', color: 'text-[#00ADD8]' },
  rs: { kind: 'code', color: 'text-[#dea584]' },
  java: { kind: 'code', color: 'text-[#b07219]' },
  dart: { kind: 'code', color: 'text-ide-accent' }, kt: { kind: 'code', color: 'text-ide-accent' }, kts: { kind: 'code', color: 'text-ide-accent' },
  c: { kind: 'code', color: 'text-[#00ADD8]' }, cpp: { kind: 'code', color: 'text-[#f34b7d]' }, h: { kind: 'code', color: 'text-[#00ADD8]' }, hpp: { kind: 'code', color: 'text-[#f34b7d]' },
  css: { kind: 'style', color: 'text-[#a855f7]' }, scss: { kind: 'style', color: 'text-[#a855f7]' }, less: { kind: 'style', color: 'text-[#a855f7]' },
  html: { kind: 'markup', color: 'text-ide-accent' }, htm: { kind: 'markup', color: 'text-ide-accent' },
  vue: { kind: 'markup', color: 'text-ide-accent' }, svelte: { kind: 'markup', color: 'text-ide-accent' },
  json: { kind: 'data', color: 'text-ide-warning' },
  yml: { kind: 'data', color: 'text-[#cb3d3d]' }, yaml: { kind: 'data', color: 'text-[#cb3d3d]' },
  db: { kind: 'data', color: 'text-ide-warning' }, sqlite: { kind: 'data', color: 'text-ide-warning' }, sql: { kind: 'data', color: 'text-ide-warning' },
  md: { kind: 'docs', color: 'text-ide-accent' }, mdx: { kind: 'docs', color: 'text-ide-accent' },
  svg: { kind: 'image', color: 'text-[#a855f7]' },
  png: { kind: 'image', color: 'text-ide-success' }, jpg: { kind: 'image', color: 'text-ide-success' }, jpeg: { kind: 'image', color: 'text-ide-success' }, gif: { kind: 'image', color: 'text-ide-success' }, webp: { kind: 'image', color: 'text-ide-success' }, ico: { kind: 'image', color: 'text-ide-success' },
  sh: { kind: 'script', color: 'text-ide-accent' }, bash: { kind: 'script', color: 'text-ide-accent' }, bat: { kind: 'script', color: 'text-ide-accent' },
  env: { kind: 'config', color: 'text-ide-text-muted' }, gitignore: { kind: 'config', color: 'text-ide-text-muted' },
}

function getFileInfo(name: string): { kind: FileKind; color: string } {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FILE_KINDS[ext] || { kind: 'default', color: 'text-ide-text-muted' }
}

const FILE_ICON_PATHS: Record<FileKind, string> = {
  code: `<path d="M4.75 4.25a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z" /><path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2H6a1.5 1.5 0 0 1 1.5 1.5V6A1.5 1.5 0 0 1 6 7.5H3.5A1.5 1.5 0 0 1 2 6V3.5Zm1.5 0H6V6H3.5V3.5Z" clip-rule="evenodd" /><path d="M4.25 11.25a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0Z" /><path fillRule="evenodd" d="M2 10a1.5 1.5 0 0 1 1.5-1.5H6A1.5 1.5 0 0 1 7.5 10v2.5A1.5 1.5 0 0 1 6 14H3.5A1.5 1.5 0 0 1 2 12.5V10Zm1.5 2.5V10H6v2.5H3.5Z" clip-rule="evenodd" /><path d="M11.25 4.25a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z" /><path fillRule="evenodd" d="M10 2a1.5 1.5 0 0 0-1.5 1.5V6A1.5 1.5 0 0 0 10 7.5h2.5A1.5 1.5 0 0 0 14 6V3.5A1.5 1.5 0 0 0 12.5 2H10Zm2.5 1.5H10V6h2.5V3.5Z" clip-rule="evenodd" /><path d="M8.5 9.417a.917.917 0 1 1 1.833 0 .917.917 0 0 1-1.833 0ZM8.5 13.083a.917.917 0 1 1 1.833 0 .917.917 0 0 1-1.833 0ZM13.083 8.5a.917.917 0 1 0 0 1.833.917.917 0 0 0 0-1.833ZM12.166 13.084a.917.917 0 1 1 1.833 0 .917.917 0 0 1-1.833 0ZM11.25 10.333a.917.917 0 1 0 0 1.833.917.917 0 0 0 0-1.833Z" />`,
  style: `<path fillRule="evenodd" d="M3.75 2a.75.75 0 0 0-.75.75v10.5a.75.75 0 0 0 1.28.53L8 10.06l3.72 3.72a.75.75 0 0 0 1.28-.53V2.75a.75.75 0 0 0-.75-.75h-8.5Z" clip-rule="evenodd" />`,
  markup: `<path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clip-rule="evenodd" />`,
  data: `<path d="M8 7c3.314 0 6-1.343 6-3s-2.686-3-6-3-6 1.343-6 3 2.686 3 6 3Z" /><path d="M8 8.5c1.84 0 3.579-.37 4.914-1.037A6.33 6.33 0 0 0 14 6.78V8c0 1.657-2.686 3-6 3S2 9.657 2 8V6.78c.346.273.72.5 1.087.683C4.42 8.131 6.16 8.5 8 8.5Z" /><path d="M8 12.5c1.84 0 3.579-.37 4.914-1.037.366-.183.74-.41 1.086-.684V12c0 1.657-2.686 3-6 3s-6-1.343-6-3v-1.22c.346.273.72.5 1.087.683C4.42 12.131 6.16 12.5 8 12.5Z" />`,
  docs: `<path d="M7.25 3.688a8.035 8.035 0 0 0-4.872-.523A.48.48 0 0 0 2 3.64v7.994c0 .345.342.588.679.512a6.02 6.02 0 0 1 4.571.81V3.688ZM8.75 12.956a6.02 6.02 0 0 1 4.571-.81c.337.075.679-.167.679-.512V3.64a.48.48 0 0 0-.378-.475 8.034 8.034 0 0 0-4.872.523v9.268Z" />`,
  image: `<path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm10.5 5.707a.5.5 0 0 0-.146-.353l-1-1a.5.5 0 0 0-.708 0L9.354 9.646a.5.5 0 0 1-.708 0L6.354 7.354a.5.5 0 0 0-.708 0l-2 2a.5.5 0 0 0-.146.353V12a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V9.707ZM12 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clip-rule="evenodd" />`,
  config: `<path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.261-4.262a1.75 1.75 0 0 0 0-2.474Z" /><path d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0 1 14 9v2.25A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5A2.75 2.75 0 0 1 4.75 2H7a.75.75 0 0 1 0 1.5H4.75Z" />`,
  script: `<path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.97a.75.75 0 0 0 0 1.06l.97.97-.97.97a.75.75 0 1 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06l-1.5-1.5a.75.75 0 0 0-1.06 0ZM8.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clip-rule="evenodd" />`,
  default: `<path fillRule="evenodd" d="M4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L9.94 2.439A1.5 1.5 0 0 0 8.878 2H4Zm1 5.75A.75.75 0 0 1 5.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 7.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd" />`,
}

export { FILE_KINDS, FILE_ICON_PATHS, getFileInfo }
export type { FileKind }
