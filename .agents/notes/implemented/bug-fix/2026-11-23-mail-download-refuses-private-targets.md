# Agent Note: the mail download refuses private targets and bounds the body

Status: implemented

English | [中文](2026-11-23-mail-download-refuses-private-targets.zh.md)

## Problem

`faberloom_mail_download` handed a sender-controlled link to `fetch`, which follows redirects on its own and buffers the whole response. A message could point the agent at `127.0.0.1`, at the deployment's private network, at a metadata endpoint, or at a server that never finishes answering. The tool also wrote the response under the sender's chosen name in the session folder.

## Decision

### The host is resolved and checked here

`download.ts` resolves the hostname once and refuses the request when any answer is loopback, private, link-local, carrier-grade NAT, multicast, reserved, or unspecified. A literal address is checked without resolving it, and an IPv4-mapped IPv6 literal takes the verdict of the IPv4 address it embeds. Checking every answer, not only the first, keeps a mixed DNS answer set from hiding a private entry.

### The socket is pinned to the checked address

The request opens with a pinned `lookup` that returns the address already checked, while the `Host` header and the TLS server name stay the original hostname. A second DNS answer therefore cannot move the connection after the check, which is the DNS-rebinding case a pre-flight check alone leaves open.

### Every redirect repeats the whole check

The tool follows at most five redirects. Each hop is parsed again as an absolute `http` or `https` URL, resolved again, and checked again before a connection opens; a redirect to `file:`, to a private address, or without a destination stops the chain.

### The body is bounded while it streams

The cap is 20 MB. A declared `content-length` over the cap is refused before reading, and the stream is cut at the first chunk that passes it, so a missing or lying length header cannot exhaust the process. The whole operation has a 30-second bound.

### A download never replaces an existing entry

The name is reduced to a basename, invalid characters become `_`, and `.` or `..` fall back to `descarga`. The file is written with the `wx` flag under the first free name (`oc (2).pdf`), so a symlink pre-placed in the folder can neither be followed nor overwritten. The folder must be a real directory, checked with `lstat`.

## Alternatives considered

**An allow-list of download hosts.** Rejected: mail links point at arbitrary customer and carrier domains, and the list would rot.

**A separate download proxy.** Rejected for this slice: it adds a public HTTP surface with its own authentication and quota, while the tool already runs inside the owner's session.

**Trust `content-length`.** Rejected: the sender controls it, and an absent header is common.

## Consequences

A private or oversized link fails with a message the model can act on. A legitimate host that also publishes a private answer is refused, which is the conservative direction. Every download is a new file; the tool never overwrites what the owner already has in `correo-adjuntos`.

## Testing

`corepack pnpm run typecheck` passes; `vitest run packages/faberloom/tool-faberloom/tests` passes 179 tests. New coverage: the blocked-address table on both families and mapped literals; a loopback literal is refused without resolving; a name with one private answer is refused; a public name returns the checked address; a redirect to a private address is refused after one request; a redirect to a public address is followed with a second resolution; a declared and a streamed body over the cap are both refused; the exact bound is accepted; a sixth redirect is refused; traversal names fall back; an existing name becomes `(2)`; a symlink is not followed.
