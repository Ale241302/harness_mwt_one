---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-02-usage-mode-event

[English](2026-11-02-usage-mode-event.md) | 中文

## 概述

新增仅记录的 faberloom/usage-mode 会话事件，记录组合会话的请求使用部署密钥还是账户自有密钥认证。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-02-usage-mode-event
baseline: false
changes:
  - root: "event:faberloom/usage-mode"
    previous: null
    after: "c35b4b27bb2a555227c1219b2293a88b55e5c0727a3164882bb8290be14d9610"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有会话日志仍然有效。该事件是追加的，只有 FaberLoom 会话组合会写入；没有该声明的构建会拒绝携带它的日志，因此桌面与 Web 需一起发布。事件只保存模式，从不保存凭据值或引用。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/faberloom/session-agent/tests：88 项测试通过。该记录由 verify-persistence-changes 确认。

<a id="dev-note"></a>
## 开发备注

无。
