# MD 渲染优化方向

## 双击编辑的代价

当前双击 code block 进入编辑态，需 Monaco editor 接管渲染。问题：
- 切换编辑/预览模式时 Monaco 实例创建销毁开销大
- 多 block 场景下每个独立 Monaco 实例内存叠加
- colorize（预览态）与 editor（编辑态）之间切换有闪烁

## Monaco 过重

`monaco.editor.colorize()` 对每个 code block 单独调用，问题：
- 多 block 页面（如长文档几十个代码块）并发 colorize 排队耗时
- 已用并发限制（MAX_CONCURRENT=2）缓解，但 Monaco 自身加载仍重
- 考虑方向：轻量 highlighter（Shiki/Prism）替代 Monaco colorize；或虚拟滚动只渲染可视区 block
