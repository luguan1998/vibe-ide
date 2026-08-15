import { BrowseDirectoryFlow } from "./flow.js";
/** Locale namespace owning the browser dialog's copy. */
const LOCALE_NS = 'directory-browser';
/** Required services (cordis fiber inject): the slot registry, the wire-facing workspace service, and locale. */
export const inject = ['slots', 'workspaces', 'locale'];
/**
 * Client plugin body: register the dialog's dictionaries and the browse flow
 * into both directory-flow holes through `slots.inject()` because the
 * ui-workspace entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => {
        // The two dictionaries land as a unit: if the second registration hits a
        // rival owner of the namespace, the first rolls back before the throw —
        // a failed activation must not squat the namespace's other locale.
        const disposers = [];
        const dictionaries = [
            ['zh', {
                    'browser.title': '选择工作区目录',
                    'browser.home': '主目录',
                    'browser.newFolder': '新建文件夹',
                    'browser.folderName': '文件夹名称',
                    'browser.createIn': '在"{name}"中新建文件夹',
                    'browser.untitledFolder': '未命名文件夹',
                    'browser.create': '创建',
                    'browser.cancel': '取消',
                    'browser.open': '打开',
                    'browser.editPath': '编辑路径',
                    'browser.loading': '加载中…',
                    'browser.truncated': '文件夹过多，仅显示开头部分。',
                    'browser.showHidden': '显示隐藏文件',
                }],
            ['en', {
                    'browser.title': 'Select Workspace Directory',
                    'browser.home': 'Home',
                    'browser.newFolder': 'New folder',
                    'browser.folderName': 'Folder name',
                    'browser.createIn': 'New folder in "{name}"',
                    'browser.untitledFolder': 'Untitled folder',
                    'browser.create': 'Create',
                    'browser.cancel': 'Cancel',
                    'browser.open': 'Open',
                    'browser.editPath': 'Edit path',
                    'browser.loading': 'Loading…',
                    'browser.truncated': 'Too many folders to list; only the beginning is shown.',
                    'browser.showHidden': 'Show hidden files',
                }],
        ];
        try {
            for (const [locale, dict] of dictionaries)
                disposers.push(ctx.locale.register(LOCALE_NS, locale, dict));
        }
        catch (error) {
            for (const dispose of disposers.reverse())
                dispose();
            throw error;
        }
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'directory-picker-browse: dialog dictionaries');
    const injected = () => ({
        listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
        createDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
        t: ctx.locale.bind(LOCALE_NS),
    });
    // Both declaration lifetimes must be live before the pair installs; the
    // generator makes the two registrations one transactional effect. The
    // outer/inner nesting order is arbitrary; neither hole has precedence.
    ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield ctx.slots.register({
            name: 'conversation.hero.workspace.directoryFlow', inject: injected,
        }, BrowseDirectoryFlow);
        yield ctx.slots.register({
            name: 'sidebar.workspaces.directoryFlow', inject: injected,
        }, BrowseDirectoryFlow);
    }));
}
//# sourceMappingURL=index.js.map