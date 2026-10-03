# Agent Note: 自动与语义化的 Space 上下文

Status: proposed

[English](2026-10-03-automatic-semantic-space-context.md) | 中文

## 问题

跨空间工具按词法查找解析 Space，并按需咨询其 agent，但三项自动行为仍然延后：没有语义索引、没有活动 Space 的自动注入、也没有记忆蒸馏。[spaces 服务](../../../../packages/faberloom/spaces/src/index.ts) 以折叠后的词法词项排序，会漏掉同义词与跨语言措辞，因此模型仍必须先具名或找到某个 Space，其上下文才会生效。一次咨询在父级工作区中运行，因为 `resolveWorkdir` 返回的是不透明引用而非路径。一个已关闭的案例不会留下任何 teaching，除非有人手动记录。

## 提案

### 切片状态

- 切片 6.1 已发布：`ctx.spaceIndex` 是一个接缝，默认使用词法排序器，`find` 委托给已挂载的 provider。
- 切片 6.2 至 6.5 已规划：活动 Space 注入、真实 Space 工作目录、记忆蒸馏，以及 ECC/知识中枢集成。

### `ctx.spaceIndex` 接缝（6.1，已发布）

[spaces 类型](../../../../packages/faberloom/spaces/src/types.ts) 导出带一个 `rank(entries, query, limit)` 方法的 `SpaceIndex`，以及它读取的 `SpaceIndexEntry` 候选。`find` 构建该 actor 可读取且未归档的条目，并调用 `ctx.get('spaceIndex')`；当没有挂载 provider 时，它调用内置的词法排序器，因此排序永不回退。provider 包只替换排序，绝不接触存储或访问控制。

### 活动 Space 与自动注入（6.2）

新增 `FaberLoomSpaces.spaceForWorkspace(actor, workspaceId)`，解析镜像某个 Workspace 的 Space，并新增一个动态提示区段，携带该 Space 的 `effectiveContext`、记忆与指令。该区段按会话从其工作区注册，并且可选启用，因为它会改变该会话每次请求的 node 0，且当活动 Space 变化时，路由必须容忍 KV 缓存失效。

### 真实 Space 工作目录（6.3）

通过 `ctx.workspaceRegistry` 把 `space.workspaceId` 解析为已注册 Workspace 的路径，并把它传给被委托子代理的创建选项，使一次咨询在 Space 的真实目录中运行。沙箱策略与包含性检查仍拥有该边界。

### 记忆蒸馏（6.4）

当某个工作台条目被批准或某次执行完成时，使用 `ctx.sessionQuery` 与会话引用上下文从该案例对话中蒸馏一条候选 teaching，并以 `source` 指向该案例。该 teaching 保持候选状态，直到有人确认，因此自动学习绝不悄悄改变行为。

### ECC 与知识中枢集成（6.5）

一个 `space-index` provider 包拥有 embeddings，并在部署接入时以 MWT 知识中枢作为后端。中枢拥有索引数据、保留与驻留；provider 只拥有查询映射，而 `find` 仍是唯一消费方。ECC 为该包提供可复用技能与门禁，而非运行时行为。

## 备选方案

**把 embeddings 放进 spaces 服务内。** 它会把持久记录耦合到模型 provider 与网络依赖；接缝让排序可替换，并让服务在无 provider 时可测试。

**始终开启活动 Space 注入。** 即使任务不需要任何 Space 上下文，它也会改变每次请求的前缀；把可选区段限定在会话工作区可让改动保持有意为之。

**复用不透明的工作目录引用。** `resolveWorkdir` 有意不含路径；真实路径需要工作区注册表及其包含性，因此它是一个独立切片。

**把 teachings 直接蒸馏为 active。** 未确认的推断是候选；在没有人的情况下将其提升，会让错误的一般化改变后续行为。

## 验收标准

- 切片 6.1 委托给已挂载的 `ctx.spaceIndex`，并在缺失时回退到词法排序，且单元测试覆盖两者。
- 切片 6.2 解析工作区镜像并在会话级提示区段中携带活动 Space，且由一个无密钥快照在激活前后固定。
- 切片 6.3 让一次咨询子代理在 Space 的已注册工作区路径中运行，并以路径断言证明。
- 切片 6.4 在案例被批准时恰好记录一条以该案例为 source 的候选 teaching，且不产生 active teaching。
- 切片 6.5 记录 provider 包、中枢集成，以及保留与驻留的归属。

## 风险

语义索引会增加 embedding 成本、延迟与不确定性；接缝保留词法排序器作为默认与回退。自动注入与蒸馏会改变模型可见输入，因此各自需要快照与可选启用。知识中枢引入数据驻留与保留义务，必须由部署而非 harness 拥有。
