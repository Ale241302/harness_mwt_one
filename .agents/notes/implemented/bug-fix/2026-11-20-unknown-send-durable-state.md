# Agent Note: Unknown sends reconcile from durable intent state

Status: implemented

English | [中文](2026-11-20-unknown-send-durable-state.zh.md)

## Problem

The Correo composer decided whether to offer send reconciliation by searching the returned error message for `SEND_RESULT_UNKNOWN`. The service throws `FaberLoomSendError` with that code in a separate property, so the Remote error message can describe the lost SMTP response without containing the code. The durable attempt was `unknown`, but the owner received no decision controls.

## Decision

**The composer reads the draft's persisted send intents after a failed send.** Only an intent in `unknown` opens the reconciliation controls, even when the error message omits the stable code. An active `sending` attempt offers no settlement decision, and a failed intent read preserves the original send error instead of replacing it. The service also refuses `resolveSend` while that same process still owns the transmission, closing the alternate-call route; an attempt left `sending` after a process restart remains recoverable.

The PC4 smoke proxy in `scripts/faberloom-daily/smtp-cut-proxy.cjs` supplies the controlled failure. It listens only on loopback, relays SMTP over implicit TLS to the configured upstream, and withholds a final `250` only for an exact configured Subject after the upstream has accepted the complete DATA. Its log carries only time, action and Subject digest.

## Alternatives considered

**Include the code in every human-readable error.** Rejected as the sole mechanism: text is presentation, while the persisted attempt is the authoritative outcome. Remote serialization can also keep those fields separate.

**Infer the state from a closed socket in the browser.** Rejected: the browser cannot distinguish a pre-delivery refusal from a lost post-DATA acknowledgement; only the host's recorded transition carries that distinction.

## Consequences

A lost SMTP response produces a durable `unknown` and visible owner decisions without a blind retry. Reconciliation still requires inspecting Sent or the recipient before choosing `sent`; the UI change neither observes delivery nor settles an attempt automatically. The proxy is a controlled test tool, not an automatic retry or a production sending path.

## Testing

`registration.client.spec.tsx` reproduces an error without the code and a persisted `unknown`, then settles it through `emailResolveSend`; it also proves a `sending` intent shows no settlement controls. `send-intents.spec.ts` holds the SMTP reply, then proves both `resolveSend` outcomes refuse while the transmission is live and that the completed send settles normally. `smtp-cut-proxy.spec.ts` covers a non-target message that receives `250` and a target whose upstream accepts DATA while the client loses the reply; it also checks that logs omit credentials, recipients, body and literal Subject. The real PC4 observation is recorded outside the source tree with the received message, restored SMTP configuration and read-back settlement.
