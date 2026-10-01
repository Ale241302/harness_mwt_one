# Agent Note: generated files download without a Host desktop, and decks build as PPTX

Status: implemented

[English](2026-09-30-file-download-and-pptx-output.md) | 中文

## Problem

交付文件卡片（delivered-file cards）和本轮文件行（produced-files row）此前只能打开 Sidebar 预览，或请求 Host 桌面来打开/显示文件。在无桌面的部署（VPS Space）中不存在桌面，因此所有本机动作都被禁用，卡片显示 *This Host has no desktop available to open files or folders*，用户无法把文件保存到自己的机器上。另一方面，当模型被要求做一份 *presentación*（演示文稿）时，它只产出 SVG、HTML 和 Markdown 片段：随附目录里有 `frontend-slides`（HTML 演示）和 PPTX *提取器*，但没有任何写 PowerPoint 文件的能力，而镜像里既没有 `python-pptx`，也没有 SVG 光栅化工具。

## Decision

- `/api/file` 新增 `download` 查询参数。带上它时，同一条经认证、受字节上限约束的读取会返回 `Content-Disposition: attachment; filename="<路径最后一段>"`，其中控制字符和引号被替换为 `_`，路径没有分段时使用 `download`。不带该参数时响应保持不变。
- `packages/client/ui-deliverables/src/client/download.ts` 暴露 `downloadWorkspaceFile(cwd, path)`：它把路径按 Session 根解析，并点击一个指向 `/api/file?path=…&download=1` 的锚点，因此不会查询 Host 桌面。
- 交付文件卡片的操作菜单始终提供 **Download**；仅当 Host 报告存在桌面时才出现本机的 *Open in default app* 和文件管理器行。箭头按钮只在某个本机动作进行中时禁用。
- 本轮文件行为每个 chip 渲染一个尾部的保存控件，携带完整路径而非缩短后的名称。
- `DeliverablesInjected` 接口新增 `downloadFile(path, cwd)`，由插件的 `apply` 绑定。
- `packages/client/ui-sidebar-documentpreview/src/client/download.ts` 暴露 `downloadHostFile(absolutePath, name)`，一旦文件资源报告绝对路径，预览头部就显示保存控件。
- 文件工具行也获得同一动作：`ToolRow` 接受可选的 `onDownloadFile(path)`，`read`/`read_image`/`edit`/`write` 把它绑定到 `downloadWorkspaceFile(cwd, path)`，并由 `conversation` 字典中的 `row.download` 键为路径链接旁的控件提供标签。
- `SearchBlock` 接受可选的 `onDownload`，在每个文件头（`grep`）和路径行（`glob`）上渲染一个按结果保存的控件；`grep`/`glob` 行提供它，标签来自 `search.download`。
- 共享的图片灯箱（消息、轨迹与工具图库三条臂）增加一个指向原图 URL 的保存链接，标签来自 `image.download`，因此工具返回的图片可以从图库下载。
- `skills-shared/pptx-deck/` 随附一个共享技能和 `scripts/build_pptx.py`——一个仅用标准库的 OOXML 写入器（标题与项目符号幻灯片、可选的 PNG/JPEG/GIF 图片、16:9）。它让模型无需 `python-pptx` 或光栅化工具就能得到真正的 `.pptx`；对于更丰富的演示（备注、表格），技能在可导入时指向 `python-pptx`，在需要时把 HTML 演示交给 `frontend-slides`。每张幻灯片都带有 `slideLayout` 关系，包内带有 `docProps/core.xml` 与 `docProps/app.xml`，与 PowerPoint 生成的文件一致：Office 16 会对一个通过 schema 校验、却缺少 slide→layout 关系的包提示修复，而 Open XML SDK 校验器不会标记该问题。

## Alternatives considered

**在 `ui-deliverables` 中新增专用的 `GET /api/present.download` 路由。** 它可以复用 `present` 的 `sessionId`/`seq`/`index` 坐标，但本轮文件行和文档预览并不属于 `present` 声明，因此同一次保存还需要第二条路由。扩展既有的字节路由用一条授权路径覆盖全部三个界面。

**通过 `workspaceFiles.readAll` Remote 取回字节并保存为 Blob。** 它无需改动 Host，并在服务端解析相对路径，但会把整个文件以 base64 经网络传输，还需要对象 URL；锚点路由只传输一次字节，并让浏览器自行决定文件名。

**在镜像中打包 `python-pptx` 或 LibreOffice。** 两者都为一个技能改变部署镜像，而且 `python-pptx` 仍无法嵌入 SVG。标准库写入器消除了该依赖，并且始终产出有效文件。

## Consequences

- 每个生成的文件（SVG、HTML、Markdown、PPTX……）都可以从对话和预览中下载，无论 Host 是否有桌面。文件工具行（`read`/`read_image`/`edit`/`write`）下载其调用所指定的路径，`grep`/`glob` 卡片下载每个结果文件，图片灯箱下载原图。
- 下载路由沿用既有的字节上限（`attachments.imageLimits.maxImageBytes`，默认 20 MiB）和既有的沙箱读取权限；没有暴露新的东西。
- PPTX 写入器不支持演讲者备注和表格，且只能嵌入光栅图片；这些情形指向 `python-pptx` 或光栅化工具。
- `skills-shared/` 下的技能会在每个会话中可由模型调用；`skills-shared/ECC-LICENSE.txt` 现在把 `pptx-deck` 列为 owner 自有技能之一。

## Testing

`packages/api/session-controller/tests/media-references.host.spec.ts` 覆盖 GET 与 HEAD 的附件响应头、保持不变的内联响应、文件名净化，以及无分段时的回退。`packages/client/ui-deliverables/tests/download.client.spec.tsx` 覆盖相对路径与绝对路径的 URL 与解析；`presented-file-card.client.spec.tsx` 覆盖有桌面与无桌面时的保存行，以及三行的键盘顺序；`produced-files.client.spec.tsx` 覆盖每个 chip 的保存控件和 Deliverables 的接线。`packages/client/ui-sidebar-documentpreview/tests/download.client.spec.tsx` 和 `document-toolbar.client.spec.tsx` 覆盖预览控件及其在缺少绝对路径时的隐藏状态。`packages/client/ui-tool/tests/download.client.spec.tsx` 覆盖工具行辅助函数，`read-card.client.spec.tsx`、`diff-card.client.spec.tsx` 与 `search-card.client.spec.tsx` 覆盖 `read`、`edit` 与 `grep` 行上的保存控件。`packages/client/ui-primitives/tests/search-block.client.spec.tsx` 覆盖按结果的控件及其缺省情况，`packages/client/ui-attachment/tests/image-lightbox.client.spec.tsx` 覆盖图片保存链接。`build_pptx.py` 已针对两页与带图片规格运行，并用 Open XML SDK 校验器验证（Office2007、Office2010 与 Microsoft365 均为 0 错误）；该校验器也复现了已发布的缺陷：早先的包通过 schema 校验，却缺少每张幻灯片的 slide→`slideLayout` 关系，因此 Office 16 提示修复。Client 与 Host 类型检查通过，`ui-tool`、`ui-conversation`、`ui-attachment`、`ui-deliverables` 与 `ui-sidebar-documentpreview` 保持每个文件 100% 覆盖率（ui-primitives 的 `SearchBlock.tsx` 改动由其 spec 覆盖）。改动后的可见输出在开 PR 前仍需运行 `DSH_SNAPSHOT=replay pnpm run test:web`。
