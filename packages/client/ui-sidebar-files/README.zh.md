---
description: "dsh Web 客户端右侧 Sidebar 的文件树 tab 类型：通过网络逐层列出会话工作区根目录，支持创建、重命名与删除，并按资源地址把文件打开到 Sidebar。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

[English](README.md) | 中文

## 概述

右侧 Sidebar 的导航器 tab 类型：把会话的工作区根目录画成一棵树，逐层经线上列出，并以菜单经同一宿主能力创建、重命名与删除条目，同时把文件打开到 Sidebar 里。它是从引导页进入的页类型，不认领任何地址；它按地址打开文件，交给 `dsh-resource://file` 的查看器认领：`ui-sidebar-right` 里没有任何东西认识本包。

## 目录

- [注册了什么](#what-it-registers)
- [树](#the-tree)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

- **类型**：`ctx.sidebarRightTabs.register(...)`，kind 为 `files`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-files`，档位 `builtin`，没有 patterns，另有一个打开该类型的引导页入口（order 10，标题与描述取自 `sidebarFiles` 命名空间，图标是共享的文件夹图标）。
- **正文**：以该 id 为键的 `sidebar.right.pane.tab` slot：strip 下的一行标题行，然后是树。标题行与文档预览（`ui-sidebar-documentpreview`）的相同：根路径，目录部分灰色、最后一段正色，从不省略号截断（比行宽的路径保留末尾、淡出开头），右端是新建条目控件与重新读取。这一行是复制而非共享，因为插件 bundle 只经平台模块共享运行时代码；待 artifact 与各 slot 的形态定下来后，可以在 `ui-primitives` 放一份供每个 pane 标题行使用。
- **标签页标题**：以该 id 为键的 `sidebar.right.pane.tab.title` slot：类型标签前的一枚 16px 共享 `FileTypeIcon` 文件夹图标。树本身的行不画这枚图标。

`src/client/` 下七个源文件：`definition.tsx`（类型是什么）、`store.ts`（它保存什么）、`face.ts`（它如何列目录，含 Remote 绑定）、`FilesBody.tsx`（它画什么，含排序与失败行两个辅助函数）、`FilesTitle.tsx`（标签页标题）、`locales.ts`（它说什么）、`index.ts`（接线）。

<a id="the-tree"></a>
## 树

根是会话的工作目录，读自 `useSessions().byId[sessionId].cwd`，标题行里的拆分由 `@deepseek-ai/dsh-util-workspace-path` 的 `pathPartsOf` 给出。每一层以绝对路径为键；子路径是父路径以 `/` 拼上条目名。一层在首次展开时经 `@deepseek-ai/dsh-api-workspace-files` 命名空间的 `remote.workspaceFiles.list(sessionId, absolutePath)` 列出；适配器保留列表的条目与截断标志，丢弃其工作区相对路径。行序为目录优先，其后按自然序、不分大小写的名称排列；dotfiles 与其他条目一样显示。

| 条目类型 | 行 |
|---|---|
| `directory` | 切换展开与折叠；该层在首次打开时拉取，折叠期间保留。 |
| `file` | 经 `useTabInfo().tab.actions.openResource` 打开 `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>`，地址由 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor` 从条目的绝对路径与树的根生成，落在该 tab 自己的 pane 里。 |
| `other` | 灰显且不可点击，从而完整呈现目录内容。 |

被端点条目上限截断的层以一条标记收尾；空层如实说明；失败的层按错误码各显示一行（`workspace-file/not-found`、`outside-workspace`、`not-directory`），其他情况显示传输层自己的消息。重新读取丢弃所有已列出的层并只对展开中的层重新请求；折叠的层在下次打开时重新拉取。没有工作目录的会话只显示一行说明，而不是树。

### 修改

标题行的新建条目控件在根目录中创建；每一行的更多操作控件打开一个菜单：目录行先是同样两个创建手势，然后是重命名与删除。创建与重命名打开一个带名称输入框的对话框，其确认按钮在名称不是单个非空路径段前一直禁用；删除打开一个确认框，点名该条目，对目录还提供一个"连同其中内容一起删除"的复选框。正文从不猜测结果：`create`、`rename` 与 `remove` 都经 face，由它调用 `@deepseek-ai/dsh-api-workspace-files` 命名空间的 `createFile` / `createDirectory` / `move` / `remove`，成功时从存储中丢弃被改动条目的子树，并再次从宿主列出其父层。被拒绝的调用什么也不写，并作为每个错误码一行本地化文字留在对话框里（`already-exists`、`directory-not-empty`、`root-refused`、`symlink-refused`、`bad-target`、`unsupported-backend`、`too-large`，其他情况显示传输层自己的消息）。

状态保存在类型自己的存储里，按 tab id 分桶：`root`、`levels`（每个绝对路径的 loading / ready / failed）、`expanded` 与 `scrollTop`——滚动期间偏移由正文自己记录，卸载时一次性写入。存储比 body 活得久，切到其他侧栏 tab 再切回来时树带着已加载的层重新挂载，滚动位置也随之恢复。owner 的 `signal` 终结一个桶：中止时忘掉该 tab，其后才结算的列表与卸载时的偏移提交都什么也不写。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制工作区文件树，不注册任何面向模型的内容。

#### KV Cache 影响

无；目录列表经 Remote 传输，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **只有列目录，没有搜索与监听。**没有搜索、产物过滤、拖拽或文件系统监听；一层只会因一次修改或重新读取而变化。
- **只有一个根。**树以会话工作目录为根；没有办法浏览到它之上，而 Host 本来也拒绝工作区根之外的路径。
- **创建只针对目录，不针对文件。**新建手势位于标题行（根）与目录行上；文件行只提供重命名与删除。
- **删除是一次确认，不是撤销。**删除条目只确认一次，在树里无法撤销；删除非空目录需要勾选对话框里的复选框。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion。树唯一的运行时状态是每 tab 一份的 Slot store，由持有它的正文写入、随 tab 的中止信号忘掉；没有第二个观测源可与之比对。
