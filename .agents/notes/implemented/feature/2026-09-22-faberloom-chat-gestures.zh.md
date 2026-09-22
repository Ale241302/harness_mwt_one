# Agent Note: FaberLoom 聊天手势在输入框中寻址 agent 并运行例程

Status: implemented

[English](2026-09-22-faberloom-chat-gestures.md) | 中文

## 问题

产品面板可以创建 agent 和例程，但聊天——计划中的主要入口——两者都无法触达：`@` 只提供文件和会话，`/` 只提供宿主命令。调用例程必须离开对话，而在文本中写出 agent 名字也没有用户可发现的手势。

## 决策

这些手势作为 trigger/command 贡献落在 FaberLoom 表面插件的现有座位上，而不是新的宿主命令或 fork 的输入框。

`packages/client/ui-faberloom/src/client/triggers.ts` 在 `apply` 中注册：

1. 一个名为 `agents` 的 `@` `InputTriggerSource`（排序在文件/会话组之上），其候选来自 `ctx.remote.faberloomView.overview()` 的工作区概览，过滤为活跃 agent 并匹配当前查询，行描述显示 agent 所属空间。选中插入纯文本 `@name `；模型收到的是用户消息中的名字，委派仍由宿主的 `faberloom_agents_delegate` 工具负责。
2. 一个 `/routine` `CommandContribution`（`popupSelect`），列出所有者的例程及其状态徽标；选中后调用 `faberloomView.startRoutine(id)`——与 Rutinas 面板使用的同一个 Remote，因此运行落在同一个执行服务中，并出现在 Runs 面板里。

概览读取在手势模块内缓存五秒，因为候选过程随每次按键运行。两个手势都通过声明的 Remote 命名空间读取，客户端不写任何东西；概览读取失败时提供最后一次成功的副本或空组，绝不在输入框中显示错误卡片。

## 已考虑的替代方案

- **为例程做宿主命令。** 否决：宿主 `ctx.commands` 注册表会记录 `command/run` 会话事件，且仍需客户端装饰；客户端 `popupSelect` 贡献直接触达面板使用的同一 Remote，把行为保持在一处，也不增加会话日志词汇。
- **为 `@agent` 做带 codec 的引用芯片。** 本阶段否决：芯片需要新的引用类型和打开目标；纯文本让手势保持诚实（模型看到的正是用户输入），直到出现 agent 寻址会话模式。
- **FaberLoom 自有的 `/` skill 源。** 否决：宿主 `ui-skill` 源在目录可解析后已能列出角色目录（见目录修复记录）；重复分组会让每个 skill 显示两次。

## 后果

- `@` 菜单保留文件和会话组在 agents 组之下；两个源共存，因为唯一性是 `(trigger, name)`。
- `/routine` 不离开聊天即可启动运行，且因为同一个执行服务服务两个入口，运行在 Runs 中可见。
- 这些手势在被寻址的 subagent 会话中不可用，与 model 和 skill 源的边界一致。
- 带空格的 agent 名会以多词 `@name` 纯文本插入；此类提及的精确匹配仲裁推迟到 agent 寻址会话模式定义之时。
