# Agent Note: Start a conversation from the Hero without a Workspace

Status: implemented

English | [中文](2026-10-14-workspace-less-hero-session.zh.md)

## Problem

Reaching the composer required a Workspace. With none picked, the Hero held the composer inert on its "Choose a workspace to start" placeholder, and with no Workspace registered the picker skipped its menu and jumped straight into the directory flow, because adding one was then the only target it had. A user who only wanted to chat had to adopt a folder first.

The block was client-only. The Host already accepted `session.create` naming neither a Workspace nor a cwd, resolving the working directory from its own default, and the Session list already renders Sessions that no Workspace accounts for in its trailing Ungrouped bucket. On the client, `ConversationContent` derived `inert` from `sessionId === undefined || (hero && chipTitle === undefined)`, and every `chipTitle === undefined` case was a Session that no Workspace owned, so the picker trigger was shown for a Session that already existed.

## Decision

**The Hero picker leads with a target that names no Workspace.** The menu is the one place the user says which target a new Session takes, so the entry lives there: `WorkspacePickFlow` renders it first when its owner supplies the action, and ui-conversation's `conversation.hero.workspace` owner share (`EmptyWorkspaceOwnerProps.onOpenUnassignedSession`) is where that action arrives. Its copy is ui-workspace's own (`menu.startWithoutWorkspace`). The entry renders only while the owner supplies the action, so the sidebar's add-only surface and the flow's empty-popover guard keep their exact behavior.

**One new navigation arm, one create call.** `UiWorkspace.openUnassignedSession(beforeOpen?)` calls `sessions.create()` with no arguments, so the Host resolves its default directory and attaches no Workspace, then opens the returned Session unless a later navigation has superseded the request. It runs the same synchronous preparation callback as `openWorkspace`, and ui-conversation's `main.conversation` inject reuses its draft-carry closure for both arms, so a pick never drops what the user already typed.

**An existing Session is chattable.** The composer's inert gate becomes `sessionId === undefined`: the pick is what materializes a Session, and once one exists the composer is live whether or not a Workspace accounts for it. The chip falls back to a no-Workspace label (`hero.noWorkspace`) instead of its placeholder, so the state is named rather than left as an unfulfilled "Choose workspace" prompt. This also changes the Session whose Workspace left the sidebar: it is an ordinary Ungrouped Session, and the delete copy already tells the user its Sessions appear under Ungrouped. The parity model, blank reuse, and the provisioning channel are unchanged; this refines the [Web client scope note](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md), whose reachable-entry claim this change widens.

**Nothing new persists.** There is no new Session kind, event, or marker: a Workspace-less Session is an ordinary Session whose recorded cwd is the Host default. The list grouping, archiving, and deletion paths already handle it, and nothing on the client can attach it to a Workspace later, because workspace membership has one writer on the Host.

## Alternatives considered

**A second action in the composer.** The composer already owns the inert Workspace trigger, so a parallel "start without one" control was possible. Rejected: the picker is already the which-target menu, it is already reachable from both the chip and the inert composer, and a second surface would have to repeat the busy and supersession rules.

**Widening `onPick` to `WorkspaceId | undefined`.** Rejected: the same flow serves the sidebar's add-only surface, which can never produce that target, so one shared callback would force an impossible case into the browser's contract. A separate optional callback keeps each surface's contract exact.

**Keeping the direct jump into the directory flow when nothing is listed.** Rejected: the no-Workspace target is exactly what the empty list makes valuable, and the jump only made sense while the add action was the menu's only entry.

**Reusing an existing blank Workspace-less Session the way `connectWorkspace` reuses a Workspace member.** Not taken: the requirement is to create, and a repeated pick leaves a second blank whose list visibility is already governed (only the current blank shows) and whose archive and delete paths are the ordinary ones.

**Marking Workspace-less Sessions so the chip can tell them from Sessions whose Workspace was deleted.** Rejected: the distinction is presentational only, and both are Ungrouped Sessions that now read the same way.

## Consequences

The Hero can start a conversation with nothing registered: the picker offers the no-Workspace target, selecting it opens a blank Session at the Host default directory, and the composer is immediately live while the chip reads its no-Workspace state. The pick/adopt flow is untouched: Workspace picks, native and browse folder adoption, the add-only vendor surface, the folder-error dialog, and the in-flight adoption gate all behave as before, and the add-only sidebar surface still opens the directory flow from its single entry.

The assembled Web lane carries the cost: the picker popover now has two rows in an empty world, so the shared `connectFreshWorkspace` helper picks the add action from the menu instead of receiving the dialog directly. Every scenario that types into the composer connects through that helper, so the change lands in one place.

## Testing

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` covers the Hero picker action reaching the injected callback and closing the popover, a failed start keeping the pre-pick state and warning, a Workspace-less Session staying chattable with its chip label, and a feature block still reaching that live composer. `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` covers the injected action opening the Workspace-less Session and carrying the draft onto it. `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` covers the create with no arguments, the preparation-then-open order, supersession, and navigation-owner disposal. `packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx` covers the leading entry, the menu with nothing listed, the empty directory-flow hole, and the in-flight adoption gate over the new entry. `apps/web/tests/startup-auto-selection.e2e.ts` boots the assembled Web composition and asserts the no-Workspace entry leads the menu the inert Hero composer opens.
