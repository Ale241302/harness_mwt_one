# Agent Note：`run_code` 的每次程序运行都在按次 bubblewrap 隔离笼内

Status: implemented

[English](2026-11-24-ptc-jail-per-run.md) | 中文

## 问题

`run_code`（PTC）在子 Node 进程里执行模型编写的 TypeScript，该进程保留 `fs`、`net` 和 `child_process`。harness 的 sandbox 只限制写入：在 `danger-full-access` 下 PTC 的 argv 完全不被包裹，在 `workspace-write` 下运行器配置是 `--ro-bind / /`，宿主机的每条路径仍可读。网关为每个租户保留一个 `DSH_HOME`，位于 `/data/users/<id>`，而每个 home 存放该租户的 MCP 凭据（`storages/faberloom_mcp.json`、`storages/*token*`）。因此模型写的程序可以读到另一个租户的令牌，并以该租户身份调用 MCP——不经策略检查、不经批准——进程边界里没有任何东西阻止它。在没有堵住这条路径的情况下为租户打开 Code Mode 不是权衡，而是把一个租户的凭据交给另一个租户。

## 决策

`deploy/jail/node-jail` 发布到 `/opt/dsh/bin/node-jail`，通过 `ptc-runtime` 行上该包已有的 `nodeExecutable` 配置选中，因此 `packages/ptc-runtime/ptc-runtime-node` 未改动。包装器接收该包本会传给 `node` 的参数，并以 `bwrap --unshare-all --die-with-parent --new-session` 重新执行 `node`。

租户 home 通过子进程的工作目录到达包装器，因为 runtime 在 spawn 前把 `process.env` 换成空字典，并且拥有 argv。会话工作区是 `/data/users/<id>` 或其子目录，包装器据此推导 home，要求 `/data/users` 之下恰好一个组件，对任何其他工作目录以 126 退出。`PTC_JAIL_HOME` 可为手工运行覆盖推导，且受同一规则约束。

`tenants` 是保留段。启用 `FABERLOOM_TENANT_HOME=1` 时，网关给租户共享 home `/data/users/tenants/<key>`（`gateway/tenant-home.mjs` 中的 `shouldShareTenantHome`），它在 `/data/users` 之下的第一个组件是存放所有租户的目录。在那里推导 home 会无错地挂载它们全部为可写，因此包装器按名字拒绝该段，Code Mode 在启用共享租户 home 的部署上不运行。支持它需要从 `homeFor` 推导深度，而不是从路径猜测。

隔离笼内：新的 user、mount、pid、net、ipc 和 uts 命名空间；`/usr` 与 `/opt/dsh` 只读；`/bin`、`/sbin`、`/lib`、`/lib64` 作为合并 `/usr` 的符号链接；存在时 `/etc/ssl`、`/etc/passwd`、`/etc/group` 和 `/etc/ld.so.cache` 只读；`/proc` 上新的 procfs；`/tmp` 上 1777 的 tmpfs；以及以其绝对路径可写的租户 home。`/app` 和其他每个租户的 home 不在挂载集合中，而不只是不可读。

子进程控制通道是继承的描述符 7。`bwrap` 会保留未被 `--sync-fd` 指名的继承描述符，并在 exec 前立即关闭被指名的那些；包装器绝不能传 `--sync-fd 7`。

失败在两个方向都响亮。缺少 `bwrap`、工作目录在 `/data/users/<id>` 之外，或 `bwrap` 无法创建命名空间，都会以 stderr 上的消息结束运行，而不是给出一个受隔离的运行；runtime 会把它报为 `worker-exec` 并带上 `bwrap` 的文本。

`deploy/jail/bwrap-seccomp.json` 保留 Docker 默认配置，并新增一条针对 `clone`、`unshare`、`mount`、`umount2`、`pivot_root` 和 `setns` 的允许规则；`deploy/jail/README.md` 记录了所需的容器选项。在已部署主机上的实测结果（见下）是仅靠该配置不够，因此 `docker-compose.yml` 并未应用它：隔离笼是给允许下一节所述条件的宿主机用的产物，`PTC_JAIL` 默认为空。

`DSH_PERMISSION_MODE` 保持在原处：`.env` 或网关自身的 `detectSandboxMode()` 探测。两种模式下隔离笼执行相同的挂载，因为它是 runtime 启动的可执行文件，而不是包在它外面的 sandbox 包装器。在 `workspace-write` 下 runtime 会先用 shell 配置包裹该可执行文件，因此隔离笼嵌套在其中；该组合在此未经验证。

网关在完全没有隔离的情况下拒绝提供 Code Mode。`HARNESS_TOOLS_MODE` 不是 `native` 时需要两条路径之一：`PTC_JAIL`（本包装器，面向允许非特权用户命名空间的主机）或[uid 笔记](2026-11-24-tenant-uid-isolation.zh.md)所述的按租户 uid 隔离（`HARNESS_TENANT_UID=1` 且表存在）。两者都没有时，启动会以与无效模式相同的 FATAL 行中止，而不是写出一个让 PTC 用 runtime 默认 `process.execPath` 启用的每用户补丁。`ptc-runtime` 行只随 `PTC_JAIL` 一起写：在 uid 隔离下补丁只启用 `tools`，让 runtime 使用 `process.execPath`，因为内核分隔租户，不需要包装器。

## 隔离笼不覆盖的内容

- **笼内没有系统调用过滤。** `bwrap` 不带 `--seccomp` 运行，所以程序可以调用内核对其用户命名空间允许的任何东西，包括创建更多嵌套用户命名空间。嵌套命名空间只会缩小可达范围，不会扩大挂载集合。
- **自身没有资源上限。** CPU、内存和 pid 上限仍在原处：runtime 的 `maxOldGenerationSizeMb` 与容器的 `mem_limit`/`pids_limit`。
- **租户自己的 home 完全可写，包括自己的令牌。** 程序可以读取本租户的凭据。那是自访问而非跨租户访问，而且没有网络，运行结束后带不走。
- **对 `bash` 工具或其他 agent 没有保护。** 二者仍按容器策略运行，本次改动保持原样：`.env` 或网关探测。
- **不控制通过对话的外泄。** 把数据返回给模型的程序会把它放进记录；模型本来就通过工具看到该租户的数据，所以记录不是新通道。隔离笼保护磁盘和套接字，不保护答案。
- **不审计拒绝。** 被拒绝的路径只以程序自己输出里的 `ENOENT`/`EPERM` 出现。

在已部署镜像上，当 `/data/users` 中至少存在两个租户、且其中一个持有 `storages/faberloom_mcp.json` 时，`verify.sh` 为每个用例打印 `PASS`，才可安全在隔离笼下为租户启用 `ptc`。[呈现开关](2026-11-24-harness-tools-presentation-switch.zh.md) 决定谁获得 `ptc`；本笔记只让它安全可行。在启用 uid 隔离的部署上不需要隔离笼，也不运行 `verify.sh`：控制者是内核，验证记录在[uid 笔记](2026-11-24-tenant-uid-isolation.zh.md)。

## 备选方案

**修改 `packages/ptc-runtime/ptc-runtime-node` 以增加 argv 前缀。** 拒绝：该包已通过 `nodeExecutable` 把可执行文件交给部署，在 runtime 内再加一个部署开关需要为配置已提供的能力自带测试、README 和 JSDoc。

**通过参数或 `PTC_JAIL_HOME` 从 supervisor 传入租户 home。** 拒绝：runtime 会清空子进程环境并拥有 argv，两个通道都无法在不改包的情况下携带按次的值。工作目录已经精确携带它。

**用 `workspace-write` 约束程序而不是隔离笼。** 拒绝：该配置是 `--ro-bind / /`；它阻止写入却让其他每个租户的 home 仍可读，而这正是要关闭的风险。

**每次调用在独立容器中运行 PTC。** 暂时拒绝：对同样的隔离而言运维面更大（镜像分发、卷挂载、每次调用的容器生命周期），而 runtime 已经通过继承通道把程序作为子进程运行。

**用 `--sync-fd 7` 保留控制通道。** 依据源码拒绝：`bwrap` 在 exec 前会关闭 `--sync-fd` 描述符，所以通道必须作为普通继承描述符存活。

**对容器使用 `seccomp=unconfined`。** 拒绝：为了找回六个系统调用而移除整张拒绝清单——`keyctl`、`bpf`、`perf_event_open`、模块加载器。

## 后果

镜像带有两个 shell 脚本，任一停止解析则构建失败（镜像构建时的 `sh -n`）。在允许非特权用户命名空间的宿主机上启用隔离笼只需设置 `PTC_JAIL`，别无其他。如果代码运行在禁止非特权用户命名空间的宿主机上，或运行在没有 `userns` 规则的 AppArmor 配置下，每次 PTC 运行都会以 `bwrap: No permissions to create a new namespace` 失败——这是 Code Mode 的可用性故障，绝不是无隔离的回退。存储的工作目录位于 `/data/users/<id>` 之外的会话——任何在 `HOME` 变为按用户之前创建的会话——同样被拒绝，直到它开始新会话。

本部署既不运行隔离笼，也不运行无隔离的 PTC：`PTC_JAIL` 保持为空，Code Mode 依赖按租户的 uid、`0700` 的 home，以及把子进程降为该 uid。

## 验证

本地已验证：两个脚本在 `dash -n` 下解析；内嵌检查器在 `node --check` 下解析；配置是有效 JSON，其首条规则是新增的那条；`docker-compose.yml` 按所写解析并可解析出 `PTC_JAIL`。检查器也在隔离笼之外执行过，在那里它使 `jaula activa`、`/data/users` 和每个网络用例失败并以 1 退出——失败关闭的对照。

在已部署主机上实测（`srv1416291`，Linux 6.8.0-147，内核 `apparmor_restrict_unprivileged_userns = 1`，LSM 列表包含 `landlock`）：

- 在网关容器内，`bwrap --unshare-all` 以 `No permissions to create a new namespace` 退出 1，`unshare -U true` 以 `Operation not permitted` 失败。
- 只带 `deploy/jail/bwrap-seccomp.json` 加 `systempaths=unconfined` 的一次性容器走得更远，在 `Failed to make / slave: Permission denied` 处失败：`/` 属于父用户命名空间，在那里把它重挂为 slave 需要 `CAP_SYS_ADMIN`。
- 仅 `apparmor=unconfined` 没有任何改变。
- `CAP_SYS_ADMIN` + `CAP_NET_ADMIN` + seccomp 配置 + `apparmor=unconfined` 确实创建命名空间（随后探测失败只是因为一次性运行没有绑定文件系统），所以隔离笼**只能**通过把这两项能力授予多租户网关来实现。

该代价被本部署拒绝：在已持有每个租户 home 的容器上开 `CAP_SYS_ADMIN`，比隔离笼所关闭的暴露更糟。因此 `PTC_JAIL` 默认为空，`docker-compose.yml` 不应用额外安全选项，网关保持 `native`，除非 [uid 笔记](2026-11-24-tenant-uid-isolation.zh.md) 所述的 uid 隔离已激活。同一次运行还发现 `/data/users` 下 13 个目录中有 10 个是 `0755 root`，所以容器内任何进程都能读它们，无论有没有隔离笼；uid 笔记记录了那次迁移及其测量（12 个租户 home 迁到 `30001..30012` 的 `0700`，跨读以 `Permission denied` 失败，`dsh` 环境不含五个部署密钥）。
