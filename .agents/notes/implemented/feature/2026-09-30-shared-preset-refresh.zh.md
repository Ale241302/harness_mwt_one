# Agent Note: the gateway refreshes deployment-seeded agent presets

Status: implemented

[English](2026-09-30-shared-preset-refresh.md) | 中文

## Problem

`writeUserPresets` 只在目标不存在时才把每个 `agents-shared/<preset>` 目录复制到 `<DSH_HOME>/.agent-presets`，因此预设变更之前就配置好的 owner 会永久保留过期的组合——包括其 persona、工具行与技能行。对同一 owner 连续两次部署都静默地继续使用第一份副本，persona 修复只能到达之后新建的 owner。

## Decision

- 网关把已播种的预设记录在 `.agent-presets/.deployment-seeded.json`。每次实例启动时，它都会从 `agents-shared/` 重新复制带标记的预设。没有标记的预设不予改动，除非它与源逐字节相同，此时先将其纳入标记，从而为标记出现之前就已播种的 owner 完成迁移。owner 自建或编辑过的预设与源不匹配，因此永不覆盖。
- `dsh-agent-presets` 只发现名字符合其 preset-id 语法的目录，因此预设目录旁的标记文件是惰性的。

## Alternatives considered

**无条件覆盖每个 `agents-shared/<name>`。** 这会覆盖 owner 自己恰好与部署预设同名的预设；标记让两种来源保持区分。

**在读取时刷新。** 预设名册由 harness 按会话读取；从该路径改写 home 会把部署数据耦合到会话时的读取。

## Consequences

- `agents-shared/` 的变更会在下次 dsh 启动时到达每个 owner，而不仅是之后新建的 owner。
- 编辑过部署播种预设的 owner 会在下次启动时丢失该编辑；该预设按定义归部署所有。

## Testing

已部署到 VPS 并观察：在 persona 变更之前已播种的某 owner 的 `sicop-analyst` 预设，在启动时被刷新为新 persona，并在其旁写入了 `.deployment-seeded.json`。仓库没有网关测试框架，因此该行为由这次部署运行验证。
