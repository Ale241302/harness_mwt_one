# Agent Note: remove the internal-testing welcome notice

Status: implemented

English | [中文](2026-09-27-remove-internal-testing-notice.zh.md)

## Problem

`ui-settings-models` registered a first-run "Internal Testing Notice" dialog as the first `settings.onboarding` step. It carried DeepSeek's own copy and blocked the app (the root went `inert`) until the user pressed Continue, and it returned whenever the shipped version changed. For the MWT.ONE product the notice is not the product's voice and is unwanted on every new session.

## Decision

Remove the welcome notice entirely rather than leave it dormant.

- Delete `WelcomeNotice.tsx`, `WelcomeNotice.module.css`, `welcome-store.ts`, and `onboarding-copy.ts`, and drop the `welcome-notice` slot registration and its controller from `ui-settings-models`.
- Delete the component and store unit specs, the `welcome-store` coverage entry in `vitest.config.ts`, the welcome locale keys, and the dedicated `remote-welcome` web e2e.
- Strip the welcome steps from the shared onboarding e2e, the scaffold's welcome mirrors and `welcomeNoticePending` option, and the fixture inventory, and regenerate the client slot catalog (`scripts/gen-client-catalog.ts`) so its occupant list drops the notice.
- The `ui-settings-general` Host half keeps registering the generic `ui-onboarding` settings namespace; only the welcome step that used it is gone.

## Alternatives considered

**Leave the component registered but render nothing.** It keeps dead code and its own specs, and any future version bump would resurrect it; removing the feature removes the ambiguity.

**Neutralize the acknowledgement version.** Hiding the ack makes the notice reappear on the next bump and keeps the DeepSeek copy in the bundle.

## Consequences

- No first-run modal on load; the app is interactive immediately. The DeepSeek credential onboarding step is unchanged.
- The `ui-onboarding` settings namespace remains available but unused by the shipped client.

## Testing

`packages/client/ui-settings-models/tests` and `packages/client/ui-settings-general/tests` pass (273 tests) with the onboarding roster now a single `deepseek-official` step; the web e2e onboarding scenario no longer asserts the welcome dialog, and the regenerated `slot-catalog.ts` lists only `deepseek-official`.
