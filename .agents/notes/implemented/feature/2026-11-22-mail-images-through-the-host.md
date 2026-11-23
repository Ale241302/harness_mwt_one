# Agent Note: mail images load through the Host

Status: implemented

English | [中文](2026-11-22-mail-images-through-the-host.zh.md)

## Problem

Correo painted sender HTML in a sandboxed frame whose policy allowed only `data:` images, and the sanitizer deleted every other `src`. That kept tracking pixels from firing, but it also left every real picture in a commercial mail broken: the Macys, Facebook, and OneDrive newsletters reached the owner as empty boxes. The owner asked for every image to load.

## Decision

### The Host fetches, the frame inlines

`emailImage(source)` is one Remote read: it accepts an absolute `http` or `https` address, fetches it with an 8-second bound and an `image/*` accept header, refuses a response whose declared type is not an image, refuses an empty body or one over 4 MB, and returns the declared media type with the base64 bytes. The frame keeps its own policy — `img-src data:` — and never gains network access.

### The browser never asks the sender

`emailRemoteImages(html)` lists each absolute address a body references once, capped at 30 per message. The panel fetches the missing ones through `emailImage`, caches the bytes per address for the rest of the session, and `resolveEmailImages` writes them into the document as `data:` URLs before `sanitizeEmailHtml` runs. A second visit to the same mail paints immediately from the cache; an address that fails keeps its alt text and leaves no remote source behind.

### The Host refuses its own network

A sender-controlled address is untrusted input to a server-side fetch, so the Host rejects a loopback, link-local, or private IPv4/IPv6 host, plus `localhost` and `.internal`, before the request and again on the URL a redirect landed on. Only `http` and `https` are accepted, so `file:`, `ftp:`, and `data:` never reach the fetcher.

## Alternatives considered

**Allow remote images in the frame policy.** Rejected: the frame would then hand the sender's server the owner's IP address and a read receipt, and a mail could ping a tracker inside the deployment's own network.

**Proxy images through a public route instead of a Remote read.** Rejected for this slice: it adds a new HTTP surface with its own authentication, caching, and rate-limit policy. The Remote already carries the owner's identity and the panel already talks to it.

**Keep blocking images and let the owner open the mail in the original client.** Rejected: it is the exact experience the owner reported as broken.

## Consequences

Every remote picture in a message body now loads, at the cost of one Host fetch per unique address; the cache bounds repeats, and the limits bound one message. Loading reveals the deployment's address to the sender's image host, which is the trade the owner asked for; remote tracking pixels therefore also fire. Inline `cid:` attachments keep their existing path and are resolved before this step. The reader still shows no attachments for MCP mail, because `messages_attachment` remains out of scope.

## Testing

`corepack pnpm run typecheck` passes and the focused Vitest run over `packages/faberloom/view`, `packages/client/ui-faberloom`, `packages/faberloom/mcp-registry`, `packages/faberloom/connections`, and `packages/mcp/mcp-client` passes 822 tests in 71 files. New coverage: the Host returns media type and bytes, refuses a non-URL, a non-http scheme, private and loopback hosts, a non-image type, an empty body, and reports a 404 instead of painting an error page; the resolver lists each address once and inlines the fetched bytes while keeping unresolvable images out; the panel asks `emailImage` for the sender's address and the frame paints a `data:` URL while scripts, forms, and the remote address stay absent.
