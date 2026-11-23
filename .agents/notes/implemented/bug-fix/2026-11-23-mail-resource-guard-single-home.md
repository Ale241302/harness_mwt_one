# Agent Note: the mail resource guard is one home, and painted images use it

Status: implemented

English | [中文](2026-11-23-mail-resource-guard-single-home.zh.md)

## Problem

`faberloom_mail_download` guarded a sender-controlled link properly, but `emailImage` — the call that fetches a remote picture a message body references so the sandboxed reader can paint it — checked only the literal hostname: `127.0.0.1`, `192.168.*`, `.internal`. A public name that resolves to loopback, or a redirect that lands there, still reached the deployment's own network, because `fetch` resolved and connected on its own and followed redirects internally. That is the same server-side request forgery the download had already closed, left open on the surface the reader calls for every message it opens.

The two implementations also could not simply import each other: `tool-faberloom` depends on `view` for its service types, so `view` importing `tool-faberloom` would close a package cycle.

## Decision

### One guard, owned by the mail-facing layer

`packages/faberloom/inbound/src/net-guard.ts` owns address resolution, the blocked ranges, the pinned connection, the redirect loop and the byte/time budget. `inbound` is the lowest mail-facing package that both consumers already depend on, so it is the only home without a cycle. `fetchPublicResource` is exported from the package root because the workspace build emits only `index`, `invariant` and `startup` per package: a `src/*` import would work in tests and fail from `lib/`.

### The consumer keeps its own limits and wording

`downloadMailLink` passes 20 MB, 30 seconds and the noun `link`; `fetchEmailImage` passes 4 MB, 8 seconds, `image/*` and the noun `image`. The guard never invents a limit, and refusal messages stay in the consumer's vocabulary (`the link answered more than …`, `the image points at a private address`).

### The whole chain shares one deadline and one budget

The first version armed one timeout per hop, so five redirects could take five times the bound. The guard now arms one `AbortSignal.timeout` and passes it to every hop, and one `readLimited` bound covers the body that finally answers.

## Alternatives considered

**Duplicate the guard in `view`.** Rejected: two copies of a security table drift, and the cross-file clone check rejects it.

**A new package for the guard.** Rejected for this slice: a package needs its own manifest, tsconfig, aggregate registration, lockfile entry and README, for one module with two consumers that already share a lower layer.

**Rely on the `fetch` implementation.** Rejected: the blocking property is address pinning. Any client that resolves again can be rebound after the check.

## Consequences

`emailImage` refuses a name whose answer set contains a private address, and a redirect to one, before any connection. A legitimate image host that also publishes a private answer is refused, which is the conservative direction. The download's public surface is unchanged: `download.ts` re-exports the primitives its tests import.

## Testing

`vitest run packages/faberloom/view/tests/email-image.spec.ts packages/faberloom/tool-faberloom/tests/mail-download.spec.ts` passes 23 tests. New coverage: a name resolving to `127.0.0.1` is refused with no request opened; a private literal is refused; a redirect to a private address is refused; a redirect to a public address is followed with a second resolution; an empty body, a non-image type, an oversized `content-length` and a non-http scheme are refused; the download suite still passes unchanged.
