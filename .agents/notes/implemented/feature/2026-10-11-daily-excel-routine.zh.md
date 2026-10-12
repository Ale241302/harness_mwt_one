# Agent Note: Daily Excel-from-email seeded routine

Status: implemented

[English](2026-10-11-daily-excel-routine.md) | 中文

## Problem

随附目录会为每位新 owner 播种四条例程（Pedido a proforma、Respaldo diario、Seguimiento de correo、SAP a expediente）。它们都不会保持一份工作表格的最新状态：SAP a expediente 只提取一张采购订单的附件并上传到某个文件，因此收到周期性报表邮件（每日或每周台账、操作员的派车单）的用户只能手工更新自己的跟踪 Excel，处于 agent 触达之外。

## Decision

`faberloom-defaults` 为每位新 owner 播种第五条例程：**“Excel diario desde el correo”**。

- **触发。** `recurrence` / `every:1d`，因此引擎每天启动一次而无需打开面板，owner 也可手动运行。
- **步骤。** 按依赖顺序共四步：`excel-correo`（`agent` handler 找到约定的报表邮件并把其 Excel 附件保存进 Space 文件夹）、`excel-enlace`（邮件只带链接时，`email.extract-spreadsheet-link` handler 从正文取出表格链接）、`excel-actualizar`（`agent`：更新该 Space 的跟踪 Excel——保留既有列，按 key 新增或替换，绝不重复行）、`excel-verificar`（`agent`：确认更新后的文件存在且包含当天的行，否则说明缺什么）。
- **部署。** `permissions: []`（该例程读取 owner 自己的邮箱与其自己的 Space 文件夹，无需 MWT.ONE 权限范围）以及 `failurePolicy: 'review'`，因此不匹配时停在 Approvals 队列，而不会静默覆盖表格。

该例程不点名路径与 agent：它以该 Space 的负责 agent 身份运行，工作目录即该 Space 文件夹，因此模型编辑的文件就是用户打开的文件。

## Alternatives considered

**随镜像附带一份模板表格。** 否决：跟踪文件的列属于 owner 而非产品；随附的 `.xlsx` 会在首次运行时被覆盖，且需要仓库本不携带的二进制资产。步骤指令即是模板。

**扩展“SAP a expediente”。** 否决：该例程限定于一张采购订单并以把文件上传到控制台结束；合并两者会让一条例程有两个无关结果与两套权限。

**新增一个在 host 内编辑工作簿的 `xlsx` handler。** 暂否决：`agent` handler 已具备文件工具（读取、写入、表格转换）且以该 Space 文件夹为 cwd，专用 handler 会重复它们。若某消费者需要无模型介入的字节级精确输出，确定性 handler 才是正解；此项延后。

**以禁用状态播种。** 否决：调度器只会在 owner 启用后运行 `draft` 例程，因此以草稿播种本就不含自动运行，直到 owner 选择启用。

## Consequences

新 owner 得到一条每日例程，从邮箱报表保持一份表格最新，并可在 Routines 面板中运行、排程或删除。因为它以草稿播种，在 owner 启用之前绝不会运行。该例程依赖 Space 文件夹作为工作目录，以及 owner 在 Connections 中配置的邮件连接；任一缺失时该次运行停在 review 并给出原因。既有 owner 不会获得它：播种器每位 owner 只运行一次，且只重建共享 agent，不重建计划例程。

## Testing

`packages/faberloom/defaults/tests/defaults.spec.ts` 播种目录中的每条例程并断言创建的名称、例程数量与一次性标记，因此新条目由既有套件覆盖。它点名的步骤 handler 各自由其包覆盖（`faberloom-handlers`，以及经例程引擎测试的 `agent` handler）。
