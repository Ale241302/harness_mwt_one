# Agent Note: 回放关闭技能监视器，使 skill-install 场景与宿主无关

Status: implemented

[English](2026-10-13-replay-skill-watcher-determinism.md) | 中文

## Problem

`skill-install` 与 `skill-uninstall` 两个 headless 场景在一次运行中安装一个技能，第二个场景随后再删除它，然后比较持久化的会话。技能目录以在步骤边界追加的一条 `user/message` 抵达模型；`@deepseek-ai/dsh-tool-skill` 由 `ctx.skills.snapshot(...)` 计算它，该调用读取当前目录，但在文件系统提供方的监视器使其失效之前，返回的是注册表中缓存的副本。Chokidar 在异步定时器上完成其 `awaitWriteFinish` 稳定窗口，因此新安装的 `greet` 目录能否在下一个步骤边界可见，取决于宿主的监视器时序，而不取决于安装器。

夹具固定了那条目录消息。监视器在下一步骤之前观察到变化的宿主通过；监视器晚一个步骤、或在这段短运行内根本没有观察到的宿主，则因缺少目录 `user/message` 而失败。该场景因此固化了某个宿主的监视器延迟，而这正是夹具策略所禁止的跨平台失败。

## Decision

`snapshots/session/text-turn/cordis.snapshot.yml` 是普通 headless 组合共享的回放与刷新补丁，其中以 `watch: false` 组合 `@deepseek-ai/dsh-skill-filesystem`。回放与刷新因此不会在步骤边界观察到目录变化，这两个场景提交的夹具也去掉目录 `user/message` 行；其 `sourceEventSeqs` 引用与 `{{message:N}}` 令牌按保留下来的记录重新编号。实时记录（`snapshots/session/text-turn/cordis.yml`）保持监视器开启。Web 脚手架此前已出于同样的原因关闭了同一行。

安装器的外部效果仍被独立断言。`snapshots/session/headless.snapshot.ts` 中的 `verifySkillInstallEffect` 在运行后读取文件系统：`skill-install` 必须留下带有 `.dsh-skill-install.json` 标记的 `greet` 目录，标记内容为 `name: greet` 与 `destination: global`；`skill-uninstall` 必须不留下 `greet` 目录；两者都绝不能创建被拒绝的 `not-a-skill` 目录。这个判定器才是这些场景所证明的内容。目录消息是监视器时序的副产物，而不是安装器所拥有的行为。

## Testing

同一轮覆盖语料库的 `DSH_SNAPSHOT=refresh` 重录了若干请求头边车：它们固定的工具声明早于已发布的 `install_skill` 与 `uninstall_skill` 工具（`advanced`、`both`、`ptc`、`ptc-node-*`、`ptc-python`、`ptc-image`、`ptc-workspace-context`、`mcp-empty-ptc`、`mcp-resources-ptc`），以及 `space-*` 固定项所缺的 space 代理平面字段（`mwtMcp`、`sicopMcp`、`webAccess`），另加 `snapshots/sdk/subagent-*` 下两个子会话的 `tool-schemas.1.expected.json`。它还推进了两个会话夹具：`cordis-inspect-jsdoc` 不再列出 `ToolResult` 目录条目，`space-cross-reference` 以其值自带的句点渲染策展规则（`…de Sondel..`）。重录后该通道通过，仅 `pwsh` 平台场景被跳过。

## Alternatives considered

- **保留目录消息并为监视器留出更多时间。** 否决：没有任何提供方或场景开关能让异步文件系统事件必然落在固定步骤边界之前；更长的步骤只会缩小竞态，而不会消除它。
- **让 `install_skill` 同步使技能注册表失效。** 否决，因为它属于夹具修复之外的产品改动：`skill-filesystem` 暴露了 `observeHostMutation`，但 `dsh-skill-install` 通过原始 `node:fs` 写入且不发出 `fs/observed`，因此接线会触及 `packages/skill/skill-install`，并需要自己的覆盖。
- **只在某个宿主上记录夹具，并接受另一个宿主失败。** 否决：快照通道是必需的 macOS/Linux 门禁，而固化某个宿主监视器延迟的夹具正是要修复的缺陷。

## Consequences

- 回放不再覆盖运行中途的目录刷新。监视器驱动的重新发布仍由 `packages/skill/skill-filesystem/tests/skill-filesystem-watcher.spec.ts` 与 `packages/skill/tool-skill/tests/tool-skill.spec.ts` 覆盖。
- 未来若某场景需要在运行中途改变目录，它必须拥有一个重新启用监视器的组合，而不能依赖共享的回放补丁。
