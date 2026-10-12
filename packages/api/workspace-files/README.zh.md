---
description: "面向 Web GUI 的工作区文件服务：通过组合文件系统进行有界文件读取，外加限定于工作区的创建、移动与删除，以及在 Session 工作区根内列举目录和观察已埋点的文件系统操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-files

[English](README.md) | 中文

## 概述

使用本包可从 Web Client 预览并改动 Session 文件系统中的文件。它按页读取 UTF-8 文本、按有界窗口或完整文件读取原始字节、从基文件目录解析关联文件，并报告文件元数据。它还创建文件或目录、移动条目、删除条目，每个操作都先解析并限定于 Session 工作区根，然后才改动任何东西。文件读取可以指向工作区外路径；每一次修改、目录列举与已埋点的文件系统观察都限定在工作区根内。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包与 `dsh-fs`、`dsh-sandbox-policy`、Session store 和 Typert Gateway 一起挂载；bundle 把它紧随 Session Controller 之后挂载。每个方法都在线路上携带 Session 身份，Client 调用 `remote.workspaceFiles.read(sessionId, path, range, signal)`、`stat(sessionId, path, signal)`、`readBytes(sessionId, path, range, signal)`、`list(sessionId, path, signal)`、`createFile(sessionId, path, content, signal)`、`createDirectory(sessionId, path, signal)`、`move(sessionId, from, to, options, signal)`、`remove(sessionId, path, options, signal)` 或 `changes(sessionId, signal)`，从不自己指定根。Host 读取 live Session header，cold Session 则使用持久层 `stat`；它不会激活 Agent、读取事件正文或借用父 Session 的根。live 读取不要求挂载 Session persistence；未挂载时 cold Session 无法解析，Gateway 返回 `gateway/lookup-not-found`。

| 方法 | 返回 | 用途 |
|---|---|---|
| `stat(path)` | `WorkspaceFileStat { absolutePath, version, bytes? }` | 一个普通文件的身份、版本与大小，不含内容 |
| `read(path, { offset?, limit? })` | `WorkspaceFileText` = stat + `{ offset, text, lines, eof }` | UTF-8 文本文件的一个行窗口；`lines` 计行数，使单个空行与越过文件末尾的页可区分 |
| `readBytes(path, { offset?, length? })` | `WorkspaceFileBytes` = stat + `{ offset, data, eof }` | 任意普通文件的一个原始字节窗口，base64 编码 |
| `readAll(path)` | `WorkspaceFileBytes`，其中 `offset: 0`、`eof: true` | `maxFileBytes` 内的完整原始字节；超大文件失败，不截断 |
| `readRelated(path, relativePath)` | `WorkspaceFileBytes` | Host 从基文件目录解析出的文件的完整字节 |
| `list(path)` | `WorkspaceDirectoryListing { path, entries, truncated }` | 一个目录的直接子项 |
| `createFile(path, content)` | `WorkspaceFileMutation { operation: 'created-file', path, absolutePath }` | 工作区内一个 UTF-8 文本文件，缺失的父目录一并创建 |
| `createDirectory(path)` | `WorkspaceFileMutation { operation: 'created-directory', … }` | 工作区内一个目录，缺失的父目录一并创建 |
| `move(from, to, { overwrite? })` | `WorkspaceFileMutation { operation: 'moved', path, absolutePath, from }` | 工作区内一次重命名或移动 |
| `remove(path, { recursive? })` | `WorkspaceFileMutation { operation: 'removed', … }` | 一个文件，或一个空目录 / 带 `recursive` 的目录 |
| `changes()` | `WorkspaceFileWatchFrame` 流 | 订阅就绪确认，随后为工作区根内的文件系统观察 |

### 寻址与路径

`read`、`readBytes`、`readAll`、`readRelated`、`stat` 与四个修改动词接受绝对路径或相对于所选 Session 工作区根的路径。对读取而言，组合文件系统决定路径是否可读，本服务不额外要求限定于工作区；`readRelated` 从基文件所在目录解析相对文件系统路径，基文件或目标文件位于工作区外时同样适用。这些方法以文件系统执行环境中的绝对路径报告文件。`list`、`createFile`、`createDirectory`、`move` 与 `remove` 限定于工作区：它们以相对于该根的路径报告条目，修改的答案还带上条目的绝对路径。`changes` 同样只报告工作区根内已埋点的文件系统观察。

### 修改

`createFile` 原子地写入一个完整 UTF-8 文件，并拒绝已被占用的目标；它从不覆盖。`createDirectory` 创建一个目录，缺失的父目录一并创建。`move` 重命名一个条目或把它移到另一个目录，目标被占用时拒绝，除非以 `{ overwrite: true }` 要求替换。`remove` 删除文件、拒绝符号链接，并且只删除空目录，除非以 `{ recursive: true }` 连同其中内容一起删除。

每个修改都通过读取所用的同一文件系统解析路径，解析结果位于工作区根之外即拒绝，然后才改动任何东西。被解析的条目本身不得是符号链接：动词会拒绝它，而不是跟随它到其目标——否则经链接删除会删掉链接指向的文件。工作区根自身也被拒绝为修改目标。`move` 还拒绝位于其自身来源之内的目标，文件系统无法表达这种移动。每个答案都说明改动了什么、在哪里：`operation`、调用后的条目工作区 `path`、其 `absolutePath`，移动时还有 `from` 中的原工作区路径。文件内容经 `ctx.fs.writeText` 以 `createIfAbsent` 写入，因此由所挂载后端自身的沙箱模式约束；目录、移动与删除三个动词使用宿主文件系统，因为文件系统 Service Definition 没有目录、重命名或删除操作。这三个动词因此要求与 harness 宿主共享文件系统的后端——`processPathFromHostPath` 必须能把目标映射回来——SSH 文件系统会以 `unsupported-backend` 被拒绝，而不是拿到一个猜测的宿主路径。

### 分页

`read` 返回一个行窗口，绝不返回整个文件。`range.offset` 是 1 起算的首行，缺省为 1；`range.limit` 是该页最多的行数，缺省为 `maxLines` 且不得超过它——更大的 limit，或不是正整数的 offset / limit，都是 `gateway/bad-request`。行以 `\n` 结束，末尾的 `\n` 是最后一行的终止符而不是再起一空行，所以两行文件就是两行。页的 `text` 以 `\n` 连接各行，最后一行之后不带终止符；`eof` 在该页含文件最后一行时为 true，offset 越过末尾则返回空页且 `eof` 为 true。每页还带上前置 stat 得到的文件 `version`，消费方据此分辨新页与旧页，以及 `bytes`——后端能报告时的整文件大小。服务只把文件读到该页之后的第一个字符为止，所以再大的文件每次请求也只占一页内存。

### 字节窗口

`read` 按行分页，绝不按字节；字节窗口走 `readBytes`。`range.offset` 是 0 起算的首字节，缺省为 0；`range.length` 是窗口最多的字节数，缺省为 `maxBytes` 且不得超过它——更长的窗口以 `too-large` 失败而不是被截短，不是整数或越界的 offset / length 则是 `gateway/bad-request`。窗口以 base64 的 `data` 返回，到文件末尾时短于 `length`，位于或越过末尾时为空；窗口含文件最后一个字节时 `eof` 为 true。不做任何解码，也不按二进制拒绝，因此图片或含 NUL 的文件在 `read` 以 `not-text` 失败之处仍可读出。与页一样附带同一 `version` 与 `bytes`。

### 文件读取与目录检查

每项操作都先通过 `lstat` 拒绝不存在的路径、末端符号链接或错误的文件类型。文件操作随后通过组合文件系统解析和读取，不做额外的工作区包含检查。只有 `list` 要求解析后的目录仍位于工作区内。配置的分页、窗口、完整文件和目录列举上限仍然适用。文本页还拒绝无效 UTF-8 与 NUL 字节；字节读取不解码内容。空路径是 `gateway/bad-request`。

### 变更流

`changes` 是 `stream` 模式的 Remote。一代流注册观察队列并解析 Session 工作区根之后，才产出 `{ kind: 'ready' }`。随后产出 `{ kind: 'change', change }`，其中 `change` 对存在的文件为 `{ absolutePath, version }`，对被观察到已消失的文件为 `{ absolutePath, absent: true }`。来源是按该根内目标过滤的 `fs/observed`；操作系统并未被监视。一代流首次拉取后的观察都会排队，包括解析根期间的观察。流在取消或插件释放时结束。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxBytes` | `2097152`（2 MiB） | 单页文本与单个字节窗口的字节上限（含）；更大的页或窗口失败 |
| `maxFileBytes` | `33554432`（32 MiB） | `readAll` 和 `readRelated` 的完整文件字节上限（含）；更大文件以 `too-large` 失败 |
| `maxLines` | `5000` | 页大小的缺省值与上限（行）；更大的 `limit` 被拒绝 |
| `maxEntries` | `2000` | 返回目录条目数上限；其余丢弃并报告截断 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-api-workspace-files)是每个可接受字段及其 JSDoc 的完备来源。

### 失败

每种失败都是一个带类型化 details 的 `RemoteError` 代码，声明于 [`src/types.ts`](src/types.ts)：`workspace-file/not-found`、`workspace-file/outside-workspace`（目录列举，以及任何解析结果离开工作区根的修改）、`workspace-file/too-large`（带 `limit`，即适用的页、窗口、完整文件或新建文件上限）、`workspace-file/not-text`、`workspace-file/not-regular-file`（`kind` 为 `directory`、`symlink` 或 `other`）、`workspace-file/not-directory`（`kind` 为 `file`、`symlink` 或 `other`）、`workspace-file/already-exists`（创建，或未带 `overwrite` 的移动到已占用目标）、`workspace-file/directory-not-empty`（未带 `recursive` 的 `remove`）、`workspace-file/root-refused`、`workspace-file/symlink-refused`、`workspace-file/bad-target`（移动到自身来源之内）以及 `workspace-file/unsupported-backend`。调用方按代码分支，绝不按消息文本。

### Client 文件资源

浏览器导出向 `ctx.resources` 注册 `file` 提供方，要求 `resources`、`remote` 和 `remote.workspaceFiles` 在场。bundle 中单个 `workspace-files` 条目供应两面；Client 没有单独配置。组件通过 `useResource<'file'>(address)` 读取 `WorkspaceFileStat { absolutePath, version, bytes? }` 元数据，内容另经 Remote 读取。任何 UI（包括 Global）访问同一完整地址都共享观察。

`session/<sessionId>/<path>` 地址携带授权 Session，以及相对或绝对路径；前导斜杠保留，例如 `dsh-resource://file/session/s//etc/hosts`。Host 原样接收路径，负责解析与权限检查；Client 不需要 Session `cwd`。`absolute/<path>` 仍可解析，但没有授权 Session，以 `workspace-file/unknown-workspace` 失败，不借用当前或 Tab Session。不支持的地址以 `workspace-file/unsupported-address` 失败。语法由 [workspace-path](../../util/workspace-path/README.zh.md) 定义；Resource 泛型层只认地址和 `signal`。

提供方等到 Host 的 `ready` 帧后才发首次 `stat`，读取期间将变更排队，随后将跟随者绑定到 `stat.absolutePath`。排队与实时变更都按该 Host 返回路径匹配。新的写入版本更新元数据并保留最近的字节大小；重复版本被忽略。消失通知会重新 stat 文件。stat 失败后仍跟随地址，后续写入可使其恢复；首次成功绑定路径前，Session 内任何写入都可触发重试。帧是 `RemoteResult` 值，编程异常不被捕获。

每个 Session 的所有被跟随文件共用一条受监督的 `changes` 流。跟随者按反斜杠归一为斜杠的绝对路径匹配。载体掉线由 Gateway 监督器重连；Host 结束或终态失败的流会结束其跟随者，最后的元数据仍可读取，直到重新打开。最后一个跟随者离开时释放流，后继流等待该释放完成，插件拆除等待所有在途关闭。提供者声明 `ResourceProtocolMap.file`；文本预览声明其 Sidebar 行号导航参数。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

### 设计概念

经 `ctx.fs` 的读取使用后端的读取权限；沙箱后端限制写与编辑，而不限制读取。Typert lookup 从 live Session header 或持久层的 header-only `stat` 导出 `WorkspaceFileScope`，所以 cold subagent Session 不需要激活 Agent 或读取事件正文。本服务增加普通文件检查与有界传输，工作区包含要求属于目录列举、变更观察与每一次修改。页从 `streamText` 切出，后者逐块解码并拒绝非 UTF-8：切页器对窗口之前的行只计数不保留，对窗口内的每个片段先按字节上限验收再缓冲，并在窗口之后的第一个字符处返回。流之前的一次 `stat` 给出页所报告的版本与大小。修改先解析目标并检查包含，然后才改动任何东西，所以被拒绝的路径只付出一次解析与一次探查。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `WorkspaceFiles`：`workspaceFiles` 服务与 Remote 命名空间、`Config`、四道关、切页器、`read`、`readBytes`、`readAll`、`readRelated`、`stat`、`list`、`createFile`、`createDirectory`、`move`、`remove` |
| [`src/changes.ts`](src/changes.ts) | `WorkspaceChangeFeed`：`fs/observed` 订阅与每个打开的 `changes` generation 各一条队列 |
| [`src/types.ts`](src/types.ts) | 线路类型与 `RemoteErrorDetailsMap` 错误码，以 `./types` 发布给 Client 包 |
| [`src/client/index.ts`](src/client/index.ts)、[`provider.ts`](src/client/provider.ts)、[`change-feed.ts`](src/client/change-feed.ts) | 浏览器插件、文件元数据与每 Session 变更流 |
| [`src/client/types.ts`](src/client/types.ts)、[`remote.ts`](src/client/remote.ts) | 资源值、参数、Client 错误码与生成的 Remote 类型 |
| — | 不发布运行时 invariant 伴生件；每个 Host 答案都在调用时由 `ctx.fs` 与沙箱策略推导。 |

Typert 生成 `./typert` 与 `./remote` 暴露的 Host 与 Client Remote 产物。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [文件系统能力](../../fs/fs/README.zh.md)——本服务经由读取的 `ctx.fs` 约定，含 `fs/observed` 与 `readByteRange`。
- [沙箱策略](../../sandbox/sandbox-policy/README.zh.md)——Session 工作区根的来源。
- [Remote 装配](../../api/remotes/README.zh.md)——Client 包如何触达 `workspaceFiles` 命名空间。
- [Client 资源](../../client/resources/README.zh.md)——资源模型、`useResource`、pin 与提供者生命周期。
- [工作区路径辅助](../../util/workspace-path/README.zh.md)——`fileAddressFor` 与 `parseFileAddress`，两端共享的 `dsh-resource://file/…` 地址语法。
- [Sidebar 文本预览](../../client/ui-sidebar-documentpreview/README.zh.md)——经 `file` 提供者跟随文件并读取其页的 tab 类型。

-----

<a id="model-experience"></a>
## 模型体验

无，本包不注册任何工具、不贡献提示词章节、不追加任何会话事件。

#### KV Cache 影响

无；本包既不装配也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅覆盖已埋点操作**——`changes` 转发 `fs/observed` 的发射；子进程、shell 命令、用户编辑器或下述修改动词改动的文件都不产生任何帧。
- **仅目录受限**——尽管文件预览可以读取文件系统后端允许的任意路径，`list`、`changes` 与每一次修改仍限定在 Session 工作区内。
- **三个动词要求与宿主共享的后端**——`createDirectory`、`move` 与 `remove` 直接操作宿主文件系统，因此拒绝不与 harness 宿主共享文件系统的后端（`unsupported-backend`）。要把它们移入文件系统 seam，需要 `ctx.fs` 具备目录、重命名与删除操作，而 Service Definition 目前没有；只有到那时沙箱模式才能像约束 `createFile` 一样约束它们。
- **沙箱模式只约束 `createFile`**——另外三个修改自行强制工作区根包含，所以 `read-only` 会话模式会拒绝新建文件，却不拒绝新建目录、移动或删除。
- **没有总行数**——页只报告 `eof`，不报告后面还有多少行；需要总数的消费方要翻到末尾或按 `bytes` 估算。
- **超长单行没有页**——超过 `maxBytes` 的单行在包含它的每个窗口都以 `too-large` 失败，因为页按行而非按字节切。
- **读取不具备事务性**——结果元数据来自内容读取之前的 stat；并发写入可能使报告版本与返回内容不一致。
- **generation 队列无界**——一个 `changes` generation 会缓冲每一条被包含的观察直到消费方 pull；停滞的消费方会在流的生命期内持续增长 Host 内存。
- **`maxEntries` 限制的是答案，不是列举**——`list` 让 `ctx.fs.listDir` 列出全部子项后再截断数组，远超上限的目录仍让 Host 付出整个列举的代价（`fs-local` 上每个子项一次 stat）；要限制这份工作，需要文件系统 seam 的 `listDir` 支持上限。
- **失效流保留元数据**——Host 结束 `changes` 或流终态失败后，已打开的值保持最后已知状态，直到重新打开。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
