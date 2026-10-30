# Agent Note：将共享部署密钥限制在产品工作

Status: implemented

[English](2026-10-30-shared-key-usage-policy.md) | 中文

## 问题

B2B 账户使用部署提供的 DeepSeek 密钥登录。该密钥可以回答 MWT.ONE、SICOP 与账户邮件相关问题，但不能变成处理个人任务的通用助手。同时，没有负责代理的 Space 或子 Space 仍必须回答业务问题（例如采购订单状态），并且每个 Space 聊天都必须继续工作。

## 决定

`ctx.faberloomSessionAgent` 已经获得登录角色并组合每个 Space 会话。在受限角色（`restrictedRoles`，默认 `client_b2b`）且 `productOnly` 不为 false 时，该服务负责整套策略：

- 没有负责代理的 Space 组合产品 persona 与 MWT.ONE、SICOP、邮件工具，而不是回退到部署组合。
- 每个组合会话限制在 `allowedToolPrefixes`（MWT、SICOP 与 `faberloom_` 产品工具）以及读取工具、`skill` 与 `ask_user`。
- `llm/stream` 监听器在调用供应商之前拒绝个人首轮；`tools/pre-execute` 拒绝仍使用共享密钥的会话执行产品之外的工具。工具结果后的工作续接、带 purpose 的辅助调用以及没有会话的内部调用会绕过守卫，因此分类、压缩与标题生成继续工作。
- 守卫读取凭据层：来源不是 `env` 的值属于账户自己的密钥，不受限制；因此配置 Gemini、Claude、OpenAI 或自己的 DeepSeek 密钥的用户可以用它处理个人工作。

拒绝以一个可见的助手文本块返回，并指向“设置 → 模型”以配置个人密钥。策略文本同时作为 `faberloom:usage-policy` 安装，使模型看到与守卫执行的相同范围。

## 后果

- 该决定在供应商边界执行，而不是靠提示或隐藏按钮；被拒绝的请求不消耗 token，也不发送附件内容。
- 域检查是失败关闭的启发式：未提及产品术语的工作请求会被拒绝。接受的术语包括 MWT、SICOP、邮件、案卷、形式发票、发票、报价、订单、客户、供应商、发运、海关、集装箱、booking、BL、AWB、tracking、到港、ETA/ETD、库存、stock、SKU、价格、产品、shipment、SAP、PF、OC 与 PO，以及先前工作轮次的简短续接。
- 有负责代理的 Space 保留该代理的 persona 与技能，只收窄工具集。员工角色不变。
- 每个 Space 的 `+` 仍在该 Space 内创建会话。Space 之外的会话仍不能使用产品之外的工具，也不能用共享密钥回答个人提示。
