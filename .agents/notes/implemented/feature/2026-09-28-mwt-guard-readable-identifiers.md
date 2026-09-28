# Agent Note: the MWT.ONE guard files readable identifiers

Status: implemented

English | [中文](2026-09-28-mwt-guard-readable-identifiers.zh.md)

## Problem

The built-in MWT.ONE guard routine files the expediente follow-ups as Work bench tasks. Its prompt only asked for "evidence with the real data", so the agent dumped raw tool output: `uuid:5e9a…`, `OC_ROTA:id=cb62…`, `documento:c8c6… (… expediente_id=2858…)`. A UUID says nothing to the person reviewing the task, and the useful codes it already had (`codigo='PO UMMIE-2026-01'`, the expediente `2429-2026`) were buried. The Work bench also clipped the prepared result: its one-line `.cellMuted` cell cut a long summary at ~280px with an ellipsis.

## Decision

- The guard routine's instruction now fixes the identifier vocabulary: identify each expediente by its **PF** (`proforma_codigos`); when it has no PF use `oc_codigos` or `sap_codigos`; when it is a fusion use `fusion_label`. It forbids UUIDs (`id`, `uuid`, `expediente_id`, `documento id`) in the title and the evidence, and asks for readable references (`expediente:<PF>`, `documento:<codigo> (kind=OC)`, `oc:<codigo>`, `sap:<numero>`) and a complete summary.
- `ensureBuiltinRoutines` now converges a stored built-in routine's definition to the shipped one, so an owner provisioned by an earlier deployment receives the improved prompt on the next start instead of keeping the old text forever. The definition is deployment-owned, matching the seeding rule that the baseline belongs to the deployment.
- The Work bench renders the prepared result with a wrapping class (`.summary`, `pre-wrap` + `overflow-wrap: anywhere`) rather than the truncating `.cellMuted` that table cells use.

## Alternatives considered

**Post-process the evidence in the view.** The identifiers are model output, not a format the code can reliably rewrite; the prompt is where the vocabulary belongs, and the tool schema stays a plain string list.

**Bump the routine name so provisioning re-creates it.** A name is the provisioning key and a stable contract; renaming would duplicate or orphan the routine and lose its history. Converging the definition keeps one routine.

## Consequences

- Tasks the guard files from now on carry the PF (or OC/SAP) in the title and evidence; a fusion shows its label.
- Tasks filed before this change keep their raw evidence until the guard re-files them; the routine runs every six hours.
- Any built-in routine a later deployment rewrites reaches every owner on the next start.

## Testing

`packages/faberloom/routines/tests`, `defaults`, `view`, and `ui-faberloom` pass (83 tests). The view suite's routine mock gained `updateRoutine`, which the convergence now calls when the stored definition differs.
