# Agent Note: 空间拥有自己的对话区，工作台可以处理条目

Status: implemented

[English](2026-09-22-spaces-workspace-link-and-bench.md) | 中文

## 问题

计划承诺的两条接缝缺失。FaberLoom 空间与 harness 工作区是互不相干的模型——会话按磁盘目录分组，空间对此一无所知，因此"空间的对话"并不存在。工作台（Work bench）此前只有批准、驳回、重开：没有提交准备好的修订、没有异常状态、没有效果明细，所以读起来像演示而不是结果收件箱。另外，以 `@Agent` 开头的消息只作为纯文本到达模型，没有任何规则告诉助手要扮演该专家。

## 决策

链接就是每个空间一个目录，并把它注册为该空间的工作区；工作台通过 view remote 补齐缺失的动词；提及规则是一节附加的提示词。

- `faberloomView.spaceWorkspace(id)` 以只读方式投影空间对话区（由 spaces 服务解析出的 `fw_` 工作目录，在工作区注册表中查找，含会话计数，绝不创建任何东西）；`openSpaceWorkspace(id)` 将其落实：在 `<DSH_HOME>/spaces/<fw_ref>` 下 `mkdir`，调用 `workspaceRegistry.create(dir, space.title)`——按规范化路径幂等。Spaces 详情显示该区域，"在此空间中开始新对话"直接在其中开启会话，因此侧边栏的工作区组和空间是同一组。Members 和 Sources 字段在可操作之前先离开详情；数据模型保留两者。
- 新 remote：`submitBoardRevision`、`boardException`（request_data / fail / complete），以及 `reviewBoardItem` 的 `note` 参数，全部像其他写操作一样有 read-only 守卫。工作台渲染完整证据、带明细和日期的效果、一个会重新开始评审的修订提交表单、评审备注，以及仅在已批准时出现的"完成"动作。
- `tool-faberloom` 注册 `faberloom:mentions` 系统提示词节：以 `@Name` 开头即寻址目录中该 agent（通过 `faberloom_agents_*` 工具扮演该专家），以 `/name` 开头即调用该 skill，名字不存在则回答可用列表。

## 已考虑的替代方案

- **在空间记录上存储工作区 id。** 否决：路径由 `ownerId:spaceId` 确定性得出（与 `resolveWorkdir` 返回的摘要相同），且 `workspaceRegistry.create` 按规范化路径幂等——存储的链接只会漂移。
- **创建空间时即创建工作区。** 否决：未使用的空间会占一个空的侧边栏组；在首次对话时才落实能保持读取无副作用（`spaceWorkspace` 不创建任何东西）。
- **做一个在回车时真正运行 agent 的宿主 `delegate` 命令。** 推迟而非实施：`faberloomAgents.delegate` 只是准入与预算簿记（不运行模型回合），真正的委派会话属于 subagent 运行时并需携带 agent 策略——错误的捷径会伪造这个手势。提示词规则让今天的 `faberloom_agents_delegate` 路径先可靠起来。
- **保留 Members/Sources 可见。** 否决：members 尚无多用户语义，sources 无法从 UI 添加，二者读起来都像坏的；字段保留在模型与 MCP 工具中。

## 后果

- 选中一个空间不创建任何东西；第一次"在此空间中开始新对话"才创建其工作目录和侧边栏组，此后该空间的会话都生活在自己的工作区下。
- 从工作台提交的修订走与例程相同的 `submitRevision`，UI 与引擎保持同一条评审路径；批准仍然绑定被评审的确切版本。
- 提及规则在 tool-faberloom 挂载期间随每次提示发送（一节，token 成本小，作为 effect 注册并随 fiber 释放）。
- 本切片不新增工具（是 remote 而非 tool），因此 `docs/tool-catalog.md` 不变；Typert 客户端已随新 remote 重新生成（`pnpm run build:lib:host`）。
