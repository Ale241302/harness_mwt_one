# Agent Note: Desktop backend selection persists in the Harness home

Status: implemented
Archived: 2026-10-15

English | [中文](2026-10-14-desktop-backend-choice.zh.md)

## Problem

The Desktop decided its backend from one process environment variable, `DSH_DESKTOP_GATEWAY_URL`, and defaulted to the shared gateway at `harness.mwt.one`. A packaged installation therefore inherited whatever the process that launched it happened to carry, and the shipped default made the application a client of a server: the Host that answers runs in the deployment, so its Workspaces are folders of the server, and the sender's own disk is unreachable. The operational requirement is the opposite. The application runs on the operator's computer, and its Workspaces are folders of that computer.

## Decision

**The Desktop launches one of two backends and remembers which one, in a record the operator owns.** `apps/desktop/src/backend-choice.ts` reads and writes `desktop-backend.json` in the shared Harness home: one non-secret JSON record, `{"mode":"local"}` or `{"mode":"gateway"}`, written atomically through a temporary sibling exactly as `desktop-appearance.json` and `desktop-locale.json` are. `resolveBackend(dshHome, environment)` is the single resolution step. The launching environment outranks the file, the file outranks the shipped default, and the shipped default is now the local harness.

**Three environment states, not two.** `apps/desktop/src/gateway.ts` keeps the environment name, the shipped gateway origin, and `resolveGatewayRequest`, which separates the requests a single string could not: `kind: 'none'` when the variable is unset and the stored choice decides, `kind: 'local'` when it is blank, and `kind: 'override'` with the origin when it carries a URL. `DEFAULT_GATEWAY_URL` stays the only home for the shipped gateway, so a record that says `gateway` follows the deployment rather than pinning a URL that was current when the operator clicked.

**The environment, when it speaks, owns the backend.** An installation launched with the variable set reports `{ mode, fixed: true }` over `dsh-desktop:backend-selection-get`. The sign-in screen hides its backend group and shows which condition fixed it, and the application menu disables both backend items. `dsh-desktop:backend-selection-set` refuses the switch in that state and validates the requested mode against the shipped pair, so a renderer cannot write a choice the environment would ignore.

**A switch rebuilds the application window.** A `BrowserWindow` fixes its session partition when it is created, so `switchBackend` stops the running backend, records the choice, destroys the window, and creates a new one, which is the replacement path a closed window already used. Gateway mode loads the remote origin in `persist:gateway` and the window carries the signed-in user's Spaces, sessions, and product modules; local mode loads the shell's own pages in the default partition. The operator reaches the switch from the sign-in screen's backend group, which is where a fresh installation meets it, and from the application menu's **Backend** group, which is the only surface that exists in gateway mode because that window belongs to the remote origin. The menu names the target backend and asks for confirmation, because the two backends show different data.

## Alternatives considered

**Keeping the environment variable as the only selector.** The variable is invisible to the operator, cannot be changed from the application, and needs a launcher change for every deployment that repoints a gateway. It stays, because a deployment or a development run has a legitimate reason to hold the backend still, and it is now the highest-priority request instead of the only one.

**Letting the stored choice outrank the environment.** A development run that sets the variable would silently lose to a record written months earlier, which is the failure a stored preference is supposed to prevent. Explicit process setup also arrives at launch time, so it cannot be stale in the way a file can.

**Reloading the window instead of rebuilding it.** `webPreferences.partition` cannot change after creation, and reusing a partitioned window for the local harness would carry the gateway's cookies into the shell's own pages. Rebuilding the window is the same operation `focusPrimaryWindow` already performs when the window is gone.

**Asking the operator to relaunch the application after a switch.** A relaunch discards honest in-flight work to change a preference, and the application already stops the backend without ending the process, so the switch is one step less than the operator would need.

**Storing the gateway origin in the record.** A record that pinned `https://harness.mwt.one/` would keep sending an installation to an origin the fork may have moved away from. The operator chose a backend, not a URL, so the URL stays deployment data.

**A per-installation record outside the shared Harness home.** Appearance and language already live there, and the same single-instance rule guards the directory. A second location would give the operator two places where a desktop preference can be.

## Consequences

A fresh installation boots the local harness and reaches the operator's own folders, and an operator who wants the shared surface picks the gateway once and keeps it. The two backends keep separate data, which the sign-in note states and the menu confirmation repeats, so a Workspace that exists on one backend does not appear on the other. Gateway mode keeps the property that a front or back change ships by deploying the server, and local mode takes its front from the packaged runtime, which is the release rule that `apps/desktop/README.md` states.

The cost is one more desktop preference file and one more menu group, plus a window rebuild on every switch: the application returns to the sign-in screen or the gateway's own sign-in, and any open session view is discarded. A deployment that sets the variable takes the switch away from its operators entirely.

The Desktop's own screens still carry one confirmed contrast failure that this change does not touch: the primary button paints `#F4F1ED` on the brand accent `#C96442`, which measures 3.46:1 and misses the 4.5:1 bar for text at its size. The same pairing appears in the gateway's login page and in `packages/client/ui-theme`, so it needs one change across those surfaces rather than a fix in the shell alone.

## Testing

`apps/desktop/tests/backend-choice.spec.ts` covers the record round trip, an unwritten home, a damaged record, an unknown mode, the local default, a stored gateway, and the environment outranking the file. `apps/desktop/tests/gateway.spec.ts` covers the three environment requests. `apps/desktop/tests/main-startup.spec.ts` drives the shell with a temporary Harness home and covers the local default, a stored gateway origin loaded into `persist:gateway`, the fixed report and its refused switch, the rejected unknown mode, a recorded switch to the gateway with the window rebuilt, and the return to local mode. `apps/desktop/tests/startup-renderer.spec.ts` covers the two buttons, the marked choice, the request sent on a click, the Spanish labels, and the hidden group with its explanation.
