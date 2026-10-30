---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-23-space-read-grant

[English](2026-10-23-space-read-grant.md) | 中文

## 概述

新增仅日志的 faberloom/space-read-grant 会话事件及其 Space 读取授予投影，并记录路由请求头中可选的 credentialRef 字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-23-space-read-grant
baseline: false
changes:
  - root: "event:faberloom/space-read-grant"
    previous: null
    after: "074b10d8fbaaf80674868fb1612c6cfc44ada8ca799e05ea831953013dea1165"
    decision: same-version
  - root: "event:request/header"
    previous: "2026-09-11-initial"
    after: "2b590b4d278633beb9915998c872ae9733312d6d0b4885572ab63e8a10bfa80d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有会话日志仍然有效。新事件是增量的，只有 Space 会话组合会折叠它；没有该声明的构建会拒绝携带它的日志，因此桌面端与 Web 端一起发布。可选的请求头 credentialRef 早已由代理路由请求发出，并保持可选：缺失时保留路由自身的凭证引用。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/faberloom/session-agent/tests packages/faberloom/tool-faberloom/tests：184 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
