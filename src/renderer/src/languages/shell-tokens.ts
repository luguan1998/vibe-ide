import type * as monaco from 'monaco-editor'

function buildShellTokenizer(): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: '',
    ignoreCase: true,
    tokenPostfix: '.shell',

    brackets: [
      { token: 'delimiter.bracket', open: '{', close: '}' },
      { token: 'delimiter.parenthesis', open: '(', close: ')' },
      { token: 'delimiter.square', open: '[', close: ']' }
    ],

    keywords: [
      'if', 'then', 'else', 'elif', 'fi',
      'case', 'esac', 'select',
      'while', 'until', 'for', 'do', 'done',
      'function',
      'time', 'coproc',
      'in',
      'return', 'exit',
      'declare', 'typeset', 'local', 'readonly', 'export',
      'alias', 'unalias',
      'set', 'unset',
    ],

    builtins: [
      'ab', 'awk', 'bash', 'beep', 'cat', 'cc', 'cd', 'chown', 'chmod',
      'chroot', 'clear', 'cp', 'curl', 'cut', 'diff', 'echo', 'find', 'gawk',
      'gcc', 'get', 'git', 'grep', 'hg', 'kill', 'killall', 'ln', 'ls',
      'make', 'mkdir', 'openssl', 'mv', 'nc', 'node', 'npm', 'ping', 'ps',
      'restart', 'rm', 'rmdir', 'sed', 'service', 'sh', 'shopt', 'shred',
      'source', 'sort', 'sleep', 'ssh', 'start', 'stop', 'su', 'sudo',
      'svn', 'tee', 'telnet', 'top', 'touch', 'vi', 'vim', 'wall', 'wc',
      'wget', 'who', 'write', 'yes', 'zsh',
      'bind', 'builtin', 'caller', 'command', 'compgen', 'complete', 'compopt',
      'continue', 'dirs', 'disown', 'enable', 'eval', 'exec', 'getopts',
      'hash', 'help', 'history', 'jobs', 'let', 'logout', 'mapfile', 'popd',
      'printf', 'pushd', 'pwd', 'read', 'readarray', 'shift', 'suspend',
      'test', 'times', 'trap', 'type', 'ulimit', 'umask', 'wait',
      'break',
    ],

    symbols: /[=><!~?&|+\-*\/\^;\.,]+/,

    tokenizer: {
      root: [
        [/(\s)((?:-{1,2})\w[\w-]*)/, ['white', 'attribute.name']],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@builtins': 'type.identifier',
              '@default': ''
            }
          }
        ],
        { include: '@whitespace' },
        { include: '@strings' },
        { include: '@parameters' },
        { include: '@heredoc' },
        [/[{}\[\]()]/, '@brackets'],
        [/@symbols/, 'delimiter'],
        { include: '@numbers' },
        [/[,;]/, 'delimiter']
      ],
      whitespace: [
        [/\s+/, 'white'],
        [/(^#!.*$)/, 'metatag'],
        [/(^#.*$)/, 'comment']
      ],
      numbers: [
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F_]*[0-9a-fA-F]/, 'number.hex'],
        [/\d+/, 'number']
      ],
      strings: [
        [/'/, 'string', '@stringBody'],
        [/"/, 'string', '@dblStringBody']
      ],
      stringBody: [
        [/'/, 'string', '@popall'],
        [/./, 'string']
      ],
      dblStringBody: [
        [/"/, 'string', '@popall'],
        [/./, 'string']
      ],
      heredoc: [
        [
          /(<<[-<]?)(\s*)(['"`]?)([\w\-]+)(['"`]?)/,
          [
            'constants',
            'white',
            'string.heredoc.delimiter',
            'string.heredoc',
            'string.heredoc.delimiter'
          ]
        ]
      ],
      parameters: [
        [/\$\d+/, 'variable.predefined'],
        [/\$\w+/, 'variable'],
        [/\$[*@#?\-$!0_]/, 'variable'],
        [/\$'/, 'variable', '@parameterBodyQuote'],
        [/\$"/, 'variable', '@parameterBodyDoubleQuote'],
        [/\$\(/, 'variable', '@parameterBodyParen'],
        [/\$\{/, 'variable', '@parameterBodyCurlyBrace']
      ],
      parameterBodyQuote: [
        [/[^#:%*@\-!_']+/, 'variable'],
        [/[#:%*@\-!_]/, 'delimiter'],
        [/'/, 'variable', '@pop']
      ],
      parameterBodyDoubleQuote: [
        [/[^#:%*@\-!_"]+/, 'variable'],
        [/[#:%*@\-!_]/, 'delimiter'],
        [/"/, 'variable', '@pop']
      ],
      parameterBodyParen: [
        [/[^#:%*@\-!_)]+/, 'variable'],
        [/[#:%*@\-!_]/, 'delimiter'],
        [/[)]/, 'variable', '@pop']
      ],
      parameterBodyCurlyBrace: [
        [/[^#:%*@\-!_}]+/, 'variable'],
        [/[#:%*@\-!_]/, 'delimiter'],
        [/[}]/, 'variable', '@pop']
      ]
    }
  }
}

export function registerShellSupport(m: typeof monaco): void {
  m.languages.setMonarchTokensProvider('shell', buildShellTokenizer())
}
