# 智能体笔记：ui-conversation 与 ui-sidebar-documentpreview 的客户端领域分层

Status: implemented

[English](2026-10-13-client-domain-contract-boundaries.md) | 中文

## Problem

`scripts/verify-client-domain-graph.ts` 在两个客户端插件包中报告了 25 处包内分层违规。这些违规是既有的——与上一发布逐字节一致，工作区干净。门禁只承认包子目录下顶层的 `contract/` 目录作为共享层；领域可以 import `contract/` 和自身文件，顶层非装配文件可以 import `contract/` 和顶层文件，但领域不得 import 兄弟领域。

- `packages/client/ui-conversation`：`skeleton/InputBar.tsx` 从兄弟领域 `input` import 了 `DraftEditor.tsx`、`view-binding.ts` 与 `resolveSubmitMode`。作曲视图与 Lexical 状态机运行时同处 `input/editor/`，于是 InputBar 所拥有的外壳所渲染的视图与它所驱动的状态机挤在同一个目录里。
- `packages/client/ui-sidebar-documentpreview`：`document/` 领域持有每个渲染器都需要的定义（`DocumentPreviewDefinition`、`DocumentLoadMode`、`DocumentContent`、`DocumentTextPage`、`DocumentPreviewProps`、`sidebar.right.tab.document` 槽位声明、`matchingDocumentPreviews`、`binaryDocumentPath`、后缀辅助函数与 `unviewableBinaryPath`）。每个渲染器领域（`code`、`html`、`image`、`markdown`、`pdf`、`text`）以及顶层所有者（`TextPreview.tsx`、`store.ts`、`face.ts`）都直接从 `document/` import 这些文件，此外 `TextPreview.tsx` 还 import 了 `text/lines.ts` 与 `text/index.ts` 的 `PLAIN_BODY_ID`。由于门禁把 `document/` 与 `text/` 视为领域而非契约，每一处这样的 import 都是违规。

## Decision

两个包现在通过把共享定义移入包顶层的 `contract/`、并把视图代码移入拥有它的领域，来满足分层要求。`verify-client-domain-graph.ts` 未新增任何豁免、允许清单条目或规则改动，行为、测试与槽位声明均未改变。

**ui-conversation。** 领域边界现在是视图与状态机之分。`skeleton/editor/` 持有 `DraftEditor.tsx`、`ComposerContentEditable.tsx`、`DecoratorPortals.tsx` 以及 `view-binding.ts`/`keymap.ts` 组合——即 `InputBar` 外壳拥有并通过其 effect 安装的作曲视图文件。`input/editor/` 保留状态机侧文件：`runtime.ts`（input 门面构造的每 Session `DraftEditorRuntime`）、`projection.ts`、`chip-node.tsx`、`ReferenceChip.tsx`、`claim-decor.ts`、`reference-activation.ts`、`span-map.ts` 与 `text-ref.ts`。`resolveSubmitMode` 移入 `contract/composer-submission.ts`，因为 `input` 状态机的键位映射与 `skeleton` 的输入条都要解析手势；其纯函数体逐字节不变。`ComposerSubmissionPolicy` 留在 `input/submission-policy.ts`——`apply` 装配与设置行是它仅有的调用方。面向编辑器的类型与提交类型留在 `contract/draft-editor.ts`、`contract/input.ts` 与 `contract/composer-submission.ts`。

**ui-sidebar-documentpreview。** 原 `document/` 领域成为该包的契约。`contract/document.ts` 持有键控的 `sidebar.right.tab.document` 槽位声明、`DocumentContent`、`DocumentTextPage`、`DocumentPreviewProps` 与 `documentTabInfoFactory`。`contract/registry.ts` 持有 `DocumentLoadMode`、`DocumentPreviewDefinition`、`matchingDocumentPreviews`、`binaryDocumentPath` 与 `DocumentPreviewRegistry`——即装配与所有者都读取的渲染器注册 API 与可观察快照。`contract/suffix.ts` 与 `contract/unviewable.ts` 持有注册表与所有者所查询的文件名后缀辅助函数和无渲染器二进制后缀清单。`contract/lines.ts` 持有 `TextPage`、`LoadedPage`、`linesOf`、`loadedPages`、`lastLineLoaded` 与 `scrollToLine`——纯文本渲染器与所有者滚动器共享的源码行辅助函数；`TextPage` 从 `store.ts` 迁来，`store.ts` 现在 import 它（store 为自身的公共入口再导出它）。`contract/plain-text.ts` 持有 `PLAIN_BODY_ID`，即纯文本渲染器的身份与所有者的回退键。渲染器领域以及顶层 `TextPreview.tsx`、`store.ts`、`face.ts` 只 import `contract/`。

## Related

通用规则与门禁由[Web 客户端架构笔记](2026-07-19-gui-web-client-architecture.zh.md)（`## Directory shape`）拥有；本笔记记录这两个包的具体落实，并不取代它。

## Alternatives considered

- **把违规路径加入门禁豁免。** 门禁是设计规则的可执行形式；豁免某条路径等于在它失效之处取消规则，而不是修正布局，下一位贡献者还会照抄这条豁免。
- **从 `contract/` 再导出领域文件。** 一个从领域再导出的 `contract/` 模块本身就是契约→领域的边，门禁会拒绝；契约必须自洽，因此定义只能移动而不能再导出。
- **保留 `document/` 领域并把 `TextPreview.tsx` 移入其中。** 那样能让注册表留在其消费者身旁，但 `TextPreview.tsx` 是 `text` 标签页类型的实体（与 `definition.ts`、`TextTitle.tsx` 同组），且读取每个渲染器的注册表，因此它是包级所有者而非 `document` 领域成员；顶层外壳改为经 `contract/` 读取注册表。
- **只把 `resolveSubmitMode` 移入契约，`DraftEditor`/`view-binding` 留在 `input/editor/`。** 这样能关闭三处违规，却仍留下 `skeleton` 因展示而 import `input` 领域，违背目录形态所编码的单向性；视图文件属于渲染它们的那个领域。
- **把 `TextPage` 移入 `contract/document.ts`。** 它是存储页而非文档内容契约，且 `lines.ts` 是它唯一的算法消费者；`contract/lines.ts` 是更贴切的归属。

## Consequences

门禁以退出码 0 通过且无新豁免，两个包的 `/client` 导出面、测试与槽位声明均未改变。代价是间接性：`ui-sidebar-documentpreview` 新增了一个含六个模块的 `contract/` 目录，追踪文档预览 API 的读者必须知道槽位声明、注册表、后缀辅助函数与行辅助函数都属契约而非领域代码。作为交换，新增一个渲染器领域只需 import `contract/`，而 `ui-conversation` 的作曲视图与状态机可以独立演进，不再出现视图对状态机的 import。
