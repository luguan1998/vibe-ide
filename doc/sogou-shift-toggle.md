# 搜狗 Shift 中英切换战败记录

**日期**: 2026-07-02 | **耗时**: ~3h | **结果**: 代码层无解,放弃

## 现象

搜狗输入法下,终端(xterm.js)里按 Shift 不切换中/英文,Shift 被"吃"。同 app 的普通输入框、Monaco 编辑器里 Shift 切换正常。Windows Terminal 也正常。

## 战败路径(4 招全败)

| # | 尝试 | 依据 | 实测结果 |
|---|---|---|---|
| 1 | CSS `width:1px;height:1px;left:0` | 怀疑 textarea `0×0`+视口外被搜狗 TSF 判无效 | 失败 |
| 2 | CSS `width:10px;opacity:0.01` | 加非零不透明度,搜狗或要求显著非零 | 失败 |
| 3 | CSS `opacity:1`+`color/background/caret:transparent`(模仿 Monaco `.inputarea`) | Monaco 就这么隐藏 textarea 且能工作 | 失败(computed 确认 `opacity:1 w:7px h:17px left:147px`,搜狗仍不切) |
| 4 | ARIA `role='textbox'`+`autocomplete='off'`+`aria-roledescription`+`aria-multiline='true'` | Monaco 有这些、xterm 没有 | 失败 |

## 已排除(别再查)

**JS 事件层干净** —— 运行时诊断实锤:
- Shift keydown + keyup 都正常到 `xterm-helper-textarea`,`preventDefault=false`,`composing=false`,`target=xterm-helper-textarea`
- 没有 capture 阶段 `stopImmediatePropagation` 吞 Shift

**xterm.js 源码不吞纯 Shift**:
- `CoreBrowserTerminal.ts:893` `if (!result.key) return true` —— 纯 Shift(keyCode 16)在 `evaluateKeyboardEvent` 落 default 分支,`result.key=undefined`,在此提前 return,**到不了 927 行的 `preventDefault`**
- `_keyUp`(`:950`)全程无 `preventDefault`;`957` `if (!wasModifierKeyOnlyEvent(ev)) focus()` —— modifier-only 不调 focus

**渲染层 capture handler 不拦纯 Shift**:
- `TerminalView.tsx:647` 的 `onKeyDown` —— 所有 `eventMatchesBinding` 对纯 Shift 返回 false,字母键检查要 `ctrlKey`,纯 Shift 不匹配
- `App.tsx:1157` 全局 keydown capture —— Alt 分支要求 `!e.shiftKey`,Escape 分支要求 `!e.shiftKey`,其余 `eventMatchesBinding` 对纯 Shift false;`1192` keyup `e.key !== 'Alt'` 直接 return

**主进程 `before-input-event`**(`index.ts:151`)只拦 `Ctrl`+`=`/`+`/`-`,纯 Shift 不命中

**`windowsMode: true` 是 no-op** —— xterm.js 6.1.0-beta 源码已不读该选项(grep 全仓只在 `InputHandler.ts:756` 注释里出现),新版改用 `vtExtensions.win32InputMode` + PTY 发 `\x1b[?9001h` 才生效。留着误导,可删

## 根因

搜狗 TSF 在 **native 层**对 xterm.js 这套隐藏 textarea 实现的硬性不兼容,不在 CSS/JS/ARIA 可达范围。

- **Windows Terminal 能**:原生 Win32,`WM_KEYDOWN/UP` 同步直送 IME,无中间抽象
- **Monaco 能**:隐藏 textarea,但实现细节恰好落在搜狗兼容窗口内(具体是哪个细节,对齐 CSS+ARIA 都够不到)
- **xterm.js 不能**:隐藏 textarea 落在兼容窗口外,且窗口边界不在我们能改的属性上

同类未解 issue:[vscode#112856](https://github.com/microsoft/vscode/issues/112856)、[tabby#4999](https://github.com/Eugeny/tabby/issues/4999)、[xtermjs#4486](https://github.com/xtermjs/xterm.js/issues/4486)

## 关键证据(供未来复用,不用重查)

xterm textarea 默认 CSS(`@xterm/xterm/css/xterm.css`):
```css
.xterm .xterm-helper-textarea {
  position: absolute; opacity: 0; left: -9999em; top: 0;
  width: 0; height: 0; z-index: -5; white-space: nowrap; overflow: hidden;
}
```

Monaco textarea CSS(`monaco-editor/.../textAreaHandler.css`):
```css
.monaco-editor .inputarea {
  position: absolute; color: transparent; background-color: transparent;
  z-index: -10; /* 不用 opacity:0,不移出视口 */
}
```

xterm textarea 创建属性(`CoreBrowserTerminal.ts:487-498`):`autocorrect/autocapitalize/spellcheck=off`、`tabIndex=0`、`aria-label`、`aria-multiline='false'`。composition 时 `:355-360` 用 inline `style.left/top/width/height` 移到光标位置 1 字符大小。

## 保底方案(给用户)

1. **改搜狗切换键**(最可靠):搜狗设置 → 属性 → 按键 → 中英切换,Shift 改 `Ctrl+.` 等
2. **终端内 `Ctrl+Space`**:系统级 IME 切换,不经搜狗 Shift 钩子
3. **换微软拼音**:对 xterm textarea 不敏感

## 教训

**别再试 CSS/ARIA 了。** 三路(JS 事件 / CSS 几何+opacity / ARIA)实锤堵死,搜狗的判定不在我们能改的任何属性上。要根治只能等 xterm.js 上游重构 textarea 输入架构,或换不依赖搜狗的 IME。下次遇到同类"某 IME 在 xterm 终端失效"先查是不是搜狗,是就直接走保底方案,别耗在代码层。
