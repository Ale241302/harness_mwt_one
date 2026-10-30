# Agent Note: 桌面端携带本产品自己的身份与更新 origin

Status: implemented

[English](2026-10-15-desktop-release-identity-and-own-channel.md) | 中文

## Problem

一次发布的三件事曾由打包环境而不是产品决定。

其一是应用 ID。每个目标都要求 `DSH_DESKTOP_APP_ID`，因此没有那枚命名产品的环境变量就打不出包，而操作系统为应用、其卸载程序与文件关联记录的值也就留在了启动器里，而不是源码里。

其二是生产更新 origin。`production` 默认指向上游项目的主机 `https://download.deepseek.com`，因此本 fork 的安装会到厂商的服务器上找自己的更新。[打包与更新决定](2026-08-25-electron-desktop-packaging-and-updates.zh.md) 接受的后果正是：这个应用的发布与它的 runtime 绑定，而一个联系不上自己通道的安装根本无法更新。

其三是传输步骤。当时唯一实现的目标是 Tencent COS bucket，因此一个已经用自己主机服务产品的部署，必须先拿到对象存储账号与凭据对才能发布任何东西。存储账号恰恰是小型部署最不可能拥有、也最不需要的那部分：通道不过是每个目标一个路径下的几个文件。

## Decision

**产品提供自己的应用 ID。** `apps/desktop/scripts/desktop-release-environment.mjs` 中的 `DEFAULT_DESKTOP_APP_ID` 为 `one.mwt.faberloom`，当环境没有值或为空时 `resolveDesktopAppId` 使用它，同时仍对解析结果做反向域名校验。一次构建无需任何环境变量就能说明自己属于哪个产品，而用另一种身份分发的部署仍可覆盖它。

**生产解析本 fork 自己的 origin。** `UPDATE_ENVIRONMENTS.production.fixedOrigin` 为 `https://harness.mwt.one`，即已经服务本产品的那台主机，因此不设置任何东西的安装会跟随本部署自己的通道。`DOWNLOAD_PROD_ORIGIN` 仍可覆盖它，并且仍会校验为不含路径、凭据、查询或片段的绝对 HTTPS origin。`test` 部署继续要求显式的 `DOWNLOAD_TEST_ORIGIN`，因为一次演练本来就该说出它发布到哪台主机。

**一次发布可以发布到服务该 origin 的主机。** `apps/desktop/scripts/desktop-upload-plan.ts` 中的 `createDesktopChannelPlan` 会验证已完成的包：完成记录、两个版本、频道元数据、产物名称、大小、SHA-512 与 Windows blockmap 大小，并返回要服务的路径，而不指名任何存储账号。`apps/desktop/scripts/stage-target-channel.ts` 把该计划铺到 `_/harness/desktop/stable/<target>/`，正是打好的应用从它的 origin 计算出的那条路径。`scripts/publish-desktop-channel.ps1` 会 staging 一个目标、用 `scp` 把目录树复制到主机、只替换该目标的目录，并通过 HTTPS 校验频道元数据。gateway 从它自己的 stack 以只读方式挂载的目录（`docker-compose.yml` 中的 `DESKTOP_CHANNEL_DIR`）服务 `/_/harness/desktop/`，对频道元数据回答 `no-cache`、对带版本的产物回答一年缓存，而 `nginx/harness.conf` 不做缓冲地把该前缀代理给 gateway。COS 路径保留：偏好对象存储的部署继续用 `upload:*`，而 `createDesktopUploadPlan` 现在把频道计划与传输所需的 bucket、凭据变量名组合起来。

**staging 会重建所发布目标的目录。** COS 上传从不删除历史对象，这对同时也充当归档的 bucket 来说是对的。文件系统通道不同：被更新版本取代的安装包或 blockmap 必须停止可下载，否则 origin 会堆积曾经发布过的每一个版本。因此 staging 会删除该目标的目录并把已验证的计划写进去，而其他目标保留各自最后一次发布。

**通道仍然与签名绑定。** 未签名的包不写入任何更新源。这不是本次改动的偶然，而恰恰是把更新源指向本部署之所以可接受的原因：会自我更新的应用要从远端 origin 安装代码，因此 `macos-signature.spec.ts` 为未签名路径钉住 `publish: null`，本次改动不动那枚钉子。

## Alternatives considered

**继续要求 `DSH_DESKTOP_APP_ID`，并把它写成部署的责任。** 该 ID 不是秘密，也不随操作者变化：它命名产品，而本 fork 就是一个产品。要求它会让每次构建都依赖启动器携带一个源码本就已知的事实。

**保留上游 origin 作为生产默认。** 已安装的 fork 会到上游项目的发布主机上找自己的更新，而这正是本项工作要拆掉的耦合。一个只对不设置任何东西的部署生效的默认值，恰恰必须是本产品自己的。

**在部署上跑对象存储来省掉新的上传器。** 那是用一个账号换一个需要运维、打补丁、备份和安全加固的组件，而换来的只是每个目标三个文件的通道，而文件服务器已经在发布它们。服务产品的那台 origin 就是让一次发布摆脱第三方所需的最小增量。

**不先验证就直接上传产物目录。** `electron-updater` 会用频道元数据里的 `sha512` 与 `size` 校验下载到的载荷，因此不匹配的一对不会损坏什么，它会让更新一直失败直到有人发现。COS 路径已经为这份校验付过代价；staging 路径复用它，而不是另写一个更弱的检查。

**合并进目标目录而不是重建它。** 合并会留下一个永远可下载的旧安装包，而且它分不清被替换的文件和本该保留的文件，这正是部署自己的推送脚本在解包前删除已退役目录时记录过的同一个缺陷。

**最终让未签名构建也写入更新源。** 那会让整条链路今天就能演练，也会让一个未签名的应用在没有操作系统发言权的情况下从远端 origin 安装未签名的代码。缺的输入是证书，所以诚实的做法是留下那枚钉子并把这一点说清楚。

## Consequences

打包不再需要为身份或频道 origin 提供任何环境变量。`pnpm run package:desktop:win:x64:unsigned` 完全不需要它们就能运行，这正是一次演练之所以是演练的原因。不设 `DOWNLOAD_PROD_ORIGIN` 的生产包会跟随本部署的主机，因此迁移通道是一个变量，而不是一次发布。

发布一次即 `package:desktop:<target>`，随后在部署自服务通道时用 `publish-desktop-channel.ps1 -Target <target>`，在使用 COS 时用 `upload:<target>`。两条路径验证的是同一个已完成的包。

通道与产品共用主机与证书，因此主机中断就是更新通道中断。服务它只需 gateway 的一条只读挂载与一条路由，二者都由部署推送携带，另加 `nginx/harness.conf` 中的一条代理前缀；后者是文件 bind-mount，因此需要在主机上就地应用并重载，部署 README 写明了这一点。gateway 不会把下载缓冲进自己的内存：它把路径交给 `res.sendFile`，由它流式发送并响应 range 请求。

在存在已签名发布之前通道是空的，因为只有已签名的包才携带更新源。本次改动没有消除这个依赖，也没有代码能消除：Windows 的 EV 证书与 macOS 的 Developer ID 证书加公证凭据是采购，不是提交。它消除的是部署本来必须提供的其他一切，即应用 ID、origin 和存储账号。

## Testing

`apps/desktop/tests/macos-signature.spec.ts` 覆盖产品默认值、空值、显式覆盖，以及仍必须被拒绝的畸形 ID。`apps/desktop/tests/desktop-auto-update-environment.spec.ts` 覆盖生产在完全没有环境变量时解析出本 fork 的 origin，以及 `DOWNLOAD_PROD_ORIGIN` 覆盖它、其中带路径仍被拒绝。`apps/desktop/tests/desktop-upload-plan.spec.ts` 从解析器推导其 fixture 的完成记录，而不是重复写死 origin，因此 fixture 无法断言一个打包已不再解析的通道。`apps/desktop/tests/stage-target-channel.spec.ts` 是新增用例，覆盖在没有 COS 设置时铺出要服务的路径、重建目标目录同时另一个目标保留其发布，以及拒绝一个指向别的 origin 的完成记录。

`tsc -b tsconfig.host.json`、`apps/desktop` 测试车道、oxlint 与 `test:docs` 通过。无签名演练在没有任何发布环境下运行文档化的命令，并在 `.desktop-build/targets/win-x64/unsigned-artifacts/` 下产出安装包。由于未签名的包不写入更新源，目前还没有任何发布被 origin 服务过：它缺少的输入是证书，其后的部署步骤是 `package:desktop:win:x64`、`publish-desktop-channel.ps1 -Target win-x64`，以及一次读取 `latest.yml` 的客户端安装。
