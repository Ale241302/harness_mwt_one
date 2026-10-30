# Agent Note: 指名某个 agent 的消息用该 agent 的路由运行该轮

Status: implemented

[English](2026-10-12-mentioned-agent-runs-the-turn.md) | 中文

## Problem

Space 会话已经以其负责 agent 的身份运行 —— 人格、工具掩码、技能，以及在该 agent 已配置路由并持有密钥时的 provider、model 与 API key —— 用户也可以在聊天中指名目录里的某个 agent：已交付的 `faberloom:mentions` 指令让模型以该专家身份行动，`@` 选择器插入 `@Name` 文本。两者都没有改变由哪个账号服务该轮。指名某 agent 的消息仍然在会话自己的路由上跑完整整一轮，因此既不能在该 agent 的模型上运行，也不能计费到该 agent 的 provider 账号，而这正是 owner 要求改变的「该轮自己的账号」。

## Decision

**以 `@Name` 开头的消息用该 agent 的路由运行该轮。** `packages/faberloom/session-agent` 在 `src/mention.ts` 中加入这条逐轮路由（纯函数 `latestUserText` 与 `matchMentionedAgent`），并在 `src/index.ts` 中加入一对监听器（`attachMentionRoute`）。最新一条用户消息以 `@` 开头、随后是目录中某 agent 的确切名字、再随后是空白或文本结尾时，该轮就带上该 agent 的 provider、model 与[凭据引用](../architecture/2026-10-12-agent-credential-route.zh.md)；最长的匹配名字获胜，因此一个名字是另一个名字前缀时不会遮蔽后者。这条规则就是已交付的 `faberloom:mentions` 指令与 `@` 选择器已经在用的语法。

**mention 从 `agent/pre-step` 读取，在 `agent/request` 上应用。** `agent/pre-step` 的负载携带该步被认领的消息批次；`agent/request` 的负载不携带任何消息，而循环只在该准备瀑布之后才把已认领批次提交进日志，因此单靠请求监听器读不到该轮的用户文本。请求监听器以 `{ prepend: true }` 注册，因此最外层运行，并把 mention 的路由应用到链上其余部分解析出的结果之上。

**没有 mention 的一轮会恢复该 mention 之前会话所用的路由，且仅当日志中的路由仍是该 mention 的路由时。** 循环会记录该请求所用的 header，因此一个带 mention 的轮次否则会成为会话的种子路由；监听器保留它在第一次覆盖之前捕获的基础路由，并在下一个没有 mention 的轮次重新应用它，因此连续多个 mention 都会恢复会话自己的路由。会话在此期间改变过的路由 —— 一次显式的模型选择 —— 不再等于该 mention 的路由，因此恢复不生效，那次选择继续有效。未知名字、缺失目录或 plane、或者缺少 provider、model 与 key 三者中任何一项的 agent，都解析为 `undefined`，让请求保持链上解析出的原样，而不是让该轮失败。

**什么是持久的，什么不是。** mention 就住在本来就会被记录的用户消息文本里，而循环自己的 `request/header` 记录该请求所用的 provider 与 model —— 这正是面向模型输入的可重建规则。凭据引用是请求状态：它抵达适配器，但从不进入日志。

## Alternatives considered

**在请求监听器里从会话的派生消息中读取 mention。** 请求监听器是路由改写自然该待的地方，但在某一轮的第一个请求上，已认领批次还没进入派生消息 —— 循环在准备瀑布之后才把它提交进日志 —— 因此它会读到上一轮的消息。在 `agent/pre-step` 读取才能看到该步认领的批次。

**为每个 mention 做一条持久化的模型选择。** 把 mention 的路由记进会话日志可以在重启后存活，但它把请求状态放进了持久投影，而平台规则禁止这样：日志承载可重建之物，而凭据引用不是。

**把 mention 做成一次工具调用而不是一条路由。** 工具调用会让该轮继续留在会话自己的账号上，只是去咨询被指名的 agent，而这正是 owner 要求改变的「该轮自己的账号」。

## Consequences

指名某个目录 agent 的消息现在整轮 —— 每一步 —— 都在该 agent 的 provider、model 与 key 上运行，其后的一轮则回到会话自己的路由。mention 不会让任何东西失败：匹配不到目录 agent 的名字、缺失目录、或缺少 provider、model 与 key 三者中任何一项的路由，都让请求保持原样。密钥引用从不写入日志，而用户在 mention 之后做出的显式选择继续有效。

接受一项限制。恢复是进程本地的：监听器在内存中记住 mention 之前的路由，因此重启之后，最后一次请求是 mention 的会话会保持该 agent 的路由，直到另一个 mention 取代它。要让它存活，需要一条并非请求 header 的持久路由意图，而需求禁止这样。

验证：一个循环 spec 驱动真实的 agent 循环，断言带 mention 的一轮以被指名 agent 的路由抵达适配器，而会话日志携带 mention 文本、不携带任何凭据引用；断言没有 mention 的一轮以及带 mention 之后的一轮，分别停留在或返回到会话自己的路由；断言连续多个 mention 各自在它指名的 agent 上运行随后恢复；断言会话在 mention 之后改变过的路由继续有效；断言推理强度随路由一同恢复；断言带 mention 的一轮跨多个步骤保持其路由；并断言未知名字、未配置路由或未持有密钥的 agent、缺失目录、注入的上下文文本，以及没有用户文本的步骤都不会改变任何东西。
