import type * as monaco from 'monaco-editor'

// JSX state machines reused by both typescript and javascript tokenizers
const jsxTagOpen: monaco.languages.IMonarchLanguageRule[] = [
  [/\s+/, ''],
  [/([a-zA-Z_$][\w$]*)(\s*=\s*)("(?:[^"\\]|\\.)*")/, ['attribute.name', 'delimiter', 'string']],
  [/([a-zA-Z_$][\w$]*)(\s*=\s*)('(?:[^'\\]|\\.)*')/, ['attribute.name', 'delimiter', 'string']],
  [/([a-zA-Z_$][\w$]*)(\s*=\s*)(`(?:[^`\\]|\\.)*`)/, ['attribute.name', 'delimiter', 'string']],
  [/([a-zA-Z_$][\w$]*)(\s*=\s*)(?=\{)/, ['attribute.name', 'delimiter']],
  [/([a-zA-Z_$][\w$]*)(?=\s|\/?>|$)/, 'attribute.name'],
  [/\/>/, { token: 'tag', next: '@pop' }],
  [/>/, { token: 'tag', next: '@pop' }],
  [/\{/, { token: 'delimiter.bracket', bracket: '@open', next: '@jsxExpression' }]
]

const jsxExpression: monaco.languages.IMonarchLanguageRule[] = [
  [/\{/, { token: 'delimiter.bracket', bracket: '@open', next: '@jsxExpression' }],
  [/\}/, { token: 'delimiter.bracket', bracket: '@close', next: '@pop' }],
  { include: 'common' }
]

function buildTokenizer(languageId: string): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: 'invalid',
    tokenPostfix: languageId === 'typescript' ? '.ts' : '.js',

    keywords: [
      'abstract', 'any', 'as', 'asserts', 'bigint', 'boolean', 'break',
      'case', 'catch', 'class', 'continue', 'const', 'constructor',
      'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum',
      'export', 'extends', 'false', 'finally', 'for', 'from', 'function',
      'get', 'if', 'implements', 'import', 'in', 'infer', 'instanceof',
      'interface', 'is', 'keyof', 'let', 'module', 'namespace', 'never',
      'new', 'null', 'number', 'object', 'out', 'package', 'private',
      'protected', 'public', 'override', 'readonly', 'require', 'global',
      'return', 'satisfies', 'set', 'static', 'string', 'super', 'switch',
      'symbol', 'this', 'throw', 'true', 'try', 'type', 'typeof',
      'undefined', 'unique', 'unknown', 'var', 'void', 'while', 'with',
      'yield', 'async', 'await', 'of'
    ],

    operators: [
      '<=', '>=', '==', '!=', '===', '!==', '=>', '+', '-', '**', '*',
      '/', '%', '++', '--', '<<', '</', '>>', '>>>', '&', '|', '^', '!',
      '~', '&&', '||', '??', '?', ':', '=', '+=', '-=', '*=', '**=',
      '/=', '%=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '@'
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    digits: /\d+(_+\d+)*/,
    octaldigits: /[0-7]+(_+[0-7]+)*/,
    binarydigits: /[0-1]+(_+[0-1]+)*/,
    hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
    regexpctl: /[(){}\[\]\$\^|\-*+?\.]/,
    regexpesc: /\\(?:[bBdDfnrstvwWn0\\\/]|@regexpctl|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,

    tokenizer: {
      root: [
        [/[{}]/, 'delimiter.bracket'],
        { include: 'common' }
      ],
      common: [
        [/#?[a-z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[A-Z][\w\$]*/, 'type.identifier'],
        { include: '@whitespace' },
        [/\/(?=([^\\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/, { token: 'regexp', bracket: '@open', next: '@regexp' }],
        [/[()\[\]]/, '@brackets'],
        // JSX entry: match </tagname or <tagname
        [/<\/?([a-zA-Z_$][\w$]*)/, { token: 'tag', next: '@jsxTagOpen' }],
        [/[<>](?!@symbols)/, '@brackets'],
        [/!(?=([^=]|$))/, 'delimiter'],
        [/@symbols/, { cases: { '@operators': 'delimiter', '@default': '' } }],
        [/(@digits)[eE]([\-+]?(@digits))?/, 'number.float'],
        [/(@digits)\.(@digits)([eE][\-+]?(@digits))?/, 'number.float'],
        [/0[xX](@hexdigits)n?/, 'number.hex'],
        [/0[oO]?(@octaldigits)n?/, 'number.octal'],
        [/0[bB](@binarydigits)n?/, 'number.binary'],
        [/(@digits)n?/, 'number'],
        [/[;,.]/, 'delimiter'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],
        [/`/, 'string', '@string_backtick']
      ],
      whitespace: [
        [/[ \t\r\n]+/, ''],
        [/\/\*\*(?!\/)/, 'comment.doc', '@jsdoc'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment']
      ],
      comment: [
        [/[^\/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[\/*]/, 'comment']
      ],
      jsdoc: [
        [/[^\/*]+/, 'comment.doc'],
        [/\*\//, 'comment.doc', '@pop'],
        [/[\/*]/, 'comment.doc']
      ],
      regexp: [
        [/(\{)(\d+(?:,\d*)?)(\})/, ['regexp.escape.control', 'regexp.escape.control', 'regexp.escape.control']],
        [/(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/, ['regexp.escape.control', { token: 'regexp.escape.control', next: '@regexrange' }]],
        [/(\()(\?:|\?=|\?!)/, ['regexp.escape.control', 'regexp.escape.control']],
        [/[()]/, 'regexp.escape.control'],
        [/@regexpctl/, 'regexp.escape.control'],
        [/[^\\\/]/, 'regexp'],
        [/@regexpesc/, 'regexp.escape'],
        [/\\\./, 'regexp.invalid'],
        [/(\/)([dgimsuy]*)/, [{ token: 'regexp', bracket: '@close', next: '@pop' }, 'keyword.other']]
      ],
      regexrange: [
        [/-/, 'regexp.escape.control'],
        [/\^/, 'regexp.invalid'],
        [/@regexpesc/, 'regexp.escape'],
        [/[^\]]/, 'regexp'],
        [/\]/, { token: 'regexp.escape.control', next: '@pop', bracket: '@close' }]
      ],
      string_double: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop']
      ],
      string_single: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, 'string', '@pop']
      ],
      string_backtick: [
        [/\$\{/, { token: 'delimiter.bracket', next: '@bracketCounting' }],
        [/[^\\`$]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/`/, 'string', '@pop']
      ],
      bracketCounting: [
        [/\{/, 'delimiter.bracket', '@bracketCounting'],
        [/\}/, 'delimiter.bracket', '@pop'],
        { include: 'common' }
      ],
      jsxTagOpen,
      jsxExpression
    }
  }
}

export function registerJSXSupport(m: typeof monaco): void {
  m.languages.setMonarchTokensProvider('typescript', buildTokenizer('typescript'))
  m.languages.setMonarchTokensProvider('javascript', buildTokenizer('javascript'))
}
