# Agent Note: The MWT.ONE operator guard belongs to declared operators

Status: implemented

English | [中文](2026-11-13-mwt-guard-operator-scope.zh.md)

## Problem

A Marluvas mailbox — an external tenant whose console role is Admin/CEO inside its own company — opened its Mesa de trabajo and found 176 items. None of them were its own work: the queue carried expediente tasks for Muito Work Limitada and for other clients, plus a long column of identical `Dead letter: mwt-revisar` rows. The owner had never connected a mailbox, so nothing about mail explained it.

Two facts in the code produced that board. `ensureBuiltinRoutines` provisioned the MWT.ONE guard routine (`Vigía MWT.ONE`, step `mwt-revisar`, recurrence every 6h) for every owner whose deployment mounted the `mwt` MCP tools. Tool mounting is deployment-wide, so every signed-in identity received a routine that reviews the whole book and files expediente tasks about any client. Second, a step failure under `failurePolicy: 'review'` files one `Dead letter:` item per failed execution with no key and no dedupe, so a routine that fails on every tick grows the queue by itself — four items a day at that cadence.

The guard's own prompt made the leak worse for a privileged outsider: it asks for the SAP check only for Admin/CEO, so an external Admin/CEO finds more of the vendor's pending work, not less.

## Decision

**An identity runs the guard only when the deployment declares it an operator.** Two validated `Config` fields name that set: `mwtOperatorEmails` (exact emails, default empty) and `mwtOperatorDomains` (default `['muitowork.com']`, the vendor's own staff). `isMwtOperator` compares the acting identity's email — the gateway injects it as `ownerId` — case-insensitively against both lists. A role never decides: Admin/CEO describes the tenant the identity administers, not the book the guard reads.

**Provisioning and retirement are the same convergence step.** `ensureBuiltinRoutines` provisions the guard when `hasMwtTools() && isMwtOperator()`; otherwise it retires what may already exist: pause the routine when it is active, then close every non-terminal item that routine filed, with the closed-list reason `ERROR_ORIGEN`. An item counts as filed by the guard when it names the routine, carries one of its execution ids, or carries as its run id the agent session a completed step recorded. An item whose severity is still null is settled as `LOW`/`RULE` first, because the board only closes an item whose severity is decided. Retirement runs whether or not the MWT tools are mounted, so a deployment that removes them still clears what the guard left behind.

**A console role never grants installation-wide reading.** The gateway that renders each user's patch derives the FaberLoom role in `gateway/faberloom-role.mjs`: outside the operator domains, an `admin`, `superadmin`, or `ceo` role reaches the product as `client_b2b`. The board reads across every company for those role names, which is how the reported identity saw 177 rows about other tenants while its own board held one item.

**Closing, never deleting.** Discarding keeps each row and its reason, so the board holds an audit trail of what the deployment-owned routine filed on the wrong Mesa. Nothing a person approved, delegated, or closed is touched: the pass skips terminal rows and every item credited to another routine.

## Alternatives considered

**Gate on the console role.** Rejected: it reads as the obvious signal and produces exactly the wrong answer. The owner in the report *was* Admin/CEO; the missing fact was which book that role governs.

**Hide the items in the Mesa for readers outside the operator domain.** Rejected: the board has no per-reader visibility — an item belongs to its owner and company — and hiding would leave the routine running, still reading the whole book and still spending model calls on it.

**Stop mounting the `mwt` MCP client for non-operators.** Rejected: `client_b2b` users legitimately query their own expedientes, and the MCP already scopes by the forwarded identity. Removing the tools would break the client product to fix a provisioning mistake.

**Delete the filed items.** Rejected: closing preserves what the routine claimed and why it was withdrawn, which is what tells a reader later that the queue was wrong.

## Consequences

Operators keep the guard with no configuration, because `muitowork.com` is the schema default; a deployment with a different operator set declares it. An external tenant loses the routine and the work it filed, and keeps its own mail, workflows, and manual items. The retirement is a write on the read path, once per process, mirroring the definition convergence that already rewrites a deployment-owned routine there; an item the board refuses to close stays in place and the caller logs the failure rather than dropping it silently.

One gap stays open by design: the identity gate decides who receives the guard, not what the MWT.ONE MCP answers. A tenant that calls `mcp__mwt__*` directly still sees whatever the console grants its email, so a deployment that wants to deny MWT.ONE to a tenant must do it in the MCP, not here.

## Testing

`packages/faberloom/view/tests/mwt-guard-scope.spec.ts` pins the boundary: an operator declared by email provisions and activates the guard; an external tenant pauses it and closes only the rows the guard filed — by routine, by execution id, and by the step session recorded as the run id — skipping closed rows, another routine's rows, and an item whose run id belongs to no guard step, and settling a null severity before discarding; a paused guard is left alone; an owner that never held the guard causes no board read; retirement runs without the MWT tools and pauses the routine when the deployment mounts no board. `gateway/tests/faberloom-role.spec.mjs` pins the role derivation: an operator domain keeps the console role, an external `admin`/`ceo`/`superadmin` becomes `client_b2b`, a client role passes through, and a missing identity falls back to the client role. `packages/faberloom/view/tests/email-actions.spec.ts` keeps the domain-default provisioning case green, so the operator path is unchanged.
