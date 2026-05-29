import type * as monaco from 'monaco-editor'

// 修复 Monaco 内置 Python tokenizer 的 f-string 三引号 bug：
// f"{1,3} 匹配 f""" 后进入 fDblStringBody，但该状态遇到单个 " 就 pop，
// 导致 f"""...""" 的关闭引号被拆散，后两个 " 暴露在 root 中无法匹配。
// 解决：把 f'''/f""" 单独匹配，路由到专用 triple 状态，只在连续三个引号时关闭。

function buildPythonTokenizer(): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: '',
    tokenPostfix: '.python',

    keywords: [
      'False', 'None', 'True', '_', 'and', 'as', 'assert', 'async', 'await',
      'break', 'case', 'class', 'continue', 'def', 'del', 'elif', 'else',
      'except', 'exec', 'finally', 'for', 'from', 'global', 'if', 'import',
      'in', 'is', 'lambda', 'match', 'nonlocal', 'not', 'or', 'pass', 'print',
      'raise', 'return', 'try', 'type', 'while', 'with', 'yield',
      'int', 'float', 'long', 'complex', 'hex', 'abs', 'all', 'any', 'apply',
      'basestring', 'bin', 'bool', 'buffer', 'bytearray', 'callable', 'chr',
      'classmethod', 'cmp', 'coerce', 'compile', 'complex', 'delattr', 'dict',
      'dir', 'divmod', 'enumerate', 'eval', 'execfile', 'file', 'filter',
      'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help',
      'id', 'input', 'intern', 'isinstance', 'issubclass', 'iter', 'len',
      'locals', 'list', 'map', 'max', 'memoryview', 'min', 'next', 'object',
      'oct', 'open', 'ord', 'pow', 'print', 'property', 'reversed', 'range',
      'raw_input', 'reduce', 'reload', 'repr', 'reversed', 'round', 'self',
      'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum',
      'super', 'tuple', 'type', 'unichr', 'unicode', 'vars', 'xrange', 'zip',
      '__dict__', '__methods__', '__members__', '__class__', '__bases__',
      '__name__', '__mro__', '__subclasses__', '__init__', '__import__',
    ],

    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.bracket' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    tokenizer: {
      root: [
        { include: '@whitespace' },
        { include: '@numbers' },
        { include: '@strings' },
        [/[,:;]/, 'delimiter'],
        [/[{}\[\]()]/, '@brackets'],
        [/@[a-zA-Z_]\w*/, 'tag'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
      ],

      whitespace: [
        [/\s+/, 'white'],
        [/(^#.*$)/, 'comment'],
        [/'''/, 'string', '@endDocString'],
        [/"""/, 'string', '@endDblDocString'],
      ],

      endDocString: [
        [/[^']+/, 'string'],
        [/\\'/, 'string'],
        [/'''/, 'string', '@popall'],
        [/'/, 'string'],
      ],

      endDblDocString: [
        [/[^"]+/, 'string'],
        [/\\"/, 'string'],
        [/"""/, 'string', '@popall'],
        [/"/, 'string'],
      ],

      numbers: [
        [/-?0x([abcdef]|[ABCDEF]|\d)+[lL]?/, 'number.hex'],
        [/-?(\d*\.)?\d+([eE][+\-]?\d+)?[jJ]?[lL]?/, 'number'],
      ],

      // 修复点：将 f'{1,3} / f"{1,3} 拆成 f'''/f""" 和 f'/f" 两条规则，
      // 三引号版本进入专用的 triple 状态，只在连续三个引号时关闭。
      strings: [
        [/'$/, 'string.escape', '@popall'],
        [/f'''/, 'string.escape', '@fTripleStringBody'],
        [/f'/, 'string.escape', '@fStringBody'],
        [/'/, 'string.escape', '@stringBody'],
        [/"$/, 'string.escape', '@popall'],
        [/f"""/, 'string.escape', '@fTripleDblStringBody'],
        [/f"/, 'string.escape', '@fDblStringBody'],
        [/"/, 'string.escape', '@dblStringBody'],
      ],

      // f'...'  单引号 f-string
      fStringBody: [
        [/[^\\'\{\}]+$/, 'string', '@popall'],
        [/[^\\'\{\}]+/, 'string'],
        [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
        [/\\./, 'string'],
        [/'/, 'string.escape', '@popall'],
        [/\\$/, 'string'],
      ],

      // f'''...'''  三单引号 f-string — 单/双引号不过早关闭
      fTripleStringBody: [
        [/[^\\'\{\}]+/, 'string'],
        [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
        [/\\./, 'string'],
        [/'''/, 'string.escape', '@popall'],
        [/'/, 'string'],
        [/\\$/, 'string'],
      ],

      stringBody: [
        [/[^\\']+$/, 'string', '@popall'],
        [/[^\\']+/, 'string'],
        [/\\./, 'string'],
        [/'/, 'string.escape', '@popall'],
        [/\\$/, 'string'],
      ],

      // f"..."  单双引号 f-string
      fDblStringBody: [
        [/[^\\"\{\}]+$/, 'string', '@popall'],
        [/[^\\"\{\}]+/, 'string'],
        [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
        [/\\./, 'string'],
        [/"/, 'string.escape', '@popall'],
        [/\\$/, 'string'],
      ],

      // f"""..."""  三双引号 f-string — 单/双引号不过早关闭
      fTripleDblStringBody: [
        [/[^\\"\{\}]+/, 'string'],
        [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
        [/\\./, 'string'],
        [/"""/, 'string.escape', '@popall'],
        [/"/, 'string'],
        [/\\$/, 'string'],
      ],

      dblStringBody: [
        [/[^\\"]+$/, 'string', '@popall'],
        [/[^\\"]+/, 'string'],
        [/\\./, 'string'],
        [/"/, 'string.escape', '@popall'],
        [/\\$/, 'string'],
      ],

      fStringDetail: [
        [/[:][^}]+/, 'string'],
        [/[!][ars]/, 'string'],
        [/=/, 'string'],
        [/\}/, 'identifier', '@pop'],
      ],
    },
  }
}

export function registerPythonSupport(m: typeof monaco): void {
  m.languages.setMonarchTokensProvider('python', buildPythonTokenizer())
}
