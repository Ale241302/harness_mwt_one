# Agent Note: Evidence-linked FaberLoom portable delivery

Status: proposed

English | [中文](2026-11-05-faberloom-portable-verification.zh.md)

## Problem

The FaberLoom portable source package defines 58 acceptance requirements across local operation, proposals, publication, host adapters, optional MWT, and distribution. A passing component test does not establish that a host loaded an authorized revision or that a proposal produced exactly the approved persistent effect. Independent phase reports can also omit requirements or reuse evidence from another code revision.

## Proposal

Use the [phase-and-wave plan](../../../../docs/scratch/faberloom-portable-fases-olas.md) as the temporary execution reference. Its 43 waves assign owners, changes, comparisons, acceptance, recovery, and dependencies. Phase 0 specifies the verification harness without implementing it. H0 builds that harness inside the first authorized coding wave, 1.1 or 2.1.

Keep an explicit requirement-to-wave-to-test-to-evidence registry. Reuse repository runners and compare observable permissions, files, persistent records, artifacts, and host-loaded revisions against independent expected results. Missing credentials, skipped tests, zero selected tests, or stale evidence cannot establish acceptance. Mutation fixtures verify that the checker rejects a missing requirement, altered bytes, and an unverified human approval.

Authorization and references arrive in wave 1.4, publication delivery in 3A.4, and the same-connection read-and-propose demonstration in 1.5 before Phase 1 closes. Portable content excludes Sessions, transcripts, and credentials. Approval checks cover direct imports and restoration as well as approval methods.

## Relationship to existing notes

The active-note search found no existing decision owning this delivery plan. The [Space context proposal](../feature/2026-10-03-automatic-semantic-space-context.md) retains ownership of context discovery and distillation. The [shared Sessions decision](../../implemented/feature/2026-10-04-space-shared-sessions.md) retains its separate sharing mechanism; excluding Sessions from portable packages does not remove that feature. Neither note is superseded or archived by this proposal.

## Alternatives considered

**A prose checklist alone.** It records intentions but cannot reject missing evidence or a silently narrowed requirement set. The proposal adds a machine-checked registry while retaining the detailed planning reference.

**A separate execution framework.** The repository already has runners, composition tests, and session replay. A second general runner would duplicate scheduling and platform policy; new code should only own portable-specific selection, evidence, and comparisons.

**Complete each phase without cross-phase integration.** Phase 1 needs real publication reading to demonstrate the same connection can read and propose. The explicit 1.4 to 3A.4 to 1.5 dependency avoids accepting a reader double as the final integration.

## Acceptance criteria

- All 58 source requirements and applicable existing F01 to F50 regressions have explicit ownership and verification mappings.
- Harness negative controls reject missing requirements, zero-test success, changed artifact bytes, and evidence from another revision.
- Every stateful wave verifies recovery and compares externally observed effects, rather than relying on model self-report.
- No dependent work closes while a required property is refuted or unverified; host support remains specific to the tested application, version, and platform.
- Implementation follows the repository's coverage, composition, snapshot, persistence, and documentation requirements without weakening them.

## Decisions

Architecture fixed six inputs on 2026-11-05 so 0.2 can proceed: the first certified host surface is Claude Code with a dedicated non-admin organization account (D01); the first cut keeps the home reachable only locally while the remote service stays unbuilt (D02); editorial authority is a per-organization knowledge Git repository whose only writer is a `publication` technical actor (D03); CEO-ONLY, N3, and N4 are excluded through a server-evaluated allowlist (D04); inheritance is explicit per contribution, with the child winning and declared exclusions prevailing (D05); and the local home uses an explicit BYOK or local-endpoint provider mode, with credentials in the host store and data outside synchronized folders (D08). The [plan](../../../../docs/scratch/faberloom-portable-fases-olas.md#22-decisiones-bloqueos-y-resoluciones) records each rule; D06, D07, and D09 to D14 remain open, blocking only the waves that consume them.

## Risks

The external generator branch, Console/IdP, deployed MinIO policy, and actual host accounts remain separate inputs. Their absence can block particular waves without invalidating independent local work. The plan is not authorization to execute its phases or access production. The temporary document expires and must be reviewed rather than becoming a second description of shipped runtime behavior.
