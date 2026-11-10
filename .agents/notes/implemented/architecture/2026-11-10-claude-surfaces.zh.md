# Agent Note: Each Claude surface gets its own certified cycle

Status: implemented

[English](2026-11-10-claude-surfaces.md) | 中文

## Problem

Claude 适配器假设只有一个 host。它为任何调用方生成就绪插件，没有带日期的表面矩阵，也可能让 chat 或 Cowork 读者仅因 Code 加载了某个组件就把它视为可运行。没有为消费 ZIP 的表面提供归档，也没有记录被表面忽略的组件清单。

## Decision

**由矩阵决定表面，而不是适配器默认值。** `packages/faberloom/portable/src/adapters/surfaces.ts` 为每个表面记录状态、精确 host 版本、安装机制、认证路径、证据与限制，日期为 `2026-11-10`。Code 在 `2.1.126` 上以插件目录与本地 loopback OAuth 认证。桌面扩展因没有独立安装与循环而保持开放。Chat 因 D02 未暴露远程端点而保持 ZIP + 远程 OAuth 开放。Cowork 因未验证会话运行位置而保持 ZIP + host session 开放。

**开放表面产生草稿，而不是借用 Code 包。** `planClaudePackage` 接受 `surface`。已认证表面只为矩阵中的精确 host 版本构建就绪包；不同版本被拒绝。开放表面只返回 `faberloom/draft.md`、`sent:false`、`mesa:false`、空组件、所有表面能力为 false，以及 `surfaceStatus: 'open'`；它绝不把 Code 的组件宣称为自己的。连接 host 与请求表面不一致时拒绝，草稿不能安装到已有包上。

**清单区分已加载与已忽略。** `components` 列出包携带的文件及其 `loaded` 标志；`ignored` 列出转换省略或拒绝的可移植路径。被拒绝的 workflow 在 `ignored` 中且不在 `components` 中；为模型携带的资源存在但 `loaded:false`。加载记录只列出已加载目标。

**ZIP 是确定性的且按表面区分。** `archiveClaudePackage` 以字节顺序、固定时间戳与 UTF-8 名称写入存储条目，因此同一计划在不同 host locale 下产生相同字节。Code 安装目录；chat 与 Cowork 记录为 ZIP 消费方。`writeClaudeZip` 只写归档，不安装也不发布任何内容。

**每个表面有自己的认证路径。** Code 使用本地 loopback OAuth；chat 使用远程 OAuth；Cowork 使用 host session。计划携带 `authRoute` 与 `matrixAsOf`，因此包说明自己期望的路径，而不是共享一条令牌路径。移除包需要 `faberloom/load.json` 或草稿标记，并且只删除该目录；产物源与产品记录保留。

## Alternatives considered

**所有 Claude 表面共用一个包。** 这会让未测试 host 继承 Code 的认证与可运行组件清单，矩阵禁止这一点。

**因为字节有效就把 chat/Cowork 标记为就绪。** 清单有效性不是已安装循环。它们的状态保持开放，直到各自的安装、认证与任务被观察。

**使用没有固定时间戳的通用 ZIP 写入器。** 两个相同计划会产生不同归档。固定时间戳与路径顺序使归档可复现。

**让 Code 的目录服务 chat/Cowork。** Chat 需要远程端点，Cowork 取决于会话运行位置；目录安装不能回答两者。

## Consequences

Code 与 desktop 在记录版本上已认证。Chat 与 Cowork 以各自的 ZIP 与认证路径保持开放，HOST-03 对这些表面保持 `no-comprobada`。矩阵与 `docs/faberloom/evidence/4b1-claude-matrix.json` 是带日期证据；4A.3 因没有真实代表用户会话而保持开放。被忽略组件对审阅者可见，但绝不宣称可运行。

## Verification

- `packages/faberloom/portable/tests/surfaces.spec.ts`：带日期矩阵；Code 就绪；已加载/忽略清单；确定性 ZIP；chat/Cowork 草稿及其认证且无运行组件；只移除包。
- `packages/faberloom/portable/tests/distribution.spec.ts`：Code 清单、组件加载、host 版本与包移除。
- `packages/faberloom/portable/tests/conversion.spec.ts`：为 `ignored` 提供数据的转换表。
