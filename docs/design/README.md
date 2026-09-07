# AION Core — Design Specs

Forward-looking design for capabilities that are **contracted but not yet
built**. Each spec here turns an accepted architectural decision
([aion-docs/adr](https://github.com/Ceoloo/aion-docs/tree/main/adr)) into a
concrete Core contract/port design, ready to implement when a mission requires
it — without committing code ahead of that mission
([Mission Before Infrastructure](https://github.com/Ceoloo/aion-docs/blob/main/engineering/principles.md)).

These are **not** `docs/architecture.md` (which describes what Phase 1 *did*
build) and **not** aion-docs (which owns the *why*). They are the engineering
bridge: "here is exactly how Core would express this decision in contracts and
ports, staying kernel-only and vendor-agnostic."

| Spec | Drives | Priority | Status |
|---|---|---|---|
| [execution-gateway.md](execution-gateway.md) | [ADR-003](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-003-execution-gateway-and-evidence.md) — idempotency, replay safety, execution receipts | P0 | Design |
| [programmatic-execution-and-a2a.md](programmatic-execution-and-a2a.md) | Runtime-control brief signals 2 & 5 — CodeAct/PTC plans; A2A mapping | P1 / P2 | Design |
| [crm-tool-ghl.md](crm-tool-ghl.md) | GoHighLevel as a governed, side-effecting CRM tool (gateway + risk + idempotency) | per-mission | Design |

## Ground rules for every spec here

- **Kernel, not application.** New capability is expressed as contracts +
  ports + orchestrator logic. No database, broker, or vendor SDK enters `src/`.
- **Vendor-agnostic.** Core never learns which AI vendor sits behind an adapter,
  which store backs a port, or which protocol a peer speaks.
- **Deterministic control plane.** Enforcement (dedup, hashing, tier selection)
  is deterministic; non-determinism stays behind the execution adapter boundary.
- **aion-docs wins on conflict.** Where a build prompt and aion-docs disagree,
  aion-docs is authoritative; the conflict is recorded (as with R0–R3 in
  [docs/phase-1.md](../phase-1.md)).
