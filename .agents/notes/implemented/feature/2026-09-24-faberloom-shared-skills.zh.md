# Agent Note：一套精选的共享技能目录随每个角色提供

Status: implemented

[English](2026-09-24-faberloom-shared-skills.md) | 中文

## 问题

harness 只暴露角色的 MCP 业务技能（`<skillsCatalogRoot>/<role>/<skill>`），因此两个用户各自携带互不相交的技能集，也都够不到跨角色适用的通用技能——研究、思考或运营手册。从邮件打开 Space 时也同样以空手册开始：智能体拿到了邮件，却没有任何方法来追问用户真正想要什么。

## 决定

网关在角色目录之外再暴露第二个技能根 `<skillsSharedRoot>`（`/opt/skills-shared`），使每个用户无论角色如何都获得同一套精选技能。`skills-shared/` 从 ECC（MIT）引入 18 个通用技能，加上所有者自己的 `interview-me`；邮件→Space 的种子在第一轮就应用 `interview-me`。

- 当该目录存在时，`renderPatch` 把 `skillsSharedRoot` 加入 `faberloom-skills`（`dsh-skill-filesystem`）来源的 `customSkillDirs`，即使该用户没有角色目录也一样。
- 这些文件随仓库发布（`skills-shared/**`，由 Dockerfile 复制到 `/opt/skills-shared`，并由 `push-to-vps.ps1` 上传），因此纳入版本控制并与 harness 一起部署。
- ECC 采用 MIT 许可；`skills-shared/ECC-LICENSE.txt` 记录了来源、版本、文件清单与许可证。

## 考虑过的替代方案

**复制全部 292 个 ECC 技能。** 其中大多是无关的技术栈（kotlin、laravel、swift）；精选集合能让目录信噪比更高、评审更小。

**按用户播种 `$DSH_HOME/skills`。** 网关会在实例启动时复制文件；仓库已经用同样的方式发布角色目录，再加一个检出的根并无额外价值。

## 后果

- 共享技能在每个会话中都可被模型调用；同名时角色目录仍会覆盖共享技能。
- FaberLoom 的技能面板只列角色根，因此共享技能暂不出现在其中。
- 引入的技能不是 npm 依赖，因此它们自带许可证文件，而不是记入 `THIRD_PARTY_NOTICES`。

## 测试

`packages/faberloom/view/tests/space-from-email.spec.ts` 断言种子点名了 `interview-me`。网关渲染来源配置并由部署冒烟覆盖；实机会话确认该技能可被加载。
