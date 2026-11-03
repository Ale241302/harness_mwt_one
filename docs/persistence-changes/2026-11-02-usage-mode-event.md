---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-02-usage-mode-event

English | [中文](2026-11-02-usage-mode-event.zh.md)

## Summary

Adds the log-only faberloom/usage-mode session event, which records whether a composed session's request authenticated with the deployment key or the account's own key.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-02-usage-mode-event
baseline: false
changes:
  - root: "event:faberloom/usage-mode"
    previous: null
    after: "c35b4b27bb2a555227c1219b2293a88b55e5c0727a3164882bb8290be14d9610"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing session logs remain valid. The event is additive and only the FaberLoom session composition writes it; a build without the declaration refuses a log that carries it, so desktop and web ship together. The event stores the mode, never a credential value or reference.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/faberloom/session-agent/tests: 88 tests passed. The record is acknowledged by verify-persistence-changes.

<a id="dev-note"></a>
## Dev Note

None.
