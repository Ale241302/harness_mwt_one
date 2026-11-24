---
description: "通过 stdio 暴露 run_code 与 catalog：本地 MCP 客户端无需加载数百个工具 schema 就能操作 MWT、SICOP 或 FaberLoom，上游凭证只留在门面的父进程里。"
kind: "package-library"
---

# @deepseek-ai/dsh-mcp-codemode

[English](README.md) | 中文

## 摘要

把 MCP 客户端指向这个门面而不是直连 MWT、SICOP 或 FaberLoom，客户端看到的是两个工具（`run_code`、`catalog`），而非数百个。模型只写一个异步 TypeScript 函数体；门面在新的 Node 进程里执行它，并由父进程把其中的 `tools.mcp__<server>__<tool>` 调用派发给真实的上游 MCP 服务器——凭证就在父进程里。程序使用的绑定键和结果信封与 harness 的 `run_code` 完全一致，因此同一段程序在两边都能跑。当成本来自聊天客户端的工具清单而不是任务本身时，选它。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [维护者笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

当外部 MCP 客户端（Claude Desktop、Cursor、经本地桥接的 ChatGPT 连接器）要回答一个横跨多个上游工具的问题，而每次请求都要加载全部上游 schema 是主要成本时，使用这个门面。它在启动时连接一次上游、列出工具，然后只提供两个工具。需要 harness 自己的 agent 循环、会话日志、审批或沙箱策略的调用方，应当挂载 `@deepseek-ai/dsh-mcp-client` 与 harness 的 `run_code` 工具；本包是独立进程，没有 Cordis 上下文。

### 最小配置

写一个 JSON 文件；令牌只出现在这里。HTTP 头由门面进程在每次派发时附加，永远不会进入程序。

```json
{
  "upstreams": [
    {
      "serverName": "mwt",
      "transport": "http",
      "url": "https://mcp.example.com/mwt",
      "headers": { "Authorization": "Bearer <token>" }
    },
    {
      "serverName": "sicop",
      "transport": "http",
      "url": "https://mcp.example.com/sicop",
      "headers": { "Authorization": "Bearer <token>" }
    }
  ],
  "timeoutMs": 60000
}
```

在客户端注册该进程。`args[0]` 是构建产物入口；源码检出可用 tsx 运行同一模块。

```json
{
  "mcpServers": {
    "codemode": {
      "command": "node",
      "args": [
        "C:/work/deepseek-harness/packages/mcp/mcp-codemode/lib/startup.js",
        "--config",
        "C:/work/codemode.json"
      ]
    }
  }
}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `upstreams[].serverName` | 必填 | 绑定命名空间；`[A-Za-z0-9_-]{1,32}`，文件内唯一 |
| `upstreams[].transport` | 必填 | `stdio` 或 `http` |
| `upstreams[].command` / `args` / `env` / `cwd` | — | `stdio`：可执行文件、参数、显式环境、工作目录 |
| `upstreams[].url` / `headers` | — | `http`：Streamable HTTP 端点与附加请求头 |
| `timeoutMs` | `60,000` | 单次上游 `tools/call` 的期限 |
| `maxOutputBytes` | `262,144` | 单次 `run_code` 回答的上限：控制台行加结果 JSON |
| `maxUpstreamResultBytes` | `16,777,216` | 交给程序的单个上游结果上限 |
| `maxCatalogBytes` | `262,144` | 单次 `catalog` 响应截断上限 |
| `maxPendingCalls` | `32` | 单个程序同时在途的上游调用数 |
| `maxOldGenerationSizeMb` | `512` | 程序进程的 V8 堆上限 |
| `nodeExecutable` | 门面自身的 Node | 运行程序的可执行文件 |
| `cwd` | 门面所在目录 | 程序进程的工作目录 |

库入口就是去掉文件层的同一门面：`createCodeModeFacade(config)` 连接上游，`createCodeModeServer(facade)` 返回 MCP 服务器，`facade.close()` 释放上游客户端。

### 调用上游工具

`catalog({ server })` 返回单个服务器的 TypeScript 声明；`catalog()` 返回全部服务器。声明把每个绑定命名为 `mcp__<server>__<原始工具名>`，精确的参数类型只在这里出现。

```ts
const board = await tools.mcp__faberloom__faberloom_board({ status: 'needs_review', limit: 5 })
const spaces = await tools.mcp__faberloom__faberloom_spaces({ includeArchived: false })
const overview = await tools.mcp__faberloom__faberloom_overview({})

const pending = board.content.flatMap(block => block.text === undefined ? [] : [JSON.parse(block.text).title])
const rows = spaces.content.flatMap(block => block.text === undefined ? [] : [JSON.parse(block.text)])
console.log(`${rows.length} active spaces`)
return { pending, spaces: rows.map(space => space.title), executions: JSON.parse(overview.content[0].text).executions }
```

这些名字来自 FaberLoom 的 MCP 目录（`packages/faberloom/mcp-server/src/tools.ts`），因此在 `serverName: "faberloom"` 下这段程序可直接对应该服务器运行。上游工具的规范值是 `{ content, structuredContent? }`，与 harness MCP 桥交给程序的值相同。工具级错误会让该次调用拒绝；用 `try`/`catch` 包住即可让程序继续。只有返回值与 `console` 输出会回到客户端。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节——点击展开</summary>

门面是一个进程、两个角色。父进程为每个上游持有一个 MCP 客户端，因此 Streamable HTTP 头、stdio 环境与重连处理都不会离开可信一侧。每次 `run_code` 都新起一个 Node 进程，`env: {}`、一条 IPC 通道，把程序与绑定名发下去，并按到达顺序回答程序的调用。程序体执行前会清空 `process.env`，这会一并移除 Windows 为空环境补充的机器默认值。

程序的键就是 harness 的公开 MCP 工具名，包括有损规范化后的哈希，所以在这里写的程序在 harness 内部调用的是同样的 `tools.mcp__<server>__<tool>` 条目。`bindingName` 由一条直接对比 `publicToolName` 的测试钉住。

`src/protocol.ts` 是纯状态机：它决定每一帧的含义、执行输出与在途调用上限，并恰好结算一次；`src/drive.ts` 把子进程事件、定时器、stderr 与清理接到它上面。`src/channel.ts` 负责发送帧以及先软后硬的终止，`src/executor.ts` 只负责启动进程，因此协议的各条失败分支以数据方式测试，而不依赖真实进程。

外层包装就是 harness 的 `run_code` 契约而非近似：以 `tools` 和控制台垫片为参数的异步函数体；回答先日志后返回值；失败时给出 `code run failed (<kind>): <message>` 并附上已捕获输出。JSON 无损性在 IPC 边界强制，返回 `Date`、`Map` 或循环对象会直接失败，而不是静默降级。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [MCP 客户端桥](../mcp-client/README.zh.md) — harness 进程内的等价物，以及本包所钉住的公开命名契约。
- [PTC 运行时 Node](../../ptc-runtime/ptc-runtime-node/README.zh.md) — 门面刻意没有挂载的、harness 内带沙箱的程序运行时。
- [Tools 子系统](../../../docs/subsystems/tools.zh.md) — harness `run_code` 背后的注册表与执行管线。
- [Workflow PTC 宿主](../../workflow/workflow-ptc/src/host.ts) — 现有的 JSON 绑定命名空间模式（`global` 加 `functions`），未来共享运行时可以复用。

<a id="model-experience"></a>
## 模型体验

### MCP 工具定义

#### 模型看到什么

客户端的 `tools/list` 只包含两个定义：`run_code`（必填 `code` 与 `description`）和 `catalog`（可选 `server`）。`run_code` 要求模型以 `await tools.<name>(args)` 调用上游工具，并先调用 `catalog` 取得精确名称；`catalog` 以文本返回声明——一个 `declare const tools` 对象，每项带工具描述首行与参数类型。

#### Token 影响

无论上游工具有多少，每次请求都只带入两个工具 schema；上游 schema 只在模型调用 `catalog` 时进入上下文，`{ server }` 可缩小到一个家族。`run_code` 的回答只包含程序的控制台行与返回值，受 `maxOutputBytes` 约束；上游中间值从不回到客户端。

#### KV Cache 影响

两个工具定义与服务器说明都是固定字面量，因此请求前缀在轮次、程序与上游工具列表变化之间保持可复用。`catalog` 响应与每次 `run_code` 回答都是普通追加内容；它们延长对话而不替换早先的 token。

### 服务器说明

#### 模型看到什么

MCP `initialize` 结果携带一段固定说明。

##### 服务器说明原文

```markdown
This server collapses many upstream MCP tools into two tools. `run_code` executes the body of an async TypeScript function in a fresh Node process; upstream tools are async functions on the `tools` object, named `mcp__<server>__<tool>`. Call `catalog` for the exact declarations before writing a program. Only what the program returns or prints is returned to you.
```

#### Token 影响

客户端保持连接期间每次请求一段固定文字，不随上游工具数量增长。

#### KV Cache 影响

重连前后不变，说明块之后的可复用前缀保持完整。

### 程序输出

#### 模型看到什么

成功回答先列已捕获的控制台行，再以缩进 JSON 呈现返回值，或给出 `(run_code completed with no output)`。失败回答是 `code run failed (<kind>): <message>` 并附上已捕获输出；kind 取值为 `exception`、`timeout`、`output-limit`、`invalid-output`、`worker-exit`、`protocol`、`aborted`。

#### Token 影响

完整回答受 `maxOutputBytes` 约束，进入程序的单个中间值受 `maxUpstreamResultBytes` 约束。返回巨大上游载荷的程序会以 `output-limit` 失败而不是淹没对话，这正是促使模型在程序内先做汇总的机制。

#### KV Cache 影响

仅追加：每个回答跟在可复用前缀之后，不会使早先条目失效。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

以下是当前约束，不是待办清单。

本包不发布运行时不变式伴随模块，因为门面没有需要对账的派生关系：已连接的上游集合、各绑定索引与目录文本都在启动时由同一集合生成一次，观测之间不会分叉。

- **不是安全沙箱** — 程序运行在独立 Node 进程中，环境为空，并有堆上限、输出上限与期限，但通过 `await import(...)` 仍可触达 Node API。没有文件系统限制、网络策略或审批步骤；需要这些时请挂载 harness 的 PTC 运行时。
- **未复用 `ptc-runtime-node`** — `NodePtcRuntime` 注入 `fs`、`subprocess`、`sandbox` 与 `sandboxPolicy`，而沙箱策略服务又注入 `sessionProjections`，要实例化它就得挂载一个 Cordis 应用（且 Windows 沙箱后端不在 Windows 测试车道内）。本包改为实现一个更小的执行器，但保持相同的程序契约。
- **仅 stdio 传输** — 单个本地进程，凭证来自配置文件。HTTP 多租户、按租户令牌、远程认证与部署均未实现。
- **丰富内容以 JSON 返回** — 图像、音频与资源块以 base64 或 URI 文本形式出现在规范 `{ content }` 值里；客户端无法展示它们。
- **目录类型是有界 JSON Schema 子集** — 对象、数组、标量、枚举、本地 `$ref`、`anyOf`/`oneOf`/`allOf` 会被渲染，其余变为 `unknown`，每条描述截断到 240 字符。上游 schema 仍是权威来源，因此程序参数可能仍需结合 `catalog` 输出与一次试调。
- **运行期间没有进度或流式输出** — 长程序在结束或期限触发前保持静默。

<a id="dev-note"></a>
### 维护者笔记

<details>
<summary>维护者工作上下文——点击展开</summary>

尚未决定的方向：harness 与本门面共享一套程序运行时（`tools` 命名空间与结果信封已经一致）；带按租户令牌的 HTTP 传输；服务期间的上游重连与工具列表刷新；以及把图像块附加到工具结果而不是内嵌进值里。

</details>
