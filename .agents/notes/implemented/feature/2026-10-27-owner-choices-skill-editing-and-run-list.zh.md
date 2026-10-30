# Agent Note: Owner choices survive restarts, skills are editable, and runs read in plain language

Status: implemented

[English](2026-10-27-owner-choices-skill-editing-and-run-list.md) | 中文

## Problem

在一次 Marluvas 操作员的工作会话中暴露出四个缺口。

默认播种器在每次启动时都会把部署的提供方和模型设置到每个基线智能体上（[智能体归属](2026-09-27-agent-ownership-and-permissions.zh.md)）。所有者把 `Operador Marluvas` 切换到另一个提供方并粘贴该提供方的密钥后，下一次网关重启会把部署提供方改回去，而新密钥保留：智能体最终用一个提供方的密钥去调用另一个提供方。

技能详情对话框是只读的，只能通过上传整个 `.md` 文件来替换技能，并且使用该技能的智能体只显示为八个字符的 id 前缀。

例程执行列表把每次运行打印成一行密集的内容：原始状态标记、版本、步骤选择器，以及被截断到几行的步骤文本。运行按存储顺序排列，没有日期和触发来源，并原样显示引擎失败（`routine … version 118 not found`、`agent … not found`、提供方的 JSON 配额错误）。

网关重启时会用它的 HTML 页面回应若干面板调用，面板把 `Unexpected token '<'` 显示为操作失败，连它自己每五秒一次的后台刷新也是如此。

## Decision

**基线智能体跟随部署设置，直到所有者选择了提供方或模型。** `faberloom-defaults` 在 `DSH_HOME/faberloom-baseline-applied.json` 中按基线智能体 id 记录它应用的提供方/模型组合。之后启动时，如果智能体当前的组合与记录不同，说明所有者编辑过，该轮不再改动其提供方和模型。没有记录的智能体照旧收敛一次。播种之后会再运行一次该轮，使本轮新建的智能体也被记录。API 密钥规则不变：只有在未存储密钥时才写入部署密钥。

**除传入共享外的任何技能都可以在编辑器中打开。** 视图新增 `skillMarkdown(name)`，返回列表所显示的 SKILL.md（优先所有者副本，其次共享或角色目录）。保存走现有的 `saveSkill`，因此编辑角色或共享技能会在 `DSH_HOME/skills` 下写入所有者副本。这类副本的行报告 `replacesCatalog: true`，删除它的操作标注为恢复目录版本。为了让副本在运行时也生效，桌面端和网关上 `faberloom-role` 技能提供方的 `customSkillDirs` 第一项现在是所有者的技能目录：在同一个提供方内，第一个目录在名称重复时胜出。

**技能行写出使用它的智能体名称。** `FaberLoomSkillRow.assignedNames` 按 `assignedTo` 的顺序携带智能体名称，对话框显示名称。

**运行按从新到旧排列，并显示触发来源和直白的结果。** 每次运行显示带状态颜色的本地化状态词、开始日期、`完成/总数` 步骤和版本、启动它的事件主题，以及最新步骤文本的第一行。已知的引擎失败（例程版本缺失、智能体缺失、提供方余额或配额耗尽）显示一句说明原因和下一步操作的话；原始文本保留在每次运行折叠的区块中，其中列出每个步骤、已完成效果步骤的取消效果操作，以及针对待复核、失败或等待中运行的 Reconcile。列表显示十次运行，其余按需展开。

**服务器未响应时就如实显示。** `Feedback` 把 HTML 响应、遇到 `<` 的 JSON 解析失败和网络拒绝映射为同一条消息：服务器没有响应，数据没有丢失。一旦已有数据行，后台概览刷新不再标记错误；下一次轮询会重试。

## Alternatives considered

完全取消提供方/模型收敛，会让早期部署播种的智能体停留在部署不再付费的提供方上。只与部署默认值比较，无法区分所有者的选择和过时的默认值。

把编辑后的角色技能写回角色目录，会改变该角色所有用户的技能，并会被下一次部署覆盖。

## Consequences

所有者在基线智能体上选择的提供方或模型现在能跨重启和部署保留；更改部署默认值不再影响该智能体。记录文件按 home 存放，并以智能体 id 为键。

运行列表不再提供步骤选择器；相关操作移到每次运行的步骤列表中。

## Verification

- `packages/faberloom/defaults/tests/defaults.spec.ts`：在配置了部署默认值的情况下，所有者在基线智能体上设置的提供方和模型在重启后保留；原有对未记录的过时值的收敛测试仍然通过。
- `packages/faberloom/view/tests/workspace-board.spec.ts`：角色技能列出其智能体名称，可通过 `skillMarkdown` 读取，经 `saveSkill` 后成为带 `replacesCatalog` 的所有者副本；未知名称被拒绝。
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：技能对话框显示智能体名称，打开带目录提示的编辑器并保存编辑后的文本；运行列表按从新到旧排序，显示触发主题、待复核状态、直白的缺失智能体原因和摘要行，且 Reconcile 只出现在待复核的运行上。
