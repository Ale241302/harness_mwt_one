# Agent Note: the MWT.ONE guard files readable identifiers

Status: implemented

[English](2026-09-28-mwt-guard-readable-identifiers.md) | 中文

## 问题

内置的 MWT.ONE 巡检例程会把 expediente 的待办登记为 Work bench 任务。它的提示只要求“带有真实数据的证据”，于是 agent 直接倾倒原始工具输出：`uuid:5e9a…`、`OC_ROTA:id=cb62…`、`documento:c8c6… (… expediente_id=2858…)`。UUID 对复核任务的人毫无意义，而它本来就有用的编码（`codigo='PO UMMIE-2026-01'`、expediente `2429-2026`）却被埋没。Work bench 还会截断 prepared result：其单行的 `.cellMuted` 单元格会把长摘要以省略号截断在约 280px 处。

## 决策

- 巡检例程的指令现在固定了标识词汇：每个 expediente 用其 **PF**（`proforma_codigos`）标识；没有 PF 时用 `oc_codigos` 或 `sap_codigos`；若是合并则用 `fusion_label`。它禁止在标题与证据中出现 UUID（`id`、`uuid`、`expediente_id`、`documento id`），并要求可读引用（`expediente:<PF>`、`documento:<codigo> (kind=OC)`、`oc:<codigo>`、`sap:<numero>`）与完整摘要。
- `ensureBuiltinRoutines` 现在会把已存储的内置例程定义收敛为随发布的定义，因此由更早部署供给的所有者会在下次启动时收到改进后的提示，而不是永远保留旧文本。定义归部署所有，与“基线属于部署”的供给规则一致。
- Work bench 用可换行的类（`.summary`，`pre-wrap` + `overflow-wrap: anywhere`）渲染 prepared result，而不再用会截断的 `.cellMuted`（供表格单元格使用）。

## 考虑过的替代方案

**在视图中后处理证据。** 这些标识是模型输出，并非代码可可靠重写的格式；词汇应放在提示里，工具 schema 保持为普通的字符串列表。

**改例程名以让供给重建它。** name 是供给键与稳定契约；改名会重复或孤立该例程并丢失其历史。收敛定义可保持单一例程。

## 后果

- 从此巡检登记的任务在标题与证据中都会带 PF（或 OC/SAP）；合并则显示其 label。
- 本次改动之前登记的任务会保留其原始证据，直到巡检重新登记；该例程每六小时运行一次。
- 以后部署重写的任何内置例程都会在每个所有者的下次启动时到达。

## 测试

`packages/faberloom/routines/tests`、`defaults`、`view` 与 `ui-faberloom` 通过（83 项测试）。view 套件的 routines mock 增加了 `updateRoutine`——当已存定义不同时收敛会调用它。
