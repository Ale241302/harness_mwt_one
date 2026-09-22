# Agent Note: 角色 skill 目录恢复可解析

Status: implemented

[English](2026-09-22-skills-catalog-frontmatter.md) | 中文

## 问题

出厂角色目录（`skills-catalog/<role>/<skill>/SKILL.md`）中的每个 skill 都被 harness skill 注册表静默忽略，因此所有用户的输入框 `/` skill 菜单都是空的。两个缺陷叠加：每个 `description` 含有未加引号的冒号（`Herramientas MCP: …`），导致 YAML frontmatter 无法解析；而 `client_b2b` 角色的名字带下划线（`mwt-client_b2b-…`），被 harness 的 kebab-case `SKILL_NAME` 规则拒绝。provider 的警告逐个点名了这两个问题。

## 决策

就地修复目录，并让扁平化脚本（flattener）产出合法输出，使重新生成不会重新引入缺陷。

- 一次性修复为每个 `description` 值加引号（YAML 双引号并转义），把每个 `name` 归一化为 kebab-case（非 `[a-z0-9]` 片段替换为 `-`），并把 23 个 `client_b2b` skill 目录重命名为新名字：共修复 652 个文件，重命名 23 个目录。
- `scripts/flatten-skills.mjs` 在写出每个 `SKILL.md` 时应用同样的归一化——`description` 加引号、`name` 转 kebab-case——因此下一次目录再生天然产出可加载的文件。

没有任何消费者引用旧的下划线名字：defaults 目录用 `mwt-compras-*`（已是 kebab）为 agent 播种，view 则从目录实时读取名字。

## 已考虑的替代方案

- **放宽 `SKILL_NAME` 以接受下划线。** 否决：该命名规则是上游的模型可见约定（skill 名出现在 `/` 调用和提示文本中），且只有 `client_b2b` 角色受影响——归一化目录比放宽语法更小。
- **只修 flattener 并重新生成。** 否决：生成来源（Skills-MCP 检出）不属于本仓库，因此无论如何都需要就地修复；flattener 的修复使两者不再漂移。

## 后果

- 每个角色的完整目录都能被发现加载（用包自带的测试 harness 验证：admin 132、client_b2b 23、compras 66 个 skill，零警告），因此 `/` 能列出角色 skill，预步骤注入也能加载其正文。
- 重命名的 `client_b2b` skill 在所有位置（菜单、面板、agent 分配）以 kebab 名出现，没有兼容层：没有任何持久数据引用旧名字。
- flattener 的修复是幂等的，在已修复的树上输出与一次性脚本一致。
