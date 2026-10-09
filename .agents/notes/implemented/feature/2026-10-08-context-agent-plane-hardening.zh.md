# Agent Note: Context 与 agent-plane 加固

Status: implemented

[English](2026-10-08-context-agent-plane-hardening.md) | 中文

## Problem

对 Context / agent-plane 套件的一次独立复查发现了聚焦测试未覆盖的缺陷。`FaberLoomContext.placement` 吞掉了 `spaces.get` 的失败并回退为把行为者当作 Space 所有者，于是不是成员的人也能放入条目——并可通过 `replace` 重写整个 Space 的上下文记录。`list` 把每个 `shared` 条目放行给每个行为者，无论其是否可读该 Space，因此 `export` 可外泄另一 Space 的上下文。`FaberLoomSessionAgent` 读取 `ctx.agents` 却未声明注入，真实组合可能丢弃该插件。被委托的子会话会重跑组合并二次注册 `deployment:persona-prefix` 段，导致子会话创建失败。context 工具的输出 schema 把 `spaceId` 声明为字符串，而个人条目携带 `null`，于是列出个人条目会抛出工具输出错误。一次性 `faberloom_spaces_ask` 会把未完成的运行当作答复返回，其 `continuable` 参数仍自称不受支持，且当同一载荷重复标题时 `import` 会创建重复项。

## Decision

`placement` 通过该 Space 的读取 ACL 解析并**失败关闭**：条目不能放入行为者不可读的 Space，而由他人拥有的可读 Space 在没有 `index-context` 授权时仍落到 `pending`。读取放行行为者写入或拥有的条目，或所属 Space 对行为者可读的 `shared` 条目；可读集合在每次 `list` 中计算一次。`FaberLoomSessionAgent` 声明 `static inject = ['agents']`，对并发安装加锁，并跳过被委托的子会话（设置了 `header.parentSession`），它已继承父级的组合。`summarize` 把个人条目的 `spaceId` 渲染为空字符串。一次性 `faberloom_spaces_ask` 在运行的 `stopReason` 不为 `completed` 时**显式失败**，其 `continuable` 描述指明持久化后续。`import` 记录载荷中已见标题，因此重复项被跳过。`find` 读取行为者的精选条目改为单次 `ctx.faberloomContext.list` 并按 Space 分组，而非每个 Space 一次 `listForSpace`。

## Alternatives considered

**区分“未找到”与“拒绝访问”。** 否决：`spaces.get` 对两者抛出相同错误，且两者都必须拒绝放入，因此单一关闭路径正确且更简单。

**用存储的读者列表来界定 shared 条目。** 否决：Space ACL 是“谁可读某 Space”的唯一权威；把成员复制进每个条目会与其漂移。

**为裸组合继续吞掉放入失败。** 仅在未挂载 spaces 服务时保留（退化组合无所有者可解析）；挂载了 spaces 时该检查生效。

## Consequences

非成员既不能放入也不能替换某 Space 的上下文，shared 条目仅对其 Space 的读者可读。会话组合在真实组合下可加载，被委托的子会话继承父级代理而不会重复段，个人条目列出时不再有 schema 错误。未完成的委托运行以错误呈现，而非部分答复。新增测试固定每条路径：放入与 `replace` 拒绝、`list`/`export`/`get` 中的 shared 条目界定、载荷幂等、子会话跳过，以及未完成停止原因。
