# Agent Note: A panel record opens in a dialog over a full-width table

Status: implemented

English | [中文](2026-10-14-panel-record-dialogs.zh.md)

## Problem

Four FaberLoom panels put their editor in a right-hand inspector inside a two-column grid: Skills, Mesa de trabajo, Conexiones, and Contexto. The grid gave the inspector `clamp(380px, 38vw, 880px)` and the table what was left, so on a wide screen the list was the narrow half and the fields wrapped. Memoria, the fifth record-at-a-time panel, had already answered this: its table spans the width and a row click opens a dialog.

Three smaller defects rode along in the same screens. The Skills install control (pick a folder, choose a destination, install) sat at the top of the panel in every deployment, including a browser, where the folder it picks belongs to the host rather than to the operator. `+ Nueva conexión` only cleared the selection, so a new connection opened on the values of the last record the editor had held. And the two file-input labels, `Subir .md` and `Importar`, painted taller than the buttons beside them.

## Decision

**A record is edited in a dialog over the full-width table.** The four panels drop the grid and the inspector: the table is a direct child of the screen, a row click opens that record in the `Modal` primitive the package's other eleven dialogs already use, and the create actions (`Nueva tarea`, `+ Nueva conexión`) open the same dialog on a new record. Escape, the mask, the header close control, and the footer's `Cerrar` dismiss it, because that is the primitive's own behavior. The dialogs pass `panelDialog` (`min-width: min(620px, 94vw)`) because these editors carry two-column field rows and the primitive's default card is 380px wide. The `Inspector` component and the `split` grid stay: six other panels still use them.

**A new connection opens on an empty form.** `startNewConnection` resets every field to its protocol default (IMAP, port 993, TLS on) before opening the editor, so a new record never inherits the last one's values.

**The install control appears only in the Desktop application.** `isDesktopApplication()` reads the `{ protocolVersion: 1 }` marker the Desktop preload injects into application documents; a browser has no such global. The marker is the honest signal for this control: picking a folder is only meaningful where the folder is the operator's own, which is the local Host. It also means gateway mode hides the control, which is right, because there the Host runs in the deployment and the picker lists the container.

**The file-input labels match their neighbours.** `.fileAction` gives the label `box-sizing: border-box` and centers its single line. The cause was the box model, not padding: the user-agent gives a `button` border-box and leaves a `label` content-box, and a toolbar is a flex container, so its children are blockified and the shared `min-height: 44px` landed on the label's content box.

## Alternatives considered

**Keeping the inspector and only widening its column.** The measurement that motivated the change is that the editor, not the list, was holding the width. Widening the same track keeps the list narrow and leaves the two-pane idea in place.

**A detail route per record instead of a dialog.** These panels are already addressed by a `MainPanelId` and rendered by one slot key; a second axis of navigation would need a route vocabulary, a back gesture, and its own empty state, for a surface the user reaches by clicking a row and leaves with Escape.

**Converting the file picker into a button that clicks a hidden input.** It would align the control by construction, but it needs a ref and a click handler at both call sites, while the label already wraps the input so the browser opens the picker on any click. One CSS rule shared by both sites is the smaller change and does not touch behavior.

**Deciding Desktop-versus-browser from a build flag.** The Desktop application loads the same built bundle as the browser, so a build-time value cannot tell them apart; only the preload differs.

**Marking the table's two removed columns as hidden rather than deleting them.** The detail dialog keeps both facts (`field.origin`, `field.usedBy`) with room to render them, so the list owes the user nothing here. Keeping the columns as dead entries would leave two locale keys and two column definitions with no reader.

**Giving Skills, Conexiones, and Contexto a create form in their dialog too.** Contexto already creates from the header, and the Skills upload control is a header action in the design's toolbar. Moving them would add a dialog for something the screen already does in one gesture.

## Consequences

The list gets the full width on all four panels, and the record's fields get a card sized for them. Both facts the Skills table gave up (origin, used-by) now appear only in the detail dialog, and their two locale keys are gone from all three dictionaries.

The cost is that a row click no longer leaves a persistent panel behind: reading one record then another takes two clicks and a dismissal, where the inspector used to be replaced in place. Every panel's footer keeps the destructive action apart from its primary: Conexiones and Contexto place `Eliminar` first and `Guardar` last, and the modal's own close control is repeated as a `Cerrar` button, which is what Memoria's dialog already did.

## Testing

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` gained five cases: the two-column skills table with no grid beside it, a skill opening in a dialog with the origin and used-by fields, the install block absent in a browser and present once the marker is set, the connection editor opening empty from the button and loaded from a row and saving that record, and a task and a context entry each opening in a dialog. The bench grew the mocks those panels need (`contextEntries` and its siblings, `modelCatalog`, `mcpTokens`, `grants`, `backups`, `shares`, the skill actions) because no earlier case rendered them.

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` and the package's other ten spec files pass (106 cases), `tsc -b packages/client/ui-faberloom` is clean, oxlint is clean, and `verify-client-ui-i18n` is clean.

The height fix was measured in a real browser rather than reasoned about: a probe page carrying the toolbar's own rules measured the label at 64px before and 44px after, with the same top and bottom as the two buttons beside it. No assembled-browser (Playwright) scenario covers these panels, so that probe, not a product click-through, is the browser evidence for the layout; the dialog behavior is pinned by the jsdom specs above.
