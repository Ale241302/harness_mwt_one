# Agent Note：删除 Space 的工作区会删除该 Space

Status: implemented

[English](2026-09-24-faberloom-workspace-delete-cascade.md) | 中文

## 问题

Space 的对话区域是一个已注册的 dsh Workspace。从侧边栏删除该工作区只移除了注册记录：FaberLoom 的 Space 仍在，且它的 `agentId` 仍让智能体与之关联，于是两者看起来互不相连。

## 决定

工作区注册表在一次提交后的删除后发出 `workspace/removed(workspaceId, path)`，FaberLoom 视图据此丢弃工作目录与该路径匹配的 Space。

- `packages/workspace/workspace` 声明 `workspace/removed` 事件，并在 `deleteKnown` 中于记录与注册顺序提交之后发出它。
- `FaberLoomViewService` 在构造函数中订阅，通过比较每个 Space 的 `<DSH_HOME>/spaces/<ref>` 与所删除路径来解析出 Space，再将其移除——这同时会删除它的文件并解除智能体关联。
- 从面板删除 Space 时本就会移除其工作区；有了新事件，该路径现在也走同一处理器，而幂等的移除让第二次调用无害。
- Space 移除后，若已无其他 Space 引用其智能体，则该智能体也被移除，使被删除的区域不会留下孤立的专家；移除失败只记录日志，不会让删除失败。

## 考虑过的替代方案

**在每次读取总览时对账。** 把删除当作读取的副作用既令人意外，又在工作区短暂缺失时不安全。

**禁止对 Space 区域删除工作区。** 侧边栏的工作区分组与 Space 本就是同一个东西；隐藏删除会让用户无法从侧边栏移除该区域。

**让 API 的 workspace-controller 调用 FaberLoom。** 那一层不应依赖产品包。

## 后果

- Agentes 面板的 Space 列会因总览从 Space 记录派生而随之清空。
- 任何其他镜像工作区的消费者现在也能响应同一事件。

## 测试

`packages/faberloom/view/tests/workspace-board.spec.ts` 驱动该移除处理器与孤立智能体的移除：当另一个 Space 仍在使用时保留该智能体，一旦没有则移除，移除失败也不会让删除失败。工作区注册表既有的删除测试覆盖了该事件的发出。
