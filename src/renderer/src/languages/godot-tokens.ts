import type * as monaco from 'monaco-editor'

function buildGdscriptTokenizer(): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: '',
    tokenPostfix: '.gdscript',

    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.bracket' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    keywords: [
      'if', 'elif', 'else', 'for', 'while', 'match', 'when', 'func', 'static',
      'class', 'class_name', 'extends', 'is', 'in', 'as', 'self', 'super',
      'return', 'break', 'continue', 'pass', 'await', 'yield', 'signal',
      'enum', 'const', 'var', 'setget', 'trait', 'new',
    ],

    builtins: [
      'print', 'push_error', 'push_warning', 'assert', 'load', 'preload',
      'typeof', 'is_instance_valid', 'instance_of', 'class_exists', 'len',
      'range', 'str', 'abs', 'acos', 'asin', 'atan', 'atan2', 'cos', 'sin',
      'tan', 'sqrt', 'pow', 'floor', 'ceil', 'round', 'clamp', 'lerp', 'min',
      'max', 'sign', 'fposmod', 'randomize', 'randi', 'randf', 'randfn',
      'int', 'float', 'bool', 'null', 'StringName', 'NodePath',
    ],

    constants: ['PI', 'TAU', 'E', 'INF', 'NAN'],

    operators: [
      '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
      '**=', '<<=', '>>=', '&=', '|=', '^=', ':=', '->', '=', '+', '-', '*',
      '/', '%', '**', '^', '&', '|', '<<', '>>', '~', '!', '<', '>', ':', '.',
    ],

    symbols: /[=><!~?&|+\-*\/%^:]+/,

    tokenizer: {
      root: [
        [/@[a-zA-Z_]\w*/, 'annotation'],
        [/\$[a-zA-Z_]\w*(\/[a-zA-Z_]\w*)+/, 'variable'],
        [/\$[a-zA-Z_]\w*/, 'variable'],
        [/&"/, 'string.escape', '@dblString'],
        [/%"/, 'string.escape', '@dblString'],
        [/"""/, 'string', '@tripleDbl'],
        [/'''/, 'string', '@tripleSgl'],
        [/"/, 'string.escape', '@dblString'],
        [/'/, 'string.escape', '@sglString'],
        [/#.*$/, 'comment'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[bB][01_]+/, 'number.binary'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/\d*\.\d+([eE][+\-]?\d+)?/, 'number.float'],
        [/\d+([eE][+\-]?\d+)?/, 'number'],
        [/[{}\[\]()]/, '@brackets'],
        [/@symbols/, { cases: { '@operators': 'operator', '@default': 'delimiter' } }],
        [/[,;]/, 'delimiter'],
        [/\s+/, 'white'],
        [/[A-Z][A-Za-z0-9_]*/, { cases: { '@constants': 'constant', '@default': 'type.identifier' } }],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'predefined',
            '@default': 'identifier',
          },
        }],
      ],

      tripleDbl: [
        [/[^"]+/, 'string'],
        [/"""/, 'string', '@popall'],
      ],

      tripleSgl: [
        [/[^']+/, 'string'],
        [/'''/, 'string', '@popall'],
      ],

      dblString: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string.escape', '@popall'],
      ],

      sglString: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string.escape', '@popall'],
      ],
    },
  }
}

function buildGdshaderTokenizer(): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: '',
    tokenPostfix: '.gdshader',

    keywords: [
      'shader_type', 'render_mode', 'uniform', 'varying', 'const', 'void',
      'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3',
      'mat4', 'sampler2D', 'samplerCube', 'ivec2', 'ivec3', 'ivec4', 'uvec2',
      'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
    ],

    builtins: [
      'texture', 'textureLod', 'textureProj', 'texelFetch', 'mix', 'clamp',
      'dot', 'cross', 'length', 'distance', 'normalize', 'reflect', 'refract',
      'pow', 'step', 'smoothstep', 'fract', 'mod', 'floor', 'ceil', 'round',
      'sin', 'cos', 'tan', 'radians', 'degrees', 'exp', 'log', 'sqrt',
      'inversesqrt', 'sign', 'abs', 'max', 'min', 'faceforward', 'transpose',
      'determinant', 'inverse', 'backbuffer_copy', 'texel_fetch',
    ],

    constants: ['PI', 'TAU', 'E', 'INF', 'NAN'],

    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@blockComment'],
        [/[^\w\s]/, 'delimiter'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/\d*\.\d+([eE][+\-]?\d+)?/, 'number.float'],
        [/\d+/, 'number'],
        [/[A-Z][A-Za-z0-9_]*/, { cases: { '@constants': 'constant', '@default': 'type.identifier' } }],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'predefined',
            '@default': 'identifier',
          },
        }],
      ],

      blockComment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  }
}

export function registerGodotSupport(m: typeof monaco): void {
  m.languages.register({ id: 'gdscript', extensions: ['.gd'] })
  m.languages.setMonarchTokensProvider('gdscript', buildGdscriptTokenizer())
  m.languages.register({ id: 'gdshader', extensions: ['.gdshader'] })
  m.languages.setMonarchTokensProvider('gdshader', buildGdshaderTokenizer())
  // 重复 register 同一 id 会合并扩展名，把 .tscn/.tres 复用内置 ini 高亮
  m.languages.register({ id: 'ini', extensions: ['.tscn', '.tres'] })
}
