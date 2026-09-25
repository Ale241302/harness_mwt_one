# git 仓库策略

[English](git-strategy.md) | 中文

更新于 2026 年 9 月 20 日。

## 远程仓库

| 远程 | URL | 用途 |
|---|---|---|
| `origin` | `https://github.com/deepseek-ai/deepseek-harness` | DeepSeek 上游。仅 `fetch`；未启用 `push` |
| `fork` | `https://github.com/Ale241302/harness_mwt_one` | 我们的仓库。`push` 到这里 |

主分支：`main`。相关标签：`faberloom-0.1.0`（产品首次切分）、`deploy-2026-09-14` 与 `deploy-2026-09-15`（部署里程碑）。

## 这个仓库是什么

**DeepSeek Harness 代码的一个 fork，带有产品层与部署层。** 在 `main` 中并存：

- harness 源码（`packages/`、`apps/`、`vendor/`……）即其编译形态；
- MWT.ONE 集成层：`gateway/`（登录 + 每用户 `dsh` 监督）、`Dockerfile`、`docker-compose.yml`、`nginx/`、`skills-catalog/`、`scripts/`，以及运维文档（`README.mwt-one.md`、`MANIFEST.md`、`docs/`）。

该 fork 在 `feat/faberloom-native` 分支上成形，并与 `main` 合并，其历史与先前的部署分支无关；此后 `main` 是唯一来源。

## harness 如何构建

harness **不从 npm 消费**。`Dockerfile`（第 1 阶段）从源码压缩包 `vendor/deepseek-harness-src.tgz` 构建它，该压缩包由 `scripts/push-to-vps.ps1` 用 `git archive` 从 fork 树生成。fork 的真实 SHA 作为 `DSH_FORK_SHA`（构建参数）注入，使镜像不会留下一个不可追溯的合成提交。

fork 固定的版本：**`0.1.6-alpha.1`**（`package.json`）。任何较早引用的版本（`0.1.5-rc.2`）属历史，已不再适用。

## harness 更新

- fork 在工作分支上从 `upstream` 更新，而不是未经测试直接 `merge` 到 `main`。
- 更新在隔离环境中测试，记录到 `MANIFEST.md`（引擎、插件、schema），再用 `scripts/update-harness.sh` 推广——它给旧镜像打标签、重新构建，并在健康检查失败时回滚。
- `vendor/deepseek-harness-src.tgz` 是生成产物（被 git 忽略）；不纳入版本控制。
