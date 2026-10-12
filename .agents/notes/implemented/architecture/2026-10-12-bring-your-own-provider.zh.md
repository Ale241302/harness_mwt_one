# Agent Note: Serve a named provider route from the deployment

Status: implemented

[English](2026-10-12-bring-your-own-provider.md) | 中文

## Problem

harness 的每个会话都跑在部署那唯一的 DeepSeek 连接上。pi-ai 适配器可以路由到其他提供方，但随产品交付的组合没有声明任何非 DeepSeek 路由，而手工声明一条路由的 profile 必须复述已安装目录本已知道的端点、协议和模型目录。产品给 Kimi 编码计划用的那个名字根本无法解析，因此指名它的 agent 无从抵达。路由真正运行时，账户级拒绝又以通用失败出现：提供的凭据通过了认证，但账户没有额度，而提供方返回的措辞既不匹配分类器，也不被客户端报告。

## Decision

**产品路由键以另一个 id 解析已安装目录中的提供方。** `packages/llm/llm-pi-ai/src/catalog.ts` 声明 `CATALOG_ROUTE_ALIASES`，当前为 `{ kimi: 'kimi-coding' }`，`catalogIdFor` 在每次查提供方时读取它，因此产品路由键 `kimi` 与目录 id 本身一样，解析已安装的 `kimi-coding` 提供方的端点、协议、显示名和模型目录，profile 无需复述其中任何一项。`moonshotai` 不需要别名，因为 Moonshot 平台本身就是独立的目录提供方，于是 Kimi 的编码计划与 Moonshot 平台保持为各带凭据的两条独立路由。别名只存在于路由键这一层：profile 仍然配置 `apiKeyEnv`，凭据解析也从不读取该表，因此按调用传入的 `credentialRef` 依然胜出。

**运行哪些提供方路由是部署的事，声明在产品 bundle 里。** `packages/bundle/faberloom-app/cordis.patch.yml` 声明五个 pi-ai profile —— `openai`、`anthropic`、`google`、`kimi`、`moonshotai` —— 每个只写一个 `apiKeyEnv` 引用，因为存在哪些适配器属于组合（`packages/bundle/base/cordis.patch.yml` 以休眠状态挂载 `dsh-llm-pi-ai`，没有任何路由），而运行哪些提供方属于部署。`gateway/server.mjs` 在它渲染的按用户补丁里复述同样的五个 profile，用 `readSecret` 解析每个键，使 `<NAME>_FILE` 这种 Docker secret 形式可用，并把值注入子进程环境，因此该补丁只携带引用，从不携带值。`.env.example` 与 `README.mwt-one.md` 记录这套引用。

**随产品交付的五条路由及其解析出的协议。** `packages/llm/llm-pi-ai/tests/config.spec.ts` 断言每条路由解析出已安装目录的端点与线上协议：`openai` 为 `https://api.openai.com/v1`，走 `openai-responses`；`anthropic` 为 `https://api.anthropic.com`，走 `anthropic-messages`；`google` 为 `https://generativelanguage.googleapis.com/v1beta`，走 `google-generative-ai`；`kimi` 为 `https://api.kimi.com/coding`，走 `anthropic-messages`，其模型 id 取自目录，因为该端点不发布模型列表；`moonshotai` 为 `https://api.moonshot.ai/v1`，走 `openai-completions`。原生的 `deepseek-official` 路由属于另一个适配器 `dsh-llm-deepseek` —— chat-completions 位于 `https://api.deepseek.com`，Anthropic Messages 位于 `https://api.deepseek.com/anthropic` —— 该 spec 正是因此不含 `deepseek`。

**agent 自己的密钥按调用优先。** `GenerateOptions.credentialRef` 在该请求上覆盖路由的 `apiKeyEnv` 引用，路由的密钥只是未指名密钥的调用的部署兜底。

**账户余额耗尽会被归类。** `packages/llm/llm/src/error.ts` 声明真实耗尽账户返回的措辞：`isQuotaExceededError` 匹配断言余额缺失的扁平化消息（"no credits remaining"），此前的模式漏掉了它，而该模式要求余额缺失，因此真正的限流——它会写明速率——无法匹配。`providerAccountFailureCode` 把该响应报告为 `QUOTA`，于是正文是账单消息的 HTTP 429 被归类为账户已空，而非瞬时速率限制。

**失败会说出是哪个账户，客户端会说明去哪里修正。** `providerFailureMessage` 追加 ` (provider "<route>")`，其格式即该组合器明文记录的契约，`packages/client/ui-chat` 读回该后缀，为 `QUOTA` 与 `AUTH` 两种情况渲染本地化提示，指名提供方并指向提供方自己的账户。路由 id 与失败码并列传递，而非作为持久化失败上的结构化字段，因为新增持久化字段属于已声明的持久化类型变更；客户端因此从 harness 组合出的消息后缀中读回路由 id。

## Alternatives considered

**只为 Kimi 提供 Moonshot 平台路由。** 平台与编码计划是端点不同、凭据不同的两种产品，而 owner 持有的凭据是编码计划，因此单一路由会认证错误的产品。目录把它们作为两个提供方交付，别名则解析编码计划的路由键。

**每个提供方各一条适配器行。** 每条路由都已经通过一个已安装的目录提供方解析，由它持有端点、协议、显示名和模型目录，因此为每个提供方手工声明一行，会把目录本已持有的事实复述成一个带二十六个可配置 compat 字段的路由 profile。

**把模型列表烧进配置。** 已安装目录持有每个提供方的模型列表，提供方新增一个模型就得等一次发版才出现；别名改为解析目录的列表，对不发布列表的编码计划也是如此。

**现在就给持久化失败加一个结构化的提供方字段。** 在持久化失败上加字段是干净的做法，它被推迟了：该变更需要已声明的持久化类型变更确认机制。在完成该变更之前，路由 id 走进失败消息明文记录的 ` (provider "<route>")` 后缀。

## Consequences

五条提供方路由来自五个密钥引用，每个提供方的端点、协议和模型目录都仍是目录的数据，因此一条已交付的路由只是一行配置，提供方新增的模型无需发版即可出现。产品把 Kimi 的编码计划与 Moonshot 平台呈现为两条不同路由，agent 可以指名其中任一条。账户余额耗尽的用户会被告知该给哪个账户充值，密钥被拒的用户会被告知去哪里修正，两条消息都不携带凭据值。

一个没有额度的真实 OpenAI 密钥以 HTTP 429 返回 "no credits remaining" 措辞，owner 的 Kimi 编码凭据在编码端点以 HTTP 403 返回月度配额消息；两份凭据都通过了认证。为这项工作提供的每一份凭据都通过了认证却没有额度，因此非 DeepSeek 的各条路由由各自经过核验的目录端点与 mock 服务器覆盖，而不是由一次真实往返覆盖。
