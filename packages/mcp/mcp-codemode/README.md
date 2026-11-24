---
description: "Expose run_code and catalog over stdio so a local MCP client programs against MWT, SICOP, or FaberLoom without loading hundreds of tool schemas, keeping upstream credentials in the facade's parent process."
kind: "package-library"
---

# @deepseek-ai/dsh-mcp-codemode

English | [中文](README.zh.md)

## Summary

Point an MCP client at this facade instead of at MWT, SICOP, or FaberLoom directly, and the client sees two tools (`run_code`, `catalog`) rather than hundreds. The model writes the body of an async TypeScript function; the facade runs it in a fresh Node process and dispatches its `tools.mcp__<server>__<tool>` calls to the real upstream MCP servers from the parent, where the credentials live. Programs use the same binding keys and result envelope as the harness `run_code` tool, so they move between the two. Choose it when a chat client's tool list, not the work itself, is the cost.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Reach for this facade when an external MCP client (Claude Desktop, Cursor, ChatGPT connectors over a local bridge) must answer questions that span several upstream tools, and loading every upstream schema per request is the dominant cost. It connects to the upstream servers once at startup, lists their tools, and serves exactly two tools. A caller that needs the harness's own agent loop, session log, approvals, or sandbox policy should mount `@deepseek-ai/dsh-mcp-client` and the harness `run_code` tool instead; this package is a standalone process with no Cordis context.

### Minimal configuration

Write one JSON file; it is the only place tokens appear. HTTP headers are applied by the facade process on every dispatch and never reach a program.

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

Register the process with the client. `args[0]` is the built entry; a source checkout runs the same module through tsx.

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

| Field | Default | Meaning |
|---|---|---|
| `upstreams[].serverName` | required | Binding namespace; `[A-Za-z0-9_-]{1,32}`, unique in the file |
| `upstreams[].transport` | required | `stdio` or `http` |
| `upstreams[].command` / `args` / `env` / `cwd` | — | `stdio`: executable, arguments, explicit environment, working directory |
| `upstreams[].url` / `headers` | — | `http`: Streamable HTTP endpoint and extra request headers |
| `timeoutMs` | `60,000` | Deadline for one upstream `tools/call` |
| `maxOutputBytes` | `262,144` | Cap on one `run_code` answer: console lines plus result JSON |
| `maxUpstreamResultBytes` | `16,777,216` | Cap on one upstream result handed to the program |
| `maxCatalogBytes` | `262,144` | Cap on one `catalog` response before truncation |
| `maxPendingCalls` | `32` | Upstream calls in flight from one program |
| `maxOldGenerationSizeMb` | `512` | V8 heap limit of the program process |
| `nodeExecutable` | the facade's Node | Executable that runs programs |
| `cwd` | the facade's directory | Working directory of the program process |

The library entry is the same facade without the file: `createCodeModeFacade(config)` connects upstreams, `createCodeModeServer(facade)` returns the MCP server, and `facade.close()` releases the upstream clients.

### Calling upstream tools

`catalog({ server })` returns one server's declarations as TypeScript; `catalog()` returns every server's. The declarations name each binding `mcp__<server>__<rawToolName>` and are the only place the exact argument types appear.

```ts
const board = await tools.mcp__faberloom__faberloom_board({ status: 'needs_review', limit: 5 })
const spaces = await tools.mcp__faberloom__faberloom_spaces({ includeArchived: false })
const overview = await tools.mcp__faberloom__faberloom_overview({})

const pending = board.content.flatMap(block => block.text === undefined ? [] : [JSON.parse(block.text).title])
const rows = spaces.content.flatMap(block => block.text === undefined ? [] : [JSON.parse(block.text)])
console.log(`${rows.length} active spaces`)
return { pending, spaces: rows.map(space => space.title), executions: JSON.parse(overview.content[0].text).executions }
```

Those names come from the FaberLoom MCP catalogue (`packages/faberloom/mcp-server/src/tools.ts`), so with `serverName: "faberloom"` this program runs unchanged against that server. An upstream tool's canonical value is `{ content, structuredContent? }`, the same value the harness MCP bridge hands a program. A tool-level error rejects the call; wrap it in `try`/`catch` to keep the program running. Only the returned value and `console` output come back to the client.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The facade is one process with two roles. In the parent it holds one MCP client per upstream, so Streamable HTTP headers, stdio environment, and reconnect handling never leave the trusted side. For each `run_code` call it spawns a fresh Node process with `env: {}` and one IPC channel, sends the program and the binding names, and answers the program's calls as they arrive. The program's `process.env` is wiped before its body runs, which also removes the machine defaults Windows supplies to an empty spawn environment.

The program's keys are the harness's public MCP tool names, including the lossy-normalization hash, so a program written here calls the same `tools.mcp__<server>__<tool>` entries inside the harness. `bindingName` is pinned to `publicToolName` by a test that compares them directly.

`src/protocol.ts` is a pure state machine: it decides what each frame means, enforces the output and in-flight bounds, and settles a run exactly once, while `src/drive.ts` wires the child's events, timers, stderr, and teardown to it. `src/channel.ts` owns frame sending and the soft-then-hard kill, and `src/executor.ts` only spawns, so the protocol's failure branches are tested as data instead of through a live process.

The wrapper is the harness `run_code` contract, not an approximation of it: the body of an async function with `tools` and a console shim as parameters, logs then the returned value as the answer, and `code run failed (<kind>): <message>` plus captured output when the run fails. JSON losslessness is enforced at the IPC boundary, so a returned `Date`, `Map`, or cyclic object fails instead of silently degrading.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [MCP client bridge](../mcp-client/README.md) — the harness in-process equivalent and the public-name contract this package pins.
- [PTC runtime node](../../ptc-runtime/ptc-runtime-node/README.md) — the sandboxed in-harness program runtime this facade deliberately does not mount.
- [Tools subsystem](../../../docs/subsystems/tools.md) — the registry and execution pipeline behind the harness `run_code` tool.
- [Workflow PTC host](../../workflow/workflow-ptc/src/host.ts) — the existing JSON binding namespace pattern (`global` plus `functions`) a future shared runtime would reuse.

## Model Experience

### MCP tool definitions

#### What the model sees

The client's `tools/list` carries exactly two definitions: `run_code` with required `code` and `description`, and `catalog` with an optional `server`. `run_code` tells the model to call upstream tools as `await tools.<name>(args)` and to call `catalog` for the exact names; `catalog` returns the declarations as text, one `declare const tools` object, with each tool's first description line and its argument type.

#### Token effect

Two tool schemas enter every request regardless of how many upstream tools exist; the upstream schemas enter context only when the model calls `catalog`, and `{ server }` narrows that to one family. A `run_code` answer carries only the program's console lines and returned value, bounded by `maxOutputBytes`; intermediate upstream values never reach the client.

#### KV Cache effect

The two tool definitions and the server instructions are fixed literals, so the request prefix stays reusable across turns, programs, and upstream tool-list changes. A `catalog` response and every `run_code` answer are ordinary appended content; they extend the conversation without replacing earlier tokens.

### Server instructions

#### What the model sees

The MCP `initialize` result carries one fixed instructions paragraph.

##### Verbatim server instructions

```markdown
This server collapses many upstream MCP tools into two tools. `run_code` executes the body of an async TypeScript function in a fresh Node process; upstream tools are async functions on the `tools` object, named `mcp__<server>__<tool>`. Call `catalog` for the exact declarations before writing a program. Only what the program returns or prints is returned to you.
```

#### Token effect

A fixed paragraph per request while the client keeps the connection; it does not grow with the upstream tool count.

#### KV Cache effect

Unchanged across reconnects, so the reusable prefix after the instructions block stays intact.

### Program output

#### What the model sees

A successful answer is the captured console lines followed by the returned value rendered as indented JSON, or `(run_code completed with no output)`. A failed answer is `code run failed (<kind>): <message>` with the captured output appended; the kinds are `exception`, `timeout`, `output-limit`, `invalid-output`, `worker-exit`, `protocol`, and `aborted`.

#### Token effect

Bounded by `maxOutputBytes` for the complete answer, and by `maxUpstreamResultBytes` per intermediate value that enters the program. A program that returns a large upstream payload fails with `output-limit` instead of flooding the conversation, which is the incentive to summarize inside the program.

#### KV Cache effect

Append-only: each answer follows the reusable prefix and does not invalidate earlier entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints, not a backlog.

No runtime invariant companion is published because the facade owns no derived relation to reconcile: the connected upstream set, each binding index, and the catalog text are produced once at startup from that same set and never diverge between observations.

- **Not a security sandbox** — the program runs in a separate Node process with an empty environment, a heap limit, an output bound, and a deadline, but Node APIs remain reachable through `await import(...)`. There is no filesystem confinement, network policy, or approval step; mount the harness PTC runtime when those are required.
- **`ptc-runtime-node` is not reused** — `NodePtcRuntime` injects `fs`, `subprocess`, `sandbox`, and `sandboxPolicy`, and the sandbox policy service injects `sessionProjections`, so instantiating it means mounting a Cordis application (and the Windows sandbox backend is not part of the Windows test lane). This package implements a smaller executor with the same program contract instead of booting one.
- **stdio transport only** — one local process, credentials from the config file. HTTP tenancy, per-tenant tokens, remote auth, and deployment are not implemented.
- **Rich content is returned as JSON** — image, audio, and resource blocks arrive inside the canonical `{ content }` value as base64 or URI text; the client cannot display them.
- **Catalog types are a bounded JSON Schema subset** — objects, arrays, scalars, enums, local `$ref`, `anyOf`/`oneOf`/`allOf` render; anything else becomes `unknown`, and each description is cut at 240 characters. The upstream schema remains authoritative, so a program's arguments may still need `catalog` output plus one trial call.
- **No progress or streaming during a run** — a long program is silent until it settles or its deadline fires.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Open directions, none decided: a shared program runtime for the harness and this facade (the `tools` namespace and the result envelope are already identical); an HTTP transport with per-tenant tokens; upstream reconnection and tool-list refresh while serving; and attaching image blocks to the tool result instead of embedding them.

</details>
