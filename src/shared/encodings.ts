export interface EncodingEntry {
  label: string
  value: string
}

export interface EncodingGroup {
  name: string
  encodings: EncodingEntry[]
}

export const ENCODING_GROUPS: EncodingGroup[] = [
  {
    name: 'Unicode',
    encodings: [
      { label: 'UTF-8', value: 'utf-8' },
      { label: 'UTF-16 LE', value: 'utf-16le' },
      { label: 'UTF-16 BE', value: 'utf-16be' },
    ],
  },
  {
    name: 'Chinese',
    encodings: [
      { label: 'GBK', value: 'gbk' },
      { label: 'GB2312', value: 'gb2312' },
      { label: 'GB18030', value: 'gb18030' },
      { label: 'Big5', value: 'big5' },
    ],
  },
  {
    name: 'Japanese',
    encodings: [
      { label: 'Shift-JIS', value: 'shift-jis' },
      { label: 'EUC-JP', value: 'euc-jp' },
    ],
  },
  {
    name: 'Korean',
    encodings: [
      { label: 'EUC-KR', value: 'euc-kr' },
    ],
  },
  {
    name: 'Western',
    encodings: [
      { label: 'ISO-8859-1 (Latin-1)', value: 'iso-8859-1' },
      { label: 'Windows-1252', value: 'windows-1252' },
    ],
  },
]

export const ALL_ENCODINGS: EncodingEntry[] = ENCODING_GROUPS.flatMap(g => g.encodings)

const ENCODING_ALIASES: Record<string, string> = {
  'utf8': 'utf-8',
  'utf16le': 'utf-16le',
  'utf16be': 'utf-16be',
  'ascii': 'utf-8',
  'us-ascii': 'utf-8',
  'latin1': 'iso-8859-1',
  'latin-1': 'iso-8859-1',
  'shiftjis': 'shift-jis',
  'euckr': 'euc-kr',
  'cp1252': 'windows-1252',
  'big5hkscs': 'big5',
}

export function normalizeEncoding(enc: string): string {
  const lower = enc.toLowerCase()
  return ENCODING_ALIASES[lower] || lower
}

export const DEFAULT_ENCODING = 'utf-8'
