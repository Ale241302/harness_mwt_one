# Agent Note: curated skills and connected agents for the shared presets

Status: implemented

[English](2026-09-27-preset-skill-and-agent-curation.md) | 中文

## 问题

`agents-shared/` 下的 35 个共享 agent 预置只包含 `preset.yml`（name、description、order）和生成的 `agent.cordis.yml`。该组合是随发布的 `standard` 预置加上通用 persona 前缀：它不包含 agent 正文、不含具体 skill 名称，也没有团队。这些内容位于本仓库未 vendor 的上游 ECC 目录，且此处没有生成器。因此被供给的预置 agent 启动时既没有 skill 也没有连接，仓库中也没有任何东西能推导出它们。

## 决策

这些 skill 与协作伙伴是**人工整理**而非提取，位于 `packages/faberloom/defaults/src/preset-curation.ts`，按 `agents-shared/` 下的预置目录 id 索引。

- `skills` 列出 `skills-shared/` 中的真实 skill 名称；供给器只保留部署实际随附的那些（role 目录、通过新增的 `skillsSharedRoot` 提供的共享目录，或所有者上传）。
- `connects` 列出其他预置目录 id；供给器按名称解析为已供给的 agent 并写入其 `subagents`。
- 现在创建的预置 agent 会带着整理好的 skill 与连接启动。更早部署供给的 agent 会把整理好的 skill 合并进去（取并集，保留其已有项），并且仅在其自身未声明连接时才获得连接，因此 Admin 的选择在重启后仍保留。
- gateway 把 `skillsSharedRoot` 传给 `faberloom-defaults`，使可用性检查能看到整理后的共享目录。
- 三个原生种子 agent 也声明了 `connects`（Recepción → Revisión de pedidos → Proformas），并同时列出角色的 `mwt-compras-*` skill 与对应的 `mwt-admin-*`；供给器只保留所有者角色实际随附的那些，并在重启时把目录中的 skill 合并进更早部署供给的 agent。

## 考虑过的替代方案

**把 `skills`/`connects` 放进每个 `preset.yml`。** 该文件供会话预置元数据读取器使用，描述的是 dsh agent 预置；而 skill 与团队属于由它供给的 FaberLoom agent 目录。把整理集中在一张可评审的映射中，避免同一事实有两个归属，也不改动随发布的预置格式。

**从外部 ECC 目录推导。** 该目录未 vendor，仓库中也没有生成器，因此构建步骤必须拉取一个会变化的外部源。人工整理这张映射是诚实的做法。

## 后果

- 每个被供给的预置 agent 都会带着若干真实 skill 启动，并指向与之协作的 agent；该图天然无环（`chief-of-staff` → 专家，`code-reviewer` → 简化/安全，GAN 与开源链条按顺序）。
- 映射中部署未随附的 skill 名称会被静默丢弃，未挂载的伙伴预置不会被连接，因此部分部署仍保持一致。
- 该映射是内容：改动某个 agent 的 skill 或团队就是编辑一个文件，且校验器可检查每个名称都能解析。

## 测试

`packages/faberloom/defaults/tests/defaults.spec.ts` 以共享 skills 根供给一个 `code-reviewer` 预置，并断言该 agent 的 `skills` 恰为整理且可用集合、其 `subagents` 指向已挂载的 `security-reviewer`。一次仓库检查确认全部 35 条映射项都指向真实的 `skills-shared/` skill 与真实的 `agents-shared/` 预置 id。
