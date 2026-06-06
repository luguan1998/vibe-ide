## Gutter DOM 结构总览

```
div.gutter.monaco-editor                    ← DiffEditorGutter 根容器
├── div.scroll-decoration                   ← 滚动阴影装饰
└── div  (per-hunk wrapper, 每个 diff hunk 一个)
    └── div.gutterItem                      ← DiffToolBar 根节点
        ├── div.background                  ← 竖向分隔线
        └── div.buttons                     ← 工具栏按钮区
            └── div.monaco-toolbar
                └── div.monaco-action-bar
                    └── div.actions-container
                        └── div.action-item (×N)
```

---

## 各元素详细说明

### 1. `div.gutter.monaco-editor` — Gutter 根容器

由 `DiffEditorGutter` 构造函数创建，固定宽度 **35px**，`position: absolute`，覆盖编辑器全高。

- 通过 `prependRemoveOnDispose` **prepend** 到 `div.monaco-diff-editor.side-by-side` 最前面。
- 只有当 `MenuId.DiffEditorHunkToolbar` 菜单有 actions 时才显示（`display: block`），否则隐藏（`display: none`）。
- `left` 值由 `DiffEditorGutter.layout(left)` 动态设置，跟随 sash 位置。 [1](#1-0) [2](#1-1) 

---

### 2. `div.scroll-decoration` — 滚动阴影装饰

由 `EditorGutter` 构造函数 append 到 gutter 根节点。

- 当编辑器 `scrollTop > 0` 时，class 切换为 `scroll-decoration`，显示顶部阴影，提示用户内容已滚动。
- 平时 class 为空（无样式）。 [3](#1-2) 

---

### 3. `div`（per-hunk wrapper）— 每个 diff hunk 的定位容器

由 `EditorGutter.render()` 动态创建，每个可见的 `DiffGutterItem`（即一个 diff hunk）对应一个。

- `position: absolute`，`top` / `height` 根据 modified 编辑器中对应行的像素位置实时计算并设置。
- 随编辑器滚动实时更新位置。
- 不可见的 hunk 对应的节点会被销毁（`DisposableMap` 管理）。 [4](#1-3) 

---

### 4. `div.gutterItem` — 单个 hunk 工具栏容器

由 `DiffToolBar` 创建，固定尺寸 `height: 20px; width: 34px`。

**可见性逻辑（opacity 动画）：**

| 状态 | opacity | transition |
|---|---|---|
| 默认 | `0`（隐藏） | `0.7s` 渐出 |
| `.showAlways`（当前光标所在 hunk 或有选区） | `1` | `none` |
| `.noTransition`（切换瞬间） | — | `none` |
| gutter hover | `1` | `0.1s ease-in-out` | [5](#1-4) [6](#1-5) 

---

### 5. `div.background` — 竖向分隔线（**蓝线来源之一**）

`gutterItem` 内的第一个子元素，纯视觉装饰。

```css
.gutterItem .background {
    position: absolute;
    height: 100%;
    left: 50%;       /* 居中于 gutterItem */
    width: 1px;
    border-left: 2px var(--vscode-menu-separatorBackground) solid;
}
```

- 颜色取决于 `menu.separatorBackground` token，通常是灰色，但某些主题下可能偏蓝。
- 随 `gutterItem` 的 opacity 一起淡入淡出。 [7](#1-6) [8](#1-7) 

---

### 6. `div.buttons` — 工具栏按钮区

`gutterItem` 内的第二个子元素，承载 `MenuWorkbenchToolBar`。

- `top` 由 `DiffToolBar.layout()` 动态计算，使按钮尽量垂直居中于 hunk 范围内，同时保持在视口内可见。
- 菜单 ID 根据场景切换：
  - 普通 hunk → `MenuId.DiffEditorHunkToolbar`
  - 有选区时 → `MenuId.DiffEditorSelectionToolbar`
- `overflowBehavior.maxItems`：hunk 较小（起始行为第 1 行且高度 < 30px）时最多显示 **1** 个按钮，否则最多 **3** 个。

```css
.actions-container {
    border-radius: 4px;
    background: var(--vscode-editorGutter-itemBackground);
}
.action-label {
    color: var(--vscode-editorGutter-itemGlyphForeground);
    padding: 1px 2px;
}
``` [9](#1-8) [10](#1-9) [11](#1-10)

### Citations

**File:** src/vs/editor/browser/widget/diffEditor/features/gutterFeature.ts (L63-64)
```typescript
		this.width = derived(this, reader => this._hasActions.read(reader) ? width : 0);
		this.elements = h('div.gutter@gutter', { style: { position: 'absolute', height: '100%', width: width + 'px' } }, []);
```

**File:** src/vs/editor/browser/widget/diffEditor/features/gutterFeature.ts (L102-108)
```typescript
		this._register(prependRemoveOnDispose(diffEditorRoot, this.elements.root));

		this._register(addDisposableListener(this.elements.root, 'click', () => {
			this._editors.modified.focus();
		}));

		this._register(applyStyle(this.elements.root, { display: this._hasActions.map(a => a ? 'block' : 'none') }));
```

**File:** src/vs/editor/browser/widget/diffEditor/features/gutterFeature.ts (L222-248)
```typescript
		this._elements = h('div.gutterItem', { style: { height: '20px', width: '34px' } }, [
			h('div.background@background', {}, []),
			h('div.buttons@buttons', {}, []),
		]);
		this._showAlways = this._item.map(this, item => item.showAlways);
		this._menuId = this._item.map(this, item => item.menuId);
		this._isSmall = observableValue(this, false);
		this._lastItemRange = undefined;
		this._lastViewRange = undefined;

		const hoverDelegate = this._register(instantiationService.createInstance(
			WorkbenchHoverDelegate,
			'element',
			{ instantHover: true },
			{ position: { hoverPosition: HoverPosition.RIGHT } }
		));

		this._register(appendRemoveOnDispose(target, this._elements.root));

		this._register(autorun(reader => {
			/** @description update showAlways */
			const showAlways = this._showAlways.read(reader);
			this._elements.root.classList.toggle('noTransition', true);
			this._elements.root.classList.toggle('showAlways', showAlways);
			setTimeout(() => {
				this._elements.root.classList.toggle('noTransition', false);
			}, 0);
```

**File:** src/vs/editor/browser/widget/diffEditor/features/gutterFeature.ts (L252-281)
```typescript
		this._register(autorunWithStore((reader, store) => {
			this._elements.buttons.replaceChildren();
			const i = store.add(instantiationService.createInstance(MenuWorkbenchToolBar, this._elements.buttons, this._menuId.read(reader), {
				orientation: ActionsOrientation.VERTICAL,
				hoverDelegate,
				toolbarOptions: {
					primaryGroup: g => g.startsWith('primary'),
				},
				overflowBehavior: { maxItems: this._isSmall.read(reader) ? 1 : 3 },
				hiddenItemStrategy: HiddenItemStrategy.Ignore,
				actionRunner: store.add(new ActionRunnerWithContext(() => {
					const item = this._item.read(undefined);
					const mapping = item.mapping;
					return {
						mapping,
						originalWithModifiedChanges: gutter.computeStagedValue(mapping),
						originalUri: item.originalUri,
						modifiedUri: item.modifiedUri,
					} satisfies DiffEditorSelectionHunkToolbarContext;
				})),
				menuOptions: {
					shouldForwardArgs: true,
				},
			}));
			store.add(i.onDidChangeMenuItems(() => {
				if (this._lastItemRange) {
					this.layout(this._lastItemRange, this._lastViewRange!);
				}
			}));
		}));
```

**File:** src/vs/editor/browser/widget/diffEditor/features/gutterFeature.ts (L287-317)
```typescript
	layout(itemRange: OffsetRange, viewRange: OffsetRange): void {
		this._lastItemRange = itemRange;
		this._lastViewRange = viewRange;

		let itemHeight = this._elements.buttons.clientHeight;
		this._isSmall.set(this._item.get().mapping.original.startLineNumber === 1 && itemRange.length < 30, undefined);
		// Item might have changed
		itemHeight = this._elements.buttons.clientHeight;

		const middleHeight = itemRange.length / 2 - itemHeight / 2;

		const margin = itemHeight;

		let effectiveCheckboxTop = itemRange.start + middleHeight;

		const preferredViewPortRange = OffsetRange.tryCreate(
			margin,
			viewRange.endExclusive - margin - itemHeight
		);

		const preferredParentRange = OffsetRange.tryCreate(
			itemRange.start + margin,
			itemRange.endExclusive - itemHeight - margin
		);

		if (preferredParentRange && preferredViewPortRange && preferredParentRange.start < preferredParentRange.endExclusive) {
			effectiveCheckboxTop = preferredViewPortRange.clip(effectiveCheckboxTop);
			effectiveCheckboxTop = preferredParentRange.clip(effectiveCheckboxTop);
		}

		this._elements.buttons.style.top = `${effectiveCheckboxTop - itemRange.start}px`;
```

**File:** src/vs/editor/browser/widget/diffEditor/utils/editorGutter.ts (L42-58)
```typescript
		const scrollDecoration = this._domNode.appendChild(
			h('div.scroll-decoration', { role: 'presentation', ariaHidden: 'true', style: { width: '100%' } })
				.root
		);

		const o = new ResizeObserver(() => {
			transaction(tx => {
				/** @description ResizeObserver: size changed */
				this.domNodeSizeChanged.trigger(tx);
			});
		});
		o.observe(this._domNode);
		this._register(toDisposable(() => o.disconnect()));

		this._register(autorun(reader => {
			/** @description update scroll decoration */
			scrollDecoration.className = this.isScrollTopZero.read(reader) ? '' : 'scroll-decoration';
```

**File:** src/vs/editor/browser/widget/diffEditor/utils/editorGutter.ts (L111-139)
```typescript
							const viewDomNode = document.createElement('div');
							this._domNode.appendChild(viewDomNode);
							const gutterItemObs = observableValue('item', gutterItem);
							const itemView = this.itemProvider.createView(
								gutterItemObs,
								viewDomNode
							);
							view = new ManagedGutterItemView(gutterItemObs, itemView, viewDomNode);
							this.views.set(gutterItem.id, view);
						} else {
							view.item.set(gutterItem, tx);
						}

						const top =
							gutterItem.range.startLineNumber <= this._editor.getModel()!.getLineCount()
								? this._editor.getTopForLineNumber(gutterItem.range.startLineNumber, true) - scrollTop
								: gutterItem.range.startLineNumber > 1
									? this._editor.getBottomForLineNumber(gutterItem.range.startLineNumber - 1, false) - scrollTop
									: 0;
						const bottom =
							gutterItem.range.endLineNumberExclusive === 1 ?
								Math.max(top, this._editor.getTopForLineNumber(gutterItem.range.startLineNumber, false) - scrollTop)
								: Math.max(top, this._editor.getBottomForLineNumber(gutterItem.range.endLineNumberExclusive - 1, true) - scrollTop);

						const height = bottom - top;
						view.domNode.style.top = `${top}px`;
						view.domNode.style.height = `${height}px`;

						view.gutterItemView.layout(OffsetRange.ofStartAndLength(top, height), viewRange);
```

**File:** src/vs/editor/browser/widget/diffEditor/style.css (L339-356)
```css
	.gutterItem {
		opacity: 0;
		transition: opacity 0.7s;

		&.showAlways {
			opacity: 1;
			transition: none;
		}

		&.noTransition {
			transition: none;
		}
	}

	&:hover .gutterItem {
		opacity: 1;
		transition: opacity 0.1s ease-in-out;
	}
```

**File:** src/vs/editor/browser/widget/diffEditor/style.css (L358-366)
```css
	.gutterItem {
		.background {
			position: absolute;
			height: 100%;
			left: 50%;
			width: 1px;

			border-left: 2px var(--vscode-menu-separatorBackground) solid;
		}
```

**File:** src/vs/editor/browser/widget/diffEditor/style.css (L368-401)
```css
		.buttons {
			position: absolute;
			/*height: 100%;*/
			width: 100%;

			display: flex;
			justify-content: center;
			align-items: center;

			.monaco-toolbar {
				height: fit-content;
				.monaco-action-bar  {
					line-height: 1;

					.actions-container {
						width: fit-content;
						border-radius: 4px;
						background: var(--vscode-editorGutter-itemBackground);

						.action-item {
							&:hover {
								background: var(--vscode-toolbar-hoverBackground);
							}

							.action-label {
								color: var(--vscode-editorGutter-itemGlyphForeground);
								padding: 1px 2px;
							}
						}
					}
				}
			}
		}
	}
```
