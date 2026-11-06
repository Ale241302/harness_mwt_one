# Agent Note：令牌按指纹列出、携带可选空间，并共享一条认证路径

Status: implemented

[English](2026-11-06-token-scopes-and-space.md) | 中文

## 问题

MCP 令牌面板列出了每个客户端的 bearer 密钥，并用该密钥撤销。诊断转储、读取面板的模型或截图都会携带一个可用凭证。客户端还持有工具目录的硬编码副本，它已经与服务器漂移，且不包含提案工具。socket 传输与 bridge 各自用一份校验副本认证令牌；bridge 不校验 scopes 或空间，因此陈旧注册可能比令牌的收窄活得更久。令牌没有空间：提案工具总是写入覆盖整个 owner 的条目，owner 失去的成员资格从未被重新检查。

## 决策

**列表携带指纹，而不是密钥。** `tokenId(token)` 是 24 字符的 SHA-256 前缀。`listTokens()` 返回带 `id`、标签、时间戳、scopes、公司、空间的 `FaberLoomMcpTokenRow`；`mintToken()` 返回 `{ token, row }`，该应答是 bearer 离开存储的唯一位置。`revokeToken(reference)` 接受指纹，也仍接受旧调用方持有的精确密钥。bridge 的网关注册通过私有 `liveTokens()` 读取密钥，绝不通过公开列表。

**一条认证路径。** `tokenCaller(token, record)` 校验撤销、owner、scope 列表与空间，`authenticate()`（socket）与 `request()`（bridge）都调用它。存储的 scope 列表若把 `faberloom_proposal_submit` 与其它工具混合，或命名本服务器不提供的工具，会被拒绝而不是静默收窄。旧面板已退役的 scope（`faberloom_board_review`）会被过滤掉，令牌以存活的 scopes 继续工作，因此升级不会让旧连接失效。命名空间的令牌每次使用都调用 `faberloomSpaces.get(owner, space)`，因此失去空间或成员资格会以与撤销相同的 401 停止令牌。

**空间到达 executor。** `FaberLoomToolHost` 接收令牌空间并传给目录条目；`faberloom_proposal_submit` 把它转给 `board.submitProposal`，后者通过 Spaces 重新校验，并把它纳入命名空间、`sourceRef`、业务键与条目。空间受限令牌必须以 `faberloom_proposal_submit` 作为唯一 scope：空间说明提案归档到哪里，而不是读取限制，服务器拒绝把空间与读取或全部面孔组合。未指定空间的令牌保持旧的覆盖整个 home 语义（`null`），字段出现之前写入的记录也按同样方式读取。

**面板读取目录。** 视图从 `FaberLoomMcpServer.toolNames()` 暴露 `mcpTools()`；客户端不再复制列表。提案工具在选择器中是独占的：选中它会清空其它选项，服务器对手工构造的请求执行同一规则。

## 考虑过的替代方案

**列表保留令牌并在 UI 中隐藏。** 诊断或模型仍会从远程方法收到它。密钥必须在签发后不再离开存储。

**在令牌旁存一个随机行 id。** 这又多了一个需要唯一和迁移的字段；令牌哈希已经稳定、抗碰撞，并可从行键派生。

**只在 `tools/list` 校验 scopes。** 调用方可以按名称直接调用而不列出；`call` 与两个传输都必须拒绝，因此检查放在 `tokenCaller` 与 host 中。

**只在签发时重新校验空间。** 成员资格可能在签发后被移除；需求点名成员资格丢失，因此使用路径要重新检查。

**让客户端随提案发送空间。** 空间会成为来自不可信载荷的权威字段。它应随令牌存储并在服务端重新校验。

## 后果

泄露的面板列表不再是泄露的凭证。撤销按指纹工作，仍持有密钥的旧客户端可以用它撤销一次。受限提案令牌只能提交提案；读取令牌不能提案；覆盖全部面孔的旧令牌仍可调用所有工具，但 1.1 起批准仅限人工，因此它不能批准。空间受限令牌在 owner 失去空间时停止工作，它创建的提案从一开始就属于该空间。bridge 注册与产品备份仍会在各自受信路径内携带 bearer 密钥；列表与面板绝不携带。

令牌记录新增 `spaceId`，默认 `null`，因此既有记录保留覆盖整个 home 的含义，无需迁移重写。bridge 仍需原始密钥来注册公开端点；该访问留在进程内部。

## 验证

- `packages/faberloom/mcp-server/tests/tokens.spec.ts`：列表隐藏密钥并按指纹撤销；没有 `spaceId` 的旧记录按 owner 范围列出并认证；携带已退役 `faberloom_board_review` 的旧记录继续工作且该条目被忽略；提案+其它 scope、未知 scope、空间+非提案 scope、外来空间在签发时被拒；提案令牌只列出并调用提案工具，而读取令牌不能提案；存储的混合或未知 scope 列表在 bridge 上 401；空间受限令牌把提案落到该空间，成员资格丢失的令牌 401；覆盖全部面孔的令牌调用批准时被拒 `HUMAN_ACTION_REQUIRED`；已撤销令牌在 HTTP 与 bridge 上均 401。
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：面板以目录驱动的 scope 列表与一次性令牌字段渲染。
- `packages/faberloom/view` 与 `packages/client/ui-faberloom` 套件：394 个测试在新行与签发结果下通过。
