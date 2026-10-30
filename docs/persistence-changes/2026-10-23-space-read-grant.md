---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-23-space-read-grant

English | [中文](2026-10-23-space-read-grant.zh.md)

## Summary

Adds the log-only faberloom/space-read-grant session event and its Space read-grant projection, and records the optional credentialRef field on a routed request header.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-23-space-read-grant
baseline: false
changes:
  - root: "event:faberloom/space-read-grant"
    previous: null
    after: "074b10d8fbaaf80674868fb1612c6cfc44ada8ca799e05ea831953013dea1165"
    decision: same-version
  - root: "event:request/header"
    previous: "2026-09-11-initial"
    after: "2b590b4d278633beb9915998c872ae9733312d6d0b4885572ab63e8a10bfa80d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing session logs remain valid. The new event is additive and only the Space session composition folds it; a build without the declaration refuses a log that carries it, so desktop and web ship together. The optional request-header credentialRef was already emitted by agent-routed requests and stays optional: absence keeps the route's own credential reference.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/faberloom/session-agent/tests packages/faberloom/tool-faberloom/tests: 184 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
