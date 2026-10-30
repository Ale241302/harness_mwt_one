# Agent Note: 本机安装从已解析的环境中挂载自身的产品 MCP 服务器

Status: implemented

[English](2026-10-14-local-product-mcp-servers.md) | 中文

## Problem

共享网关会为它启动的每个 `dsh` 注入产品的外部工具：MWT.ONE 控制台 MCP、公开的 SICOP MCP、FaberLoom spaces MCP 与技能目录，每一项都是按用户生成的 patch 中的一行，取值来自部署自身的配置。本机安装组合了同样的产品 bundle，并在登录时写出自己的身份 patch，但那份 patch 只带身份，因此本机 harness 触及不到这些服务器。产品模块能用而外部工具不能用，正是操作者从桌面端不再是网关客户端的那一刻最先注意到的差别。

## Decision

**登录 patch 挂载它能够解析端点的产品 MCP 服务器。** `apps/desktop/src/product-mcp.ts` 渲染 `- insert:` 条目，`renderIdentityPatch` 把它们写成 patch 的第一层。每个条目携带网关那些行所携带的字段，因此两种组合以相同的 `failOnStartupError: false`、相同的三十次重连上限与相同的 120 秒工具调用预算挂载相同的服务器。

**“挂载”意味着可达，其依据是配置而不是部署文件。** 该判断读取子进程启动时的环境，而 `main.ts` 把它构造为启动进程环境之下的 Harness home `.env` 层，因为子进程先读该层、再被继承环境覆盖。三种结果：

- 除非 `SICOP_MCP_URL` 为空，SICOP 总会挂载，其默认值是公开的 `https://sicop.vlinte.work/mcp`。它不携带身份，因此桌面端与网关的触及方式完全相同。
- 当 `MWT_MCP_URL` 解析出值且至少一种凭据解析出值时，挂载 MWT.ONE 服务器。带 `MWT_MCP_AUTHORIZATION` 时它只携带该请求头，值为控制台 onboarding 为单个用户签发的 `DeviceToken <secret>`，并附带 `X-MWT-Device-Id`——由 `apps/desktop/src/device-id.ts` 在 Harness home 中生成一次的标识：控制台从令牌解析用户及其企业，并把凭据绑定到这台机器而不是它的公网地址。只有 `MWT_MCP_GATEWAY_KEY` 而没有设备令牌时，它保留网络内形态：已登录 owner 的 `X-Forwarded-User-Email`、由 loader 解析的网关密钥，以及用于跳过控制台 MCP 的 OAuth 挑战的非 JWT 值 `Bearer dsh-gateway`。两者同时解析时设备令牌优先，因此复制了部署密钥的操作者无法覆盖本机被 onboarding 时获得的凭据。
- 在同样的 URL 与密钥条件下挂载 FaberLoom 服务器，带 `X-Faberloom-User-Id` 与 `X-Faberloom-Gateway-Key`。

**没有任何密钥写进 patch。** 每个携带密钥的请求头只保存环境变量名，由 loader 在挂载该行时解析，这正是网关 patch 已经使用的机制。出厂时 MWT.ONE 与 FaberLoom 的默认 URL 指向容器主机名，因此本机安装不会挂载一个注定失败的行：两个端点都未配置时，本机 harness 只挂载 SICOP。

**凭据发给这台安装，而不是让人粘贴。** 登录时桌面端用刚获得的会话和本机的设备标识调用 `POST ${consolaBase}/onboarding/device-token`，控制台为该用户可用的每家企业各返回一个绑定到该设备的 `DeviceToken`。`apps/desktop/src/mcp-provision.ts` 把它们写进 Harness home 的 `.env`（`MWT_MCP_COMPANIES` 加 `MWT_MCP_TOKEN_<KEY>`），记录 `MWT_MCP_DEVICE_ID`，并删除它取代的单凭据形式；patch 只引用变量名。已登录的启动只在环境层缺少当前设备的凭据时重试，因此无需再次登录即可升级旧安装。行集合跟随企业：第一家挂载为 `mcp-mwt`，其余为 `mcp-mwt-<key>`，同时经营两家企业的用户因此能看到两个范围。该端点认证用户自己的会话而不是服务令牌，所以企业管理员与 B2B 客户各自在自己的机器上获得凭据，控制台按角色的工具过滤依然生效。

`apps/desktop/src/home-env.ts` 中的 `readHomeEnv(dshHome)` 解析壳早已写入的那一层，接受 dotenv 支持的值引号形式，因此操作者在 Harness home 的 `.env` 里设置 `MWT_MCP_URL` 时，读取方式与子进程完全一致。

## Alternatives considered

**无条件挂载 MWT.ONE 与 FaberLoom 行，让 loader 也解析 URL。** 空 URL 会变成一行重试三十次并逐次记录失败的行，而出厂默认指向的容器主机名在部署网络之外无机器可解析。端点缺席不是故障，因此不能把它呈现为故障。

**只按 URL 判断，让缺失的密钥在第一次工具调用时失败。** 密钥在 patch 生成时其实已经解析出来了，因为环境正是为同一个判断读取的。一个哪里都认证不上的行会消耗一段真实的重连预算，并给模型一个看得见却用不了的工具 schema。

**把控制台 MCP 的共享网关密钥分发给每台桌面端。** 控制台 MCP 在密钥匹配后即信任 `X-Forwarded-User-Email`，因此操作者机器上的这份密钥就是冒充该部署任意用户的凭据；为抵达它而把容器公开发布，会把这种暴露扩大到部署网络之外。按用户的 `DeviceToken` 以只识别单个用户的凭据满足同一需求：它绑定首次使用它的机器、带 30 天滑动过期，并可通过重新签发来吊销。

**把密钥值写进 patch。** 网关自身的 patch 保留环境变量引用并由子进程解析，而身份 patch 是共享目录中的持久文件。把值放在那里会让一个共享网关密钥在登录有效期内以明文留在磁盘上。

**用 `ctx.faberloomMcpRegistry` 取代 patch 行。** 该注册表是操作者自己的界面：持久记录、经由凭据接缝的密钥、探测，以及无需重启的挂载。它仍然是添加产品未内置服务器的途径。它无法表达“部署为每次安装发布此端点”，因为部署端没有任何东西能写入注册表记录，而 SICOP 也会因此在全新安装上需要一个手工步骤。

**读取部署的配置文件。** 操作者电脑上并不存在这样一份文件。环境是部署可经打包（`DSH_DESKTOP_HOME_ENV_FILE`）下发、操作者也可编辑的唯一一层。

## Consequences

本机安装在第一次登录即可触及 SICOP；一旦部署发布了一个部署网络之外的电脑也能解析的端点，它就能触及 MWT.ONE 与 FaberLoom 服务器，双方都无需改代码：URL 与密钥都是配置。网关同时注入的技能目录不在范围内，因为它指向部署目录。

代价是挂载集合在写 patch 时确定，因此改动环境需要退出登录并重新登录。MWT.ONE 的请求头省略了 `X-MWT-Client-ID`：网关从控制台的企业列表推导它，而桌面端登录并未解析该列表，因此对只有一家企业的操作者，控制台 MCP 看不到默认企业，接受企业参数的工具有每次调用时各自作答。设备令牌自带企业，因此这种凭据无需该请求头即可限定工具范围，并绑定到本机生成一次的设备标识：控制台按用户、企业和设备各保留一个有效凭据，其余不受影响，因此同一用户可以同时使用桌面端和另一个 MCP 客户端，切换网络不会使任何东西失效，而复制到另一台机器的令牌会因设备标识不同而被拒绝。没有该标识时，控制台退回此前的地址绑定：第二个客户端或另一个网络需要重新签发令牌，而重新签发会吊销前一个。由于控制台在登录时签发凭据，操作者从不接触令牌：在新电脑上首次登录即产生该机器的 grant，经营两家企业的操作者会得到两行。

该签发调用需要 `${consolaBase}/onboarding/device-token`；没有它，安装保留环境层已有的凭据；两者都没有时只挂载 SICOP。当环境层过期或设备标识改变时，该调用会轮换本设备的凭据，该机器此前的令牌随即失效。

FaberLoom 作为服务器的方向此前已经组合好且未改动：patch 以 `$DSH_HOME/faberloom-mcp.sock` 的 `socketPath` 启用 `faberloom-mcp-server`，而 `apps/desktop/tests/profile-mcp.spec.ts` 仍然断言出厂桌面组合只带一个 `mcp-resources` 消费者、不带 `mcp-client` 行，这正是让 patch 成为客户端行唯一出现之处的原因。

## Testing

`apps/desktop/tests/product-mcp.spec.ts` 覆盖 SICOP 默认值、被置空与被替换的 SICOP URL、带 owner 请求头与密钥引用的 MWT.ONE 服务器、带设备令牌的 MWT.ONE 服务器、设备标识请求头、按企业各一行、缺少凭据的企业被省略、设备令牌优先于网关密钥、设备令牌同样要求 URL、FaberLoom 服务器、缺少 URL 或密钥的服务器被省略、渲染出的行与记录期望的比对，以及带引号 owner 的转义。`apps/desktop/tests/mcp-provision.spec.ts` 覆盖按企业写入凭据与设备标识、保留其他环境行并删除被取代的单凭据形式、设备已有凭据时不作改变、控制台拒绝、不可用载荷、控制台不可达，以及没有会话的情况。`apps/desktop/tests/device-id.spec.ts` 覆盖首次生成并保持不变、替换非 UUID 的存储值，以及创建 home 目录。`apps/desktop/tests/identity.spec.ts` 覆盖挂载公开服务器的 patch 与操作者置空后不挂载任何东西的 patch，并断言没有密钥值进入 patch。`apps/desktop/tests/home-env.spec.ts` 覆盖该层解析器：注释、`export`、两侧空白、单双引号、空值、格式错误的行，以及重复的名称。
