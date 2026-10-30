---
description: "The Mesa mail effect adapter: sends an approved item through its owner's SMTP connection and registers mail.send on the board's effect machine."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-effects-mail

English | [中文](README.zh.md)

## Summary

The board owns when an effect leaves and registers one adapter per action type (E15); it owns no mail client. This row is the `mail.send` provider. It reads the approved item, composes one plain-text message from the revision the human approved, and sends it through the owner's own SMTP connection in `faberloomConnections`. The destination is the normalised recipient list the approval named.

The adapter declares `idempotent: false`: SMTP cannot dedupe, so the board never offers a retry of an unknown outcome, only reconciliation. A throw from the connection reaches the board as `DESCONOCIDO`, never as "sent" (W-22).

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row beside the board and the connections service. The bundle mounts it by default; `FABERLOOM_EFFECT_MAIL=0` removes it. The board accepts the action type only when the deployment declared it, so the row registers nothing while `FABERLOOM_EFFECT_ACTION_TYPES` is empty (A-05).

```yaml
- id: faberloom-effects-mail
  name: '@deepseek-ai/dsh-faberloom-effects-mail'
  config:
    actionType: mail.send
```

The effect reaches the adapter only after the board has verified the reservation, the exact execution, the item state, the controls, and the CEO signature for the protected action type. The adapter itself sends exactly once per dispatch attempt.

The message body is the approved revision's summary, its evidence references, and its document reference; the subject is the item title. Nothing is invented: an item without the approved revision throws `NO_APPROVED_REVISION` and the effect is not reported as sent.

## Model Experience

### Effect dispatch

#### What the model sees

Nothing. The row adds no prompt, tool, or schema; an approval and its effect are product operations the board already exposes.

#### Token effect

Zero direct tokens. The approved revision and the recipients are read from the board, not from a model.

#### KV Cache effect

Independent: the row never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Plain text only** — an approved artifact with a document reference names it in the body; it is not attached. Attaching the artifact requires a document renderer that the product does not have yet.
- **No destination dedupe** — SMTP reports no idempotency key, so `idempotent` is false and an unknown outcome is reconciled by the operator, never retried automatically.
- **The dispatch timeout does not cancel SMTP** — the board stops waiting at its configured timeout and reports `DESCONOCIDO`; the socket may still complete, which is exactly why the outcome is unknown rather than failed.
