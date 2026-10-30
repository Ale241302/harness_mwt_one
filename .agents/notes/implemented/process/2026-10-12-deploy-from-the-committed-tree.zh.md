# Agent Note: Package the deploy from the committed tree

Status: implemented

[English](2026-10-12-deploy-from-the-committed-tree.md) | 中文

## Problem

`scripts/push-to-vps.ps1` 用 `git add -A` 暂存工作树并归档得到的索引来打包 harness，因此 tarball 可能描述一棵根本不是任何提交的树。脚本运行期间落下一个提交，会让部署出的构建悄悄缺了它：实时的 `forkSha` 指向的提交早于 checkout 已经持有的那棵树，于是 `/healthz` 报告了一个镜像并不包含的身份。一次部署可能交付得比树少，而部署日志与健康检查还对同一个错误答案达成了一致。

## Decision

**脚本拒绝打包一棵不是提交的树。** 在暂存任何东西之前，它收集工作树与索引之间有差异的文件（`git diff --name-only`）、索引与 `HEAD` 之间有差异的文件（`git diff --name-only --cached`），以及未跟踪的文件（`git ls-files --others --exclude-standard`）；这份清单非空就中止运行并逐一点出路径，除非传入 `-AllowDirtyTree` 刻意打包一棵脏树，该用法在脚本的用法注释里有记录。

**归档出的树被绑定到 `HEAD`。** 脚本把索引写成一棵树，归档那棵树，并把归档出的树与 `HEAD^{tree}` 比较；不是 `HEAD` 的树就中止，而在归档之后重新读取的 `HEAD` 在打包途中落下提交时中止运行并要求重试。

**这个包携带自己的身份。** 脚本把归档的 SHA-256、树、归档名和 fork SHA 记录到 tarball 旁边的修订文件（`vendor/deepseek-harness-src.revision.txt`），并打印树与 fork SHA，以便部署日志与 `/healthz` 相互比对。树干净时 fork SHA 就是 head 提交；使用 `-AllowDirtyTree` 时它是树 id，那不是提交 id。

**`manifestDrift` 把已部署的 manifest 与实时的 fork SHA 相比较。** 在 `gateway/server.mjs` 里，`buildIdentity()` 读取 fork SHA 文件与已部署的 `MANIFEST.md`，并把 `manifestDrift` 设为 manifest 是否不包含实时 fork SHA 文本；两者任一缺失时为 `null`，因为那时没有信号。这里的 drift 为真，它是部署事实而非代码缺陷：`MANIFEST.md` 是手工维护的，引用的是更早的一次部署，标签为 `deploy-2026-10-09-faberloom-context-agents`，因此 operator 通过更新 manifest 的引用即可清除该判定。

## Alternatives considered

**只打印 `HEAD`，不把它绑定到归档。** 在归档自身那一刻之外的任何时刻读取的 head 修订，会把构建归属于 tarball 未必持有的提交，而这正是本次变更要消除的错误归属；fork SHA 改为从归档出的树发布。

**从 push 脚本重写 `MANIFEST.md`。** 从脚本生成 manifest 会让 `manifestDrift` 永远为 false，判定也就失去意义。manifest 说明的是部署了什么，只有在 operator 维护该说明时判定才有用。

## Consequences

一次部署现在要求树已提交；打包脏树只能通过 `-AllowDirtyTree`，它还会改为发布树 id 而不是提交 id。修订文件让 tarball 离开 checkout 之后仍可被识别。`manifestDrift` 始终是对 manifest 文本的子串测试，因此它只回答已部署的 manifest 是否引用了实时 fork SHA；它不比较内容。
