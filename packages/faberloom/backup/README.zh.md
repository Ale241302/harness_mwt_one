---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomBackup）：知识导出、恢复、完整性与迁移。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-backup

[English](README.md) | 中文

## 概述

此包承载知识导出、恢复、完整性与迁移。它注册 `ctx.faberloomBackup` 主机服务，把已打开的 FaberLoom 存储域快照为一个持久、经完整性校验的备份，并可将其恢复。一次备份是一份规范且确定性的 JSON 载荷，加上按域与按表的记录数与 sha256 摘要组成的清单；载荷摘要是完整性锚点，若载荷不再匹配，恢复会被拒绝。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomBackup`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomBackup` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **按域而非按信号。** 快照读取进程中已打开的各声明域的全部记录。静态加密与异地保留由平台备份（gpg 与 rclone）负责，而不是本服务；存放在 harness 卷上的快照，其持久性仅等同于该卷。
- **尚无界面或定时入口。** `ctx.faberloomBackup` 是主机服务：`createBackup`、`listBackups`、`verifyBackup` 与 `restoreBackup` 由主机消费者调用。接上 Conexiones 界面与周期运行属于后续切片。
- **恢复为 upsert。** 恢复通过 `put` 写回记录；它不会对已对外部系统产生的效果做核对，也不会为目标域做版本管理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
