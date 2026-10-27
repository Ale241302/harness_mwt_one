# Agent Note: A Marluvas operator runs the mailbox end to end

Status: implemented

English | [中文](2026-10-26-marluvas-live-operator.zh.md)

## Problem

The live mail routine classified an incoming message, left a reply draft, and
attached a document when the message carried an OC, PO, or SAP. That is enough
for a generic inbox, but not for the Marluvas operation: a single thread can
carry a proforma, an OC, a SAP, a packing list, a commercial invoice, a DUA, a
BL/AWB, and a change of state. The operator has to resolve the client, the
operator company, the products, the sizes, the two prices, the payment terms,
the commission, the dates, the artifacts, the reception, the movement, and the
finance record. A generic triage prompt leaves the model to improvise that
sequence, and it cannot load the ten operational skills the sequence needs.

## Decision

**A dedicated catalog agent carries the operation.** `Operador Marluvas` is a
seeded, role-gated agent (`admin`, `superadmin`, `ceo`) with ten `marluvas-*`
skills: master operation, mail reading, expediente, proforma, SAP, states,
artifacts, customs, logistics, and quality/finance/close. The skills encode the
MCP tool names, the guards, and the order of work; the agent supplies the
persona, model, and skill list.

**The live mail routine converges in place for the operations mailboxes.** When
the owner's saved IMAP username is `alvaro@muitowork.com` or
`506@muitowork.com`, is privileged, and the agent exists, the built-in
`Vigía de correo` definition is updated to the Marluvas three-step flow and
every agent step is bound to the catalog agent through `config.agentId`. The
routine keeps its name, so the owner does not get a second trigger on the same
mailbox. A non-privileged role, a different mailbox, or a missing agent keeps
the generic definition.

**Convergence compares the owned fields, not the stored shape.** The store
materializes every optional step field (`config: {}`, `waitFor: null`,
`maxAttempts: 1`), while the authored input omits them, so a raw JSON
comparison never matches and turns every poll into a new routine version. The
shared `routineDefinitionsMatch` projects the authored and stored definitions
before comparing them.

**The seeder learns one new trick: catalogue upgrades.** The marker still
records every seeded name, so a deleted agent is not resurrected. A marker that
predates a new catalogue entry now creates only the names it does not record;
a hand-created agent with the same name is left untouched and recorded. This
lets an existing installation receive `Operador Marluvas` without a fresh home.

**The model never invents the business facts.** The skills require the identity
check, a full-thread read, attachment and link downloads, source citations, and
a board task when the evidence is incomplete. They also state the pricing rule
for MWT-operated versus direct orders and the exact proforma behavior: one
`proforma_generar` call creates the three HTML documents (client, MWT, factory)
for an MWT-operated expediente.

**The mailboxes are a deployment choice, not a hardcoded credential.** The
agent uses the mounted `mwt` MCP; the web gateway mounts it per user and the
desktop self-provisions the device token at sign-in. The skills never carry a
token, password, or OAuth secret.

## Alternatives considered

**A separate routine named `Operación Marluvas`.** It would trigger on the same
incoming message as `Vigía de correo`, so every mail would run two agents and
the owner would have to remember which one owns the mailbox. Converging the
existing built-in keeps one trigger and one visible routine.

**A single long prompt in the routine.** It would duplicate the ten skills in a
place the panel does not edit, cannot be loaded conditionally, and grows past a
readable step. The skill pack keeps each rule next to the tools it governs.

**Seeding the agent for every role.** A non-privileged role cannot call the
create/update tools the operation needs, and the agent would appear in catalogs
where it cannot act. The role gate keeps the catalog honest.

**Hardcoding the MWT.ONE OAuth client or the mailbox password.** The desktop
already obtains a device token from the console, and the web gateway already
mounts the MCP with the signed-in identity. A checked-in credential would be a
leak and would bind every installation to one user.

## Consequences

A privileged owner of either operations mailbox gets a working, autonomous
Marluvas operator after the next start: the agent is in the catalog, the live
routine is active, and the three-step flow reads the thread, operates the
expediente, and verifies the result. A non-privileged owner keeps the generic
live mail routine.

The change adds ten skill directories to each privileged role (the content is
the same, the directory is how the role catalog mounts it), one catalog entry,
and one upgrade path in the defaults seeder. The live routine's name stays
`Vigía de correo`; its intent and steps change for the eligible owners, which is
the deployment-owned convergence the built-in contract already allows.

The seeder's marker upgrade is deliberately narrow: it adds names, never
removes them, and never touches a hand-created agent. A future catalogue entry
that should not reach existing owners needs its own gate, not an empty marker.

## Testing

`packages/faberloom/defaults/tests/defaults.spec.ts` covers the role gate, the
ten skills, the marker upgrade, and no resurrection after deletion.
`packages/faberloom/view/tests/email-actions.spec.ts` covers the allowlisted
mailbox, the non-allowlisted mailbox, and the non-privileged role.
`packages/faberloom/inbound/tests/inbound.spec.ts` covers the poller's
provisioning with the operator agent present.
`packages/faberloom/routines/tests/equality.spec.ts` pins the authored/stored
comparison and the changed agent binding.
`scripts/verify-skills-catalog.ts` checks the frontmatter and the routing
trigger of every skill directory.
