---
description: "原生产品调度器（ctx.faberloomExecutions）：在无人、无打开会话的情况下启动到期的 date 与 recurrence 例程、推进可运行的执行并核对未决效果的定时器；面向前端 Rutinas（例程）模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-execution

[English](README.md) | 中文

## 概述

本包持有唯一能自行启动与推进工作的组件。定时器在例程引擎之上一次跑一趟：启动每个触发器（`date` 或 `recurrence`）已到期的已激活例程，推进可运行的执行，并把效果未决的执行移到复核。启动以触发器的时刻或循环槽为键，因此重复的一趟、重启，以及两个进程仍只产生一次运行。关闭浏览器或重启都不会把工作留在那里等人按按钮。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.faberloomRoutines` 的位置挂载这一行，并带上部署身份与节奏：

```yaml
- id: faberloom-executions
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    intervalMs: 60000
```

`enabled` 默认为关闭，`intervalMs` 默认为一分钟；低于一秒的间隔会在加载时被拒绝。定时器立即跑一趟，之后每隔一个间隔跑一趟，并随插件的 fiber 一起停止。`runOnce(now)` 是公开的，因此部署可以用自己的时钟自行驱动。

### 一趟做什么

1. 对每个已激活例程，`date` 触发器时刻已过、或 `recurrence` 触发器进入新时间槽的，各启动一次执行。
2. 既有执行中可运行的步骤通过引擎的 tick 推进。
3. 处于复核且效果仍未决的执行被核对。
4. 已过截止期限的等待被过期，其执行移到复核。

`recurrence` 的 match 接受 `every:<分钟>`、`<n>m`、`<n>h`、`<n>d`。其他文本属于配置错误：这一趟会在每个进程中报告一次并指出是哪个例程，然后跳过 —— 调度器从不臆造节奏。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有直接影响。`ctx.faberloomExecutions` 不写提示文本、不注册工具；到达模型的是它启动的每次执行的步骤轮次，由 handlers 包描述。已启动的运行在面板与例程工具读取的执行中可见。

#### Token 影响

每次请求的额外 token 为零。每次启动的执行的代价等于其步骤的代价。

#### KV 缓存影响

与实时请求无关：调度器从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **尚无事件接收器。** 这一趟可以推进与核对，但 `email` 或 `event` 触发器仍在等待有人调用例程引擎的 ingest；入站 webhook 或邮箱轮询是另一块切片。
- **等待会过期，但不会重试。** 已过截止期限的等待步骤会把其执行移到复核并标记 `WAIT_TIMEOUT`；没有任何东西会重新尝试该等待或重新通知当事人。
- **每行一个 owner。** 该行只配置一个 owner，这与每用户一个进程相符；用一个调度器服务多个 owner 需要另一种身份绑定。
- **只有节奏，没有日历。** `every:`/`m`/`h`/`d` 无法表达工作日与时区感知的日程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

这一趟会获取例程引擎自带的调度锁，因此重叠的定时器 tick 或人工触发的一趟会报告 `another pass is running`，而不会做两次。失败的一趟只记录警告并保持定时器存活：一个因某个坏例程而死的调度器会静默停掉所有例程。循环键就是间隔槽 `floor(now / interval)`，无需存储游标即可每个间隔恰好运行一次。

</details>

**运行时不变式：** 不发布 companion。该服务从引擎已经持久化的例程与执行中推导每一个调度决定；它唯一的状态是进程内的锁与已报告过的配置错误集合。
