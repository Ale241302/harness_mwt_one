# Agent Note：启用的 MCP 服务器在凭据接缝就绪后挂载，未挂载的服务器仍然可见

Status: implemented

[English](2026-11-23-mcp-boot-waits-for-credentials.md) | 中文

## 问题

MCP 注册表在应用时挂载每个已启用的已保存服务器。挂载需要解析服务器保存的凭据引用，而 `credentials` 并不是该插件的依赖。进程启动时如果凭据接缝尚未注册，每个启用的服务器都会以「the credential ... is not configured」挂载失败。记录仍保持启用，失败也被记录，但 Correo 面板按 `server.mounted` 过滤，把账户完全隐藏。只有在再次保存服务器后它才恢复，因为保存发生在接缝就绪之后。因此容器重启会让 MCP 收件箱消失，直到手动保存。

## 决定

### 启动等待接缝

`apply` 在 `ctx.get('credentials')` 已可解析时同步挂载；否则注册 `ctx.inject(['credentials'], () => boot())`。无论哪种情况都先发布服务，调用方在接缝缺失时仍可列出和编辑记录。启动会跳过已挂载的记录，因此后续的接缝注册不会为同一服务器创建第二个 fiber。

### `mounted` 表示工具已存在

`mount` 在 `await fiber` 之后才把条目写入 `mounts`，而不是之前。客户端仍在连接的服务器不会被报告为已挂载，`callTool` 也不会与注册竞争。

### 未挂载的服务器保持可见

收件箱页面和邮箱分组读取每个已启用的服务器，而不只是已挂载的。未挂载的服务器成为携带已记录错误的失败条目，账户出现在侧栏并附原因，而不是消失。邮箱发现失败的服务器原本就是这样处理的；这里把同一条规则扩展到挂载本身。

## 备选方案

**把 `credentials` 加入 `inject`。** 否决：没有凭据接缝的组合是受支持且被测试的，强制依赖会让插件永久挂起，而不是在保存时报告「no credential service is mounted」。

**定时重试挂载。** 本次否决：静默重试会隐藏失败，并为每个进程增加定时器。启动依赖与可见失败已经覆盖真实场景。

**继续过滤 `mounted` 并只记录日志。** 否决：账户仍会从所有者唯一能处理的界面消失。

## 后果

启用的 MCP 服务器在凭据接缝可用后随进程启动挂载。无法挂载的服务器带着原因可见，所有者可以修正凭据或重新保存。挂载表与上报状态现在与工具注册表一致。

## 测试

`vitest run packages/faberloom/mcp-registry/tests/mcp-registry.spec.ts`：37/37，包括凭据接缝在注册表之后到达、预置服务器完成挂载的新用例。`vitest run packages/faberloom/view/tests`：321/321。两个包的 `tsc -b` 与 `oxlint` 均为 0。
