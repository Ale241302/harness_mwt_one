# Agent Note：ECC 全目录以共享技能的形式随每个角色提供

Status: implemented

[English](2026-09-24-faberloom-shared-skills.md) | 中文

## 问题

harness 只暴露角色的 MCP 业务技能（`<skillsCatalogRoot>/<role>/<skill>`），因此两个用户各自携带互不相交的技能集，也都够不到团队已经放在 ECC 里的通用研究、思考与运营手册。从邮件打开 Space 时也同样以空手册开始：智能体拿到了邮件，却没有任何方法来追问用户真正想要什么。而持久技能目录是模型可见的，因此天真地导入数百个技能会在每个会话中耗费上下文。

## 决定

网关在角色目录之外再暴露第二个技能根 `<skillsSharedRoot>`（`/opt/skills-shared`），使每个用户无论角色如何都获得同一套共享技能。`skills-shared/` 引入 ECC 目录（MIT）加上所有者自己的 `interview-me`；邮件→Space 的种子在第一轮就应用 `interview-me`。

- 导入范围：逐字复制 292 个 ECC 技能，把 94 个命令改写为名为 `cmd-<command>` 的用户可调用技能，把 68 个智能体改写为名为 `agent-<agent>` 的用户可调用技能。前缀避免了 ECC 技能与命令之间那 9 个重名。
- 模型可见性就是 token 杠杆：只有 24 个精选技能——包括 `interview-me` 以及应请求加入的 `security-scan`、`production-audit`、`plan-orchestrate`、`code-tour`、`skill-scout`——是模型可调用的，进入持久技能目录。其余每个技能、命令与智能体都带 `disable-model-invocation: true`，因此目录始终只有 24 条，而整套仍可经 `/name` 触达。
- 当该目录存在时，`renderPatch` 把 `skillsSharedRoot` 加入 `faberloom-skills`（`dsh-skill-filesystem`）来源的 `customSkillDirs`，即使该用户没有角色目录也一样。
- 这些文件随仓库发布（`skills-shared/**`，由 Dockerfile 复制到 `/opt/skills-shared`，并由 `push-to-vps.ps1` 上传），因此纳入版本控制并与 harness 一起部署。
- ECC 采用 MIT 许可；`skills-shared/ECC-LICENSE.txt` 记录了来源、版本、数量与许可证。

## 考虑过的替代方案

**只导入精选集合。** 它让目录保持很小，却屏蔽了 ECC 的其余部分；用户可调用技能不消耗目录 token，因此整套保留没有成本。

**让每个 ECC 条目都可被模型调用。** 目录会把约 380 条描述带入每个会话；`/name` 路径以零目录成本覆盖长尾。

**把 ECC 智能体映射为 dsh 的 agent preset。** preset 按会话组合插件与工具选择；这些智能体正文本身就是指令集，把它们改写为用户可调用技能即可保留其内容，且无需逐个映射工具名。

## 后果

- 只有 24 个精选技能消耗目录 token；其余技能、命令（`/cmd-<name>`）与智能体（`/agent-<name>`）都能按名触达且不消耗目录。
- 同名时角色目录仍会覆盖共享技能。
- FaberLoom 的技能面板只列角色根，因此共享技能暂不出现在其中。
- 引入的技能不是 npm 依赖，因此它们自带许可证文件，而不是记入 `THIRD_PARTY_NOTICES`。

## 测试

`packages/faberloom/view/tests/space-from-email.spec.ts` 断言种子点名了 `interview-me`。网关渲染来源配置并由部署冒烟覆盖；实机会话确认精选技能可从目录加载，`cmd-`/`agent-` 技能可经 `/name` 加载。
