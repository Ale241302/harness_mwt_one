# Agent Note: The Desktop launches the local harness, and its sign-in mirrors the web

Status: implemented

English | [中文](2026-10-15-desktop-launch-backend-and-sign-in-card.zh.md)

## Problem

The Desktop offered the operator a backend chooser: a group on the sign-in screen and a **Backend** group in the application menu, over a `desktop-backend.json` record, so one installation could run either the local harness or the shared gateway; that decision is archived as `2026-10-14-desktop-backend-choice`. Two failures followed.

The chooser asked the operator to answer an implementation question the product had already answered, and it left the application without one identity: the same build was either the editor of this computer's folders or a client of a server, with two disjoint datasets and no way to read one from the other. Signing in with the same console account in local mode showed an empty Agents panel, because the local harness seeds its own Agents and reads its own Harness home while the web's rows stay on the server.

The sign-in screen had also drifted from the page it signs into. Its copy repeated the same paragraph twice, it carried a backend group the deployed page does not have, and it lacked the password reveal and the recovery link of the deployed `login` page.

## Decision

**The Desktop launches the local harness; only the launching environment can point an installation at a gateway.** `apps/desktop/src/launch-backend.ts` resolves `DSH_DESKTOP_GATEWAY_URL`, where an origin names a gateway and both a blank value and an unset one mean the local harness. `apps/desktop/src/gateway.ts` keeps the environment name and the shipped `DEFAULT_GATEWAY_URL`. No record in the Harness home stores a backend, so nothing the operator does inside the application changes which one runs, and a deployment that needs the gateway still gets it from its launcher.

**The sign-in screen is the deployed page's card.** One raised card on the ground: the two-tone wordmark, the console hint, one label per field, the credential fields with a reveal control, the accent submit button, and the recovery link, with the shell's language group and appearance toggle pinned as before. The paragraph the signed-out screen rendered twice is gone, so the card's hint is the screen's only copy.

**Recovery stays in the application.** The link opens a dialog that posts the typed address to `{CONSOLA_API_BASE}/users/forgot-password/`, the console call the deployed page already makes, and reports the console's neutral answer in place. A transport failure reaches the operator as one locale-owned message rather than the console's own error text.

**The shared surface opens in the browser.** The application menu's new item opens the deployment in the default browser, where the web's Spaces, sessions, and product modules live. The window never switches to that surface: a switch stops the running backend and rebuilds the window, and the local harness would still be the installation that owns this computer's folders.

## Alternatives considered

**Keeping the chooser with the local harness as its only default.** The operator would still answer a question whose consequence the screen cannot state, and the menu would keep offering a state in which this computer's own folders are unreachable.

**Making gateway mode the only backend.** The window is then the web client, so every product module shows the web's rows with no transport to build. It gives up what the local harness exists for: Workspaces that are folders of this computer. The operator asked for the local application, so the local application stays.

**Mirroring the web's product rows into the local harness in this change.** This is the answer to the empty-panel complaint and it is a separate build: a transport between the two hosts, a merge rule per resource, and the skills and session files that no row store covers. Landing it inside this change would have left the sign-in surface half-migrated for however long the transport takes, so it is deferred to its own Agent Note.

**Rendering the sign-in screen exactly as the page does, without the shell's own controls.** The deployed page has no language group and no appearance toggle, but the shell owns both for its own screens and has to keep them reachable before the Host starts.

**Leaving recovery as a link to the deployed page.** It sends an operator out of the application for a field the shell can post itself against the same console base it signs in with, and it would need the deployment reachable as a web origin even when the installation runs local.

## Consequences

The application has one identity. It reads the folders of the computer it runs on, and the web's shared surface is one menu item away in a browser. `desktop-backend.json` is neither read nor written any more, so an installation that recorded `gateway` launches the local harness until its environment says otherwise.

The sign-in card now duplicates the deployed page's design, so a change to that page is a change in two places; the shell keeps the two controls the page does not have. Recovery needs the console reachable, which signing in already needs.

The primary button still paints `#F4F1ED` on the brand accent `#C96442`, which measures 3.46:1 and misses the 4.5:1 bar for text at its size. That pairing is shared by the gateway's login page and `packages/client/ui-theme`, so it needs one change across those surfaces; this change preserves the pairing rather than adding a third variant of it.

## Testing

`apps/desktop/tests/startup-renderer.spec.ts` covers the card and its single copy line, the password reveal, the recovery dialog's missing address, its sent and refused outcomes, the language switch, and the unchanged loading and recovery screens. `apps/desktop/tests/main-startup.spec.ts` covers the local launch and the environment-named gateway loaded into `persist:gateway`. `apps/desktop/tests/preload-app.spec.ts` covers the recovery channel. oxlint, `verify-client-ui-i18n`, the desktop TypeScript face, and `verify-archived-agent-notes` pass.
