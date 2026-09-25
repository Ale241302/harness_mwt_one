# Agent Note：ECC 全目录以共享技能的形式随每个角色提供

Status: implemented

[English](2026-09-24-faberloom-shared-skills.md) | 中文

## 问题

harness 只暴露角色的 MCP 业务技能（`<skillsCatalogRoot>/<role>/<skill>`），因此两个用户各自携带互不相交的技能集，也都够不到团队已经放在 ECC 里的通用研究、思考与运营手册。从邮件打开 Space 时也同样以空手册开始：智能体拿到了邮件，却没有任何方法来追问用户真正想要什么。而持久技能目录是模型可见的，因此天真地导入数百个技能会在每个会话中耗费上下文。

## 决定

网关在角色目录之外再暴露第二个技能根 `<skillsSharedRoot>`（`/opt/skills-shared`），使每个用户无论角色如何都获得同一套共享技能。`skills-shared/` 引入 ECC 的技能与命令目录（MIT）加上所有者自己的 `interview-me`；邮件→Space 的种子在第一轮就应用 `interview-me`。

- 导入范围：逐字复制 292 个 ECC 技能，把 94 个 ECC 命令改写为名为 `cmd-<command>` 的用户可调用技能。ECC 智能体在这里不是技能；它们作为原生 preset 发布（见[说明](2026-09-24-faberloom-native-agent-presets.zh.md)）。
- 模型可见性就是 token 杠杆：只有 24 个精选技能——包括 `interview-me` 以及应请求加入的 `security-scan`、`production-audit`、`plan-orchestrate`、`code-tour`、`skill-scout`——是模型可调用的，进入持久技能目录。其余每个技能与命令都带 `disable-model-invocation: true`，因此目录始终只有 24 条，而整套仍可经 `/name` 触达。
- 当该目录存在时，`renderPatch` 把 `skillsSharedRoot` 加入 `faberloom-skills`（`dsh-skill-filesystem`）来源的 `customSkillDirs`，即使该用户没有角色目录也一样。
- FaberLoom 的 Skills 面板把共享根列为第三种来源（`shared`），与角色目录和用户上传并列，因此整个目录都能在那里看到。
- 这些文件随仓库发布（`skills-shared/**`，由 Dockerfile 复制到 `/opt/skills-shared`，并由 `push-to-vps.ps1` 上传）；ECC 采用 MIT 许可，`skills-shared/ECC-LICENSE.txt` 记录来源、数量与许可证。

## 考虑过的替代方案

**只导入精选集合。** 它让目录保持很小，却屏蔽了 ECC 的其余部分；用户可调用技能不消耗目录 token，因此整套保留没有成本。

**让每个 ECC 条目都可被模型调用。** 目录会把数百条描述带入每个会话；`/name` 路径以零目录成本覆盖长尾。

**把 ECC 智能体也保留为技能。** 既然智能体已是原生 preset，重复的 `agent-*` 技能已被删除；组合出来的智能体更适合用 preset 表达。

## 后果

- 只有 24 个精选技能消耗目录 token；其余技能与命令（`/cmd-<name>`）都能按名触达且不消耗目录。
- 同名时角色目录仍覆盖共享技能，用户上传再覆盖两者。
- 引入的技能不是 npm 依赖，因此它们自带许可证文件，而不是记入 `THIRD_PARTY_NOTICES`。

## 测试

`packages/faberloom/view/tests/space-from-email.spec.ts` 断言种子点名了 `interview-me`。网关渲染来源配置并由部署冒烟覆盖；实机会话确认精选技能可从目录加载、`cmd-` 技能可经 `/name` 加载、且 Skills 面板显示 `shared` 来源。
