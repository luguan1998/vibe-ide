# Monaco 编辑器文件切换优化：Model 复用模式

## 核心思路

**一个编辑器实例 + 多个 Model，切换文件用 `setModel()`，绝不销毁重建编辑器。**

| 方式 | 切换耗时 | 说明 |
|------|----------|------|
| `setModel()` 切换 | ~5ms | 无 DOM 重建，瞬间完成 |
| 销毁重建编辑器 | 200-500ms | 严重卡顿，UI 闪烁 |

---

## 方案一：`path` prop（最简，@monaco-editor/react 自动管理）

`@monaco-editor/react` v4+ 提供 `path` prop，内部自动管理 Model 生命周期：

```jsx
<Editor
  path={currentFile.path}           // 切换 path → 自动切换/创建 model
  defaultLanguage={currentFile.lang}
  defaultValue={currentFile.content}
/>
```

### 内部工作原理

切换 `path` 时，库内部做的事：

```
useEffect(() => {
  const uri = monaco.Uri.parse(path);
  const existingModel = monaco.editor.getModel(uri);

  if (existingModel) {
    // 复用已有 model，不重新创建
    editor.setModel(existingModel);
  } else {
    // 馞次访问才创建新 model
    const newModel = monaco.editor.createModel(value, language, uri);
    editor.setModel(newModel);
  }
}, [path]);
```

**关键：** 旧 model 不会被销毁，留在 Monaco 全局 model store 中，下次切回来直接复用。但也意味着——**必须手动 dispose 已关闭 tab 的 model**，否则 `monaco.editor.getModels()` 无限增长。

### `defaultValue` vs `value`

| Prop | 行为 | 适用场景 |
|------|------|----------|
| `defaultValue` | 仅在首次创建 model 时使用，后续切换回同 path 时忽略变更 | 不可变内容（git diff 原始文件） |
| `value` | 每次 prop 变化都同步 model 内容 | 实时编辑，内容可能被外部更新 |

---

## 方案二：手动 Model 管理（精细控制）

适合需要 LRU 淘汰、ViewState 保存、与项目 session 状态深度集成等场景。

### 基础模式

```tsx
const editorRef = useRef(null);
const modelsRef = useRef(new Map());      // path → model
const viewStatesRef = useRef(new Map());  // path → ViewState

function handleMount(editor, monaco) {
  editorRef.current = editor;
  const uri = monaco.Uri.parse(`file:///${activeFile.path}`);
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(activeFile.content, activeFile.lang, uri);
  }
  modelsRef.current.set(activeFile.path, model);
  editor.setModel(model);
}

// 切换文件
function switchFile(filePath, content, lang) {
  const editor = editorRef.current;

  // 保存当前 viewState（光标、滚动、折叠）
  const current = editor.getModel();
  if (current) viewStatesRef.current.set(current.uri.path, editor.saveViewState());

  // 创建或复用 model
  const uri = monaco.Uri.parse(`file:///${filePath}`);
  let model = monaco.editor.getModel(uri);  // 先查已有
  if (!model) {
    model = monaco.editor.createModel(content, lang, uri);
    modelsRef.current.set(filePath, model);
  }

  editor.setModel(model);
  // 恢复 viewState
  const saved = viewStatesRef.current.get(filePath);
  if (saved) editor.restoreViewState(saved);
  editor.focus();
}

// 关闭文件 → dispose model 防内存泄漏
function closeFile(filePath) {
  modelsRef.current.get(filePath)?.dispose();
  modelsRef.current.delete(filePath);
  viewStatesRef.current.delete(filePath);
}
```

### LRU Model 池（打开 50+ 文件时防内存爆炸）

```typescript
const MAX_OPEN_MODELS = 50;
const modelCache = new Map<string, { model: ITextModel; lastAccess: number }>();

function switchFile(path: string, content: string, lang: string) {
  // 检查已有
  const cached = modelCache.get(path);
  if (cached) {
    cached.lastAccess = Date.now();
    editor.setModel(cached.model);
    return;
  }

  // 超限 → 淘汰最旧（非 dirty 的）
  if (modelCache.size >= MAX_OPEN_MODELS) {
    const [evictPath, evictEntry] = [...modelCache.entries()]
      .filter(([_, e]) => !e.model.isDirty())  // 不淘汰有未保存修改的
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
    if (evictEntry) {
      evictEntry.model.dispose();
      modelCache.delete(evictPath);
    }
  }

  // 创建新 model
  const uri = monaco.Uri.parse(`file:///${path}`);
  let model = monaco.editor.getModel(uri);
  if (!model) model = monaco.editor.createModel(content, lang, uri);
  modelCache.set(path, { model, lastAccess: Date.now() });
  editor.setModel(model);
}
```

**dirty model 保护：** 有未保存修改的 model 不参与淘汰，避免丢失用户编辑。

---

## DiffEditor 切换文件方案

DiffEditor 也支持 `setModel()` 切换，无需重建编辑器实例：

```typescript
// 单例 DiffEditor
const diffEditor = monaco.editor.createDiffEditor(container, {
  renderSideBySide: true,
});

// 切换 diff 内容
const originalModel = monaco.editor.createModel(original, lang, origUri);
const modifiedModel = monaco.editor.createModel(modified, lang, modUri);
diffEditor.setModel({ original: originalModel, modified: modifiedModel });
```

### 已知坑：语言不同时残留旧装饰

从 `.ts` diff 切到 `.json` diff 时，直接 `setModel` 可能残留旧 diff 装饰：

```typescript
diffEditor.setModel(null);  // 先清空
diffEditor.setModel({ original: newOrig, modified: newMod });  // 再设置
```

### DiffEditor Model 缓存

```typescript
const diffModelCache = new Map<string, {
  original: ITextModel;
  modified: ITextModel;
}>();

function showDiff(fileKey: string, original: string, modified: string, lang: string) {
  const cached = diffModelCache.get(fileKey);
  if (cached) {
    cached.original.setValue(original);  // 同文件内容更新用 setValue，不重建
    cached.modified.setValue(modified);
    diffEditor.setModel({ original: cached.original, modified: cached.modified });
    return;
  }

  const origModel = monaco.editor.createModel(original, lang);
  const modModel = monaco.editor.createModel(modified, lang);
  diffModelCache.set(fileKey, { original: origModel, modified: modModel });
  diffEditor.setModel({ original: origModel, modified: modModel });
}

// 关闭 diff → dispose 两个 model
function closeDiff(fileKey: string) {
  const cached = diffModelCache.get(fileKey);
  if (cached) {
    cached.original.dispose();
    cached.modified.dispose();
    diffModelCache.delete(fileKey);
  }
}
```

---

## `model.setValue()` vs 新建 model

同一文件内容更新时，优先用 `model.setValue()`，避免 dispose+重建：

```typescript
// 同文件内容变了 → 用 setValue（保留 undo 历史）
const model = monaco.editor.getModel(uri);
if (model) {
  model.setValue(newContent);
} else {
  monaco.editor.createModel(newContent, lang, uri);
}
```

---

## ViewState 保存恢复完整模式

切换前保存，切回后恢复——光标位置、滚动、折叠范围、选区全部保留：

```typescript
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();

function switchFile(path: string) {
  // 保存当前
  const currentModel = editor.getModel();
  if (currentModel) {
    viewStates.set(currentModel.uri.toString(), editor.saveViewState());
  }

  // 切换
  editor.setModel(models[path]);

  // 恢复目标
  const saved = viewStates.get(path);
  if (saved) editor.restoreViewState(saved);
  editor.focus();
}
```

---

## 监控与调试

```typescript
// 查看当前存活 model 数量（排查内存泄漏）
monaco.editor.getModels().length;

// 强制清理所有非活跃 model
monaco.editor.getModels()
  .filter(m => m.uri.toString() !== currentUri)
  .forEach(m => m.dispose());

// 检查 model 是否 dirty（有未保存修改）
model.isDirty();
```

---

## 决策树：选哪种方案？

```
你的场景是什么？
│
├─ 简单文件 tab 切换，<20 个文件
│  → 方案一：path prop（自动管理，最省代码）
│
├─ 多 tab + 需要关闭时清理 + ViewState 保存
│  → 方案二：手动 Model 管理 + viewStates Map
│
├─ 50+ 文件频繁切换
│  → 方案二 + LRU 池（MAX_OPEN_MODELS=50）
│
├─ Diff 编辑器（git diff 等）
│  → DiffEditor.setModel() + 双 model 缓存
│
└─ 项目已有 session 独立架构（如 vibe-ide）
│  → 方案二，model/viewState 按 activeSessionId 隔离
```

---

## 参考

- [Monaco Editor Wiki](https://github.com/microsoft/monaco-editor/wiki) — Model 管理官方文档
- [@monaco-editor/react](https://github.com/suren-atoyan/monaco-react) — path prop 内部实现
- [VS Code EditorGroup](https://github.com/microsoft/vscode) — LRU 淘汰参考实现
- [Monaco #2234](https://github.com/microsoft/monaco-editor/issues/2234) — DiffEditor.setModel API
- [Monaco #3433](https://github.com/microsoft/monaco-editor/issues/3433) — DiffEditor 性能问题