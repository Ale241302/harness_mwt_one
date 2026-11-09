# Agent Note: A replace writer keeps user files and a recoverable previous tree

Status: implemented

[English](2026-11-09-recoverable-replace.md) | 中文

## Problem

可移植写入器只创建新的 `mkdtemp` 目录。它无法更新已有目标，没有记录哪些文件归自己管理，也无法区分用户编辑与过期工件。先删除再复制的更新若在两步之间中断，会丢失上一棵有效树；盲目清理会删除用户新增的文件。

## Decision

**一份已签名所有权清单决定管理范围。** `packages/faberloom/portable/src/replace.ts` 写入 `.faberloom/ownership.json` 及其分离 Ed25519 签名。清单记录 Space id、工件摘要，以及每个管理路径的字节长度与 SHA-256。更新前，每个管理文件必须仍是以记录哈希存在的单一普通文件；删除或编辑为 `PORTABLE_MANUAL_EDIT`。签名无效的清单为 `PORTABLE_OWNERSHIP_INVALID`，且不触碰任何文件。

**外来文件向前复制。** 不在所有权清单中的文件是外来文件：写入器在交换前把其精确字节复制到暂存树。新工件路径与外来文件重叠时为 `PORTABLE_FOREIGN_CONFLICT`；写入器绝不覆盖。暂存后再次比较完整外来集合，因此写入期间创建、删除或变化的外来文件为 `PORTABLE_CONCURRENT_CHANGE`。

**交换有暂存、签名日志与恢复。** 写入器在同卷创建同级暂存目录，写入工件与清单，复制外来文件，写入所有权清单与签名，然后验证计划字节。它在目标父目录记录**签名**日志，把旧目标改名为备份，把暂存改名到目标，验证新树后才删除备份。伪造或篡改的日志为 `PORTABLE_RECOVERY`，且不触碰任何文件。备份后或交换后崩溃会留下日志与备份；下次运行恢复旧树，或保留已验证的新树并删除备份。新树验证通过后替换即已提交：清理失败会留下日志与备份供下次运行处理，并报告 `cleanupPending`，绝不回滚已验证的新树。只删除本写入器命名并记录在日志中的目录。

**目标是本地、规范化且无链接的。** 目标必须是绝对路径、非 UNC、无父段。目标、其父目录及内部每个条目必须是真实目录或单一普通文件；符号链接或 junction 为 `PORTABLE_SYMLINK`。目标在派生日志键之前解析为真实路径、NFC 规范化，并在 Windows 上大小写折叠，因此可通过同一目录的另一种拼写恢复。写入器在交换前立即重新校验链接、管理哈希与外来集合，而不只在开始时检查。

**服务暴露写入器。** `FaberLoomPortable.replace(destination, request)` 使用与 `stage` 相同的签名密钥与字节上限。它不承诺跨卷或同步文件夹的原子性；同级 rename 是单一本地卷上的恢复单位。

## Alternatives considered

**先删除旧树，再复制新树。** 两步之间崩溃会留下无效目标。备份与日志正是为了避免这一点。

**原地写入管理文件。** 部分写入后没有可恢复的旧树，用户对某个文件的编辑也会被静默覆盖。

**信任未签名的所有权文件。** 本地编辑可以把外来文件声明为管理文件并导致其被删除。签名把清单绑定到部署密钥。

**保留已从计划中消失的管理文件。** 这会在目标中留下过期内容。写入器只在记录哈希仍匹配时删除旧管理文件。

## Consequences

更新要么保持每个管理文件不变，要么以命名冲突停止；用户必须先解决编辑或外来冲突。外来文件逐字节保留并保留模式，空外来目录会重建。崩溃留下可恢复的旧树与签名日志，而不是写了一半的目标。属于另一个 Space 的目标为 `PORTABLE_IDENTITY_CONFLICT`。同一目标一次只允许一个写入器是前提：服务不提供跨进程锁，宿主必须串行化两个并发的 `replace`。写入器不合并管理文件内部的块：被编辑的管理文件是冲突，不是三方合并。

## Verification

- `packages/faberloom/portable/tests/replace.spec.ts`：带外来文件与空目录的首次安装；删除管理文件并保留外来文件的更新；编辑与删除管理文件；外来冲突与 Unicode 别名；目标为符号链接及内部 junction；相对、UNC 与越界目标；目标为普通文件；另一个 Space；篡改所有权；备份后与交换后崩溃；交换被阻；暂存写入磁盘满；并发外来编辑；写入期间创建或删除外来文件；第二次校验期间的编辑；验证提交后的清理失败；交换后日志更新失败；Windows 上通过另一种大小写拼写恢复；伪造日志；编辑清单；二进制外来字节；外来分离签名；POSIX 文件模式；已验证管理目标的校验。
- `packages/faberloom/portable/tests/filesystem.spec.ts`：先前的路径规则仍通过。
- `packages/faberloom/publication/tests/application.spec.ts`：PUB-07 的跨路径、隐藏文件、链接与并发检查仍是发布消费者的证据。
