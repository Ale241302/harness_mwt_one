# Agent Note：每个租户的 `dsh` 以自己的 uid 运行，且不再继承部署密钥

Status: implemented

[English](2026-11-24-tenant-uid-isolation.md) | 中文

## 问题

网关容器内的每个进程都以 root 运行，包括 supervisor 按用户启动的 `dsh`（`gateway/server.mjs`，`startInstance`）。root 忽略文件权限，因此某些 home 已有的 `0700` 并不能阻止一个租户的 agent 读取另一个租户的 home——home 里存放该租户的 MCP 凭据（`storages/faberloom_mcp.json`、`storages/*token*`）。子进程还原样继承了 `process.env`，其中带有 `SESSION_SECRET`（可为任意用户伪造会话 cookie）、`DATABASE_URL`（Mesa 数据库密码）和 `MEMORY_ADMIN_KEY`——这些都不是租户 agent 需要的东西。一个 `bash` 工具或一个 `run_code` 程序就足以读到它们。

变更前在已部署主机上实测：`/data/users` 下的 13 个目录中，10 个是 `0755 root`，3 个是 `0700 root`；网关报告 `sandbox de shell para dsh: danger-full-access`。

## 决策

`scripts/harden-homes.mjs` 负责数据部分。它为每个租户分配 `uid = gid = 30000 + slot`（slot 1..999），把映射持久化到 `<DATA_DIR 所在目录>/tenant-uids.json`，对 home 执行 `chown -R <uid>:<uid>` 并置 `0700`，同时让 `/data` 和 `/data/users` 保持 `755`，以便网关仍能进入 home。它还把 `/data/secrets/*` 的每个文件以及 `gateway-users.json`、`mcp-token-index.json` 和 `memory-users.json` 置为 `0600 root`，并把部署的共享数据（`/data/shared`、`/data/users/shared`）设为全局可读，因为子进程现在以非特权 uid 读取它们：`faberloom-global-agents.json` 原本是 `0600 root`，会变得不可读。

脚本默认是 dry run，只有传 `--apply` 才执行；它是幂等的（第二次运行对每一项打印 `sin cambios`）；它在改动前先写一份运行记录（`/data/harden-homes-<ts>.json`），记下发现的每个所有者和模式；它在第一个失败处停止，而不是留下迁移到一半的 home。`--rollback <record>` 恢复这些所有者和模式并把 uid 表移开，这样仍带 `HARNESS_TENANT_UID=1` 的网关会在启动时响亮失败，而不是继续服务已交回 root 的 home。

`shared` 与 `tenants` 不是租户 home，不分配 uid。`shared` 是 `DATA_DIR` 内由全部署共用、每个租户的 `dsh` 都会读取的目录（豁免所有者名单在那里）；`tenants` 是 `gateway/tenant-home.mjs` 为共享租户 home 保留的段。

`gateway/tenant-uids.mjs` 拥有表的格式与对表的操作。表项是 `{ uid, gid, slot }`，且 `uid === gid === 30000 + slot`，读取时校验：不一致、重复或越界的表项会阻止网关启动，而不是随意分配 uid。

`gateway/server.mjs` 负责进程部分：

- `HARNESS_TENANT_UID=1` 打开该模式。打开但没有表时，网关以 `FATAL` 退出而不是启动 root；打开但网关本身不是 root 时，它警告并保持原行为。
- `startInstance` 只在模式激活时把 `uid` 和 `gid` 传给 `spawn`，因此 `prlimit` 与随后的 `dsh` 都以该租户身份运行。`prlimit --nofile` 仍然生效，因为下调限制不需要特权；在主机上以 `uid=30001` 实测为 8192。
- 子进程环境是 `stripChildSecrets(...)`：从 `process.env` 的副本和显式条目中剔除 `SESSION_SECRET`、`DATABASE_URL` 和 `MEMORY_ADMIN_KEY`，其余全部保留。`FABERLOOM_MIRROR_KEY` 以解析后的值显式传入（`<NAME>_FILE` 因此同样可用），因为租户本地 MCP 服务器要校验它来服务桌面镜像；`FABERLOOM_CEO_SIGNERS` 直接继承，因为它是签署授权名单而不是凭据，board 在 `dsh` 内读取它。
- 网关以 root 写完补丁、令牌文件、预设和重建的 Workspace 目录之后，`adoptHomeOwnership` 遍历 home，把所有者不符的每个条目 `lchown` 给租户。没有这一步，子进程读不到自己 `0600 root` 的 console 令牌，也写不进网关刚重建的 Workspace。符号链接只改链接本身，不跟随目标。
- uid 表会为它尚未命名的租户（新账号）以一次原子写入补上表项，`/etc/passwd` 与 `/etc/group` 会补上 `tenant-<slot>`，使 `id`、`ls -l` 与 `os.userInfo()` 正常工作；该镜像里 `SHELL` 为空，shell 工具因此会调用 `userInfo()`。
- `/data/shared/skills` 归 `gateway-users.json` 中第一个角色为 `admin`、`superadmin` 或 `ceo` 的租户（按文件顺序），模式 `2775`：面板以编辑者自己的 uid 写全局技能，`2775` 让所有租户可读而只有所有者可写。向所有租户开放会让任何一个重写全局目录。若没有这类角色，目录留在 root，脚本打印警告；网关在启动日志里写出它找到的所有者。

`HARNESS_TOOLS_MODE` 守卫接受两种隔离：`PTC_JAIL`（bwrap，面向允许用户命名空间的主机）或本 uid 隔离。两者都没有时，启动照旧中止。`renderToolsEntry` 只在 `PTC_JAIL` 指定了包装器时写 `ptc-runtime` 行；在 uid 隔离下 runtime 保留其 `process.execPath`，内核就是隔离笼。

## 备选方案

**只 `chmod 700` 而不降权。** 拒绝：root 忽略模式位；基线实测（3 个 home 已是 `0700 root`）就是证明。

**每次运行用 bwrap。** 本部署拒绝：创建命名空间需要在已持有每个 home 的容器上开 `CAP_SYS_ADMIN` + `CAP_NET_ADMIN`，这比它关闭的暴露更糟。对于允许非特权用户命名空间的主机，它仍可通过 `PTC_JAIL` 使用。

**每租户一个容器。** 暂时拒绝：为同样的内核隔离付出更大的运维面（镜像分发、卷挂载、生命周期）。

**按租户的 MCP 令牌。** 本笔记不涉及：MCP 仍信任 `X-Forwarded-User-Email` 加全部署的 `MWT_MCP_GATEWAY_KEY`，所以持有该键的租户仍可在 MCP 处声称另一个身份。堵住它需要在 MCP 侧有按租户的凭据；网关继续传该键，因为那是 `dsh` 目前认证的方式。

**`setgroups`/按租户的附加组。** 未使用：`spawn` 只设置 uid 与 gid，共享组需要经 `initgroups` 授予，而 Node 不做这件事。

## 后果

子进程保留 `FABERLOOM_MIRROR_KEY` 与 `FABERLOOM_CEO_SIGNERS`，因为桌面镜像和 board 需要在 `dsh` 内拿到它们；它失去的是只有网关才用的三项凭据。镜像键是每个租户镜像路径共用的全部署凭据，所以读到自身环境的租户仍持有它——这与 `MWT_MCP_GATEWAY_KEY` 是同一个已知限制，靠按租户的凭据关闭，而不是靠本次改动。

全局技能目录现在有唯一所有者，因此 Admin 换到另一个账号后，目录会停在原所有者名下，直到再次运行 `scripts/harden-homes.mjs --apply`；网关的启动日志会写出当前所有者，让这种漂移可见。

整个容器仍共享一个网络命名空间、一个 pid 命名空间和一个文件系统：uid 隔离关闭的是跨 home 读取与环境中的密钥泄漏，而不是某租户耗尽内存或端口——那些仍由容器上限（`mem_limit`、`pids_limit`、`cpus`）负责。

容器内的 root 仍能读取每个 home：那是 supervisor 的职责。它也不再能读取另一个 uid 的 `/proc/<pid>/environ`（容器没有 `CAP_SYS_PTRACE`），因此子进程环境的证据是以租户自己的 uid 采集的。

## 验证

本地：`node --test gateway/*.test.mjs` 通过（78 pass，Windows 上跳过 1 项：POSIX 所有权遍历），包括新增的 `gateway/tenant-uid.test.mjs`（uid 算术、表校验与幂等、三个被拒凭据缺席而 `FABERLOOM_MIRROR_KEY`、`FABERLOOM_CEO_SIGNERS`、`DSH_HOME`、`HOME`、`MWT_MCP_GATEWAY_KEY`、`DEEPSEEK_API_KEY` 在场、所有权遍历、全局技能目录的选主、接线断言）和更新后的 `gateway/tools-mode.test.mjs`（只有 `PTC_JAIL` 指定包装器时才写 `ptc-runtime` 行）。

在已部署主机上，先用经过验证的卷备份（`4.28 GB`，`tar tzf` 可列出，抽出一个文件其 sha256 与原件一致）在任何 `chown` 之前完成：

- dry run 与 `--apply` 把 30001..30012 分配给 12 个租户 home，第 13 个（`shared`，部署的共享目录）保持 root `755`，所有密钥文件报告为已是 `0600`。第二次 `--apply` 对全部条目打印 `sin cambios`。
- 以 uid 30001 执行 `cat /data/users/<otro>/storages/faberloom_mcp.json`、`ls /data/users/<otro>`、`cat /data/gateway-users.json` 和 `cat /data/secrets/mwt_mcp_gateway_key` 全部以 `Permission denied` 失败；在自己的 home 内写入成功。
- 重建后有八个 `dsh` 进程存活，各自拥有自己的 uid 与 gid，`context-mode` 子进程继承之。
- 以自身 uid 读取某个 `dsh` 的环境，没有 `SESSION_SECRET`、`DATABASE_URL`、`MEMORY_ADMIN_KEY`，而有 `FABERLOOM_MIRROR_KEY`、`FABERLOOM_CEO_SIGNERS`、`DSH_HOME`、`HOME`、`MWT_MCP_GATEWAY_KEY`、`DEEPSEEK_API_KEY` 与 `DSH_PERMISSION_MODE`。
- 租户本地 MCP 服务器对带正确镜像键的请求返回 `initialize`，对带错误键的请求返回 `unknown or revoked token`。
- 在 `/data/shared/skills` 写入在 Admin 的 uid 下成功，在另一个租户的 uid 下以 `Permission denied` 失败；目录为 `tenant-5:tenant-5 2775`。
- 以 uid 30004，一个 MCP 客户端带部署键与该租户的头部访问 `consola-mwt-one-mcp:8765`，列出 52 个工具，`mwt_whoami` 返回该租户的身份。
- 以试点租户 uid、cwd 为其 home 的 `node` 进程对另一个 home、`gateway-users.json` 与 MCP 键都以 `EACCES` 失败，在自己的 home 内写入成功。
