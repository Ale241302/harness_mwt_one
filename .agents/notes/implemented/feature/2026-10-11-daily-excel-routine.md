# Agent Note: Daily Excel-from-email seeded routine

Status: implemented

English | [中文](2026-10-11-daily-excel-routine.zh.md)

## Problem

The shipped catalogue seeded four routines (Pedido a proforma, Respaldo diario, Seguimiento de correo, SAP a expediente). None of them keeps a working spreadsheet current: SAP a expediente extracts one purchase order's attachment and uploads it to a file, so a user who receives a recurring report by mail — the daily or weekly ledger, the operator's dispatch — had to update their tracking Excel by hand, outside the agent's reach.

## Decision

`faberloom-defaults` seeds a fifth routine, **"Excel diario desde el correo"**, into every new owner.

- **Trigger.** `recurrence` / `every:1d`, so the engine starts it once a day without a panel open, and the owner can also run it by hand.
- **Steps.** Four, in dependency order: `excel-correo` (the `agent` handler finds the agreed report mail and saves its Excel attachment into the Space folder), `excel-enlace` (the `email.extract-spreadsheet-link` handler pulls a spreadsheet link out of the body when the mail carries a link instead of a file), `excel-actualizar` (`agent`: update the Space's tracking Excel — keep the existing columns, add or replace by key, never duplicate a row), and `excel-verificar` (`agent`: confirm the updated file exists and holds the day's rows, or say what is missing).
- **Deployment.** `permissions: []` (the routine reads the owner's own mailbox and its own Space folder, so it needs no MWT.ONE scope) and `failurePolicy: 'review'`, so a mismatch stops at the Approvals queue instead of overwriting the spreadsheet silently.

The routine names no path and no agent: it runs as the Space's responsible agent, with the Space's folder as the working directory, so the file the model edits is the file the user opens.

## Alternatives considered

**A template spreadsheet shipped in the image.** Rejected: the tracking file's columns are the owner's, not the product's; a shipped `.xlsx` would be overwritten on the first run and would need a binary asset the repository does not otherwise carry. The routine's step instructions are the template.

**Extend "SAP a expediente".** Rejected: that routine is scoped to a purchase order and ends at a file upload to the console; merging the two would give one routine two unrelated outcomes and two permission sets.

**A new `xlsx` step handler that edits the workbook in the host.** Rejected for now: the `agent` handler already has the file tools (read, write, spreadsheet conversion) and the Space's folder as cwd, so a bespoke handler would duplicate them. A deterministic handler is the right answer if a consumer needs byte-exact output without a model in the loop; that is deferred.

**Seed it disabled.** Rejected: the dispatcher schedules `draft` routines only after the owner activates them, so seeding it as a draft already withholds any automatic run until the owner opts in.

## Consequences

A new owner receives a daily routine that keeps one spreadsheet current from a mailbox report, and can run it from the Routines panel, schedule it, or delete it. Because it is seeded as a draft, it never runs until the owner activates it. The routine depends on the Space's folder being the working directory and on the mail connection the owner configured in Connections; when either is missing the run stops at review with the reason. Existing owners do not receive it: the seeder runs once per owner and only recreates shared agents, not plan routines.

## Testing

`packages/faberloom/defaults/tests/defaults.spec.ts` seeds every catalogue routine and asserts the created names, the routine count, and the one-time marker, so the new entry is exercised by the existing suite. The step handlers it names are each covered by their own package (`faberloom-handlers`, and the `agent` handler through the routine engine tests).
