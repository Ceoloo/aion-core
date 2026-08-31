# Phase 1 — Foundation Build

## Scope

Phase 1 builds **the smallest production-quality AION Core foundation capable of
proving the control-plane architecture**: the contracts and orchestration
primitives that later AION systems build upon. It succeeds when the control-plane
lifecycle works end-to-end against in-memory/mock implementations.

Target lifecycle, proven end-to-end:

```
Mission → Actor → Command → Policy → Risk → Approval decision →
Execution routing → Mock execution → Normalized result →
Events → Telemetry → Outcome reference
```

## What was implemented

- **Strongly-typed identifiers** with stable prefixes and branding, plus a
  central generator and a propagated trace context.
- **Contracts** (zod schemas → branded types): identifiers, risk, mission,
  actor (human/agent/service/system, agents as governed workers), capability,
  tool, command, event envelope, policy decision, approval request/decision,
  execution result, outcome reference, workflow, run + state machine, telemetry
  spine. Plus ergonomic factory constructors.
- **Policy layer**: deny-by-default `PermissionEvaluator`, central-classifying
  `RiskEvaluator`, and a composed `PolicyEngine` returning structured
  `ALLOW / DENY / REQUIRE_APPROVAL` decisions with an ordered check trail.
- **Human gate**: `ApprovalGate` + in-memory store; fails safe, forbids
  self-approval, resumes the original run.
- **Execution**: the `ExecutionAdapter` contract, a capability-based
  `ExecutionRegistry`, and a configurable `MockExecutionAdapter`.
- **Orchestrator**: the deterministic kernel that drives the whole lifecycle,
  including pause/resume across a gate.
- **Events + telemetry**: `EventEmitter`/`Telemetry` over in-memory sinks, with
  the full ID chain and causal links.
- **Ports + in-memory adapters** for run, mission, event, approval, and
  telemetry persistence.
- **Domain errors** with stable machine-readable codes.
- **Public API** (`src/index.ts`), an example, tests, docs, and CI.

## What was intentionally deferred (non-goals)

Per the build brief and aion-docs *Mission Before Infrastructure*, none of the
following were built: the Company OS, any customer product, sales/content/CRM/
portal workflows, autonomous department agents, production persistence
(Supabase/Postgres/Redis/Dynamo/Mongo/Pinecone), queues/brokers/Kafka, cloud
infra/Terraform/Kubernetes, model-provider or external-runtime integrations
(Claude Code, Codex, Cursor, Grok, Kimi/OpenClaw), deployment infrastructure,
learning engines, analytics dashboards, and speculative multi-agent
infrastructure.

Deferred to future phases inside Core's own boundary:

- **Real execution adapters** — Phase 1 ships only the mock. Real runtimes plug
  in through the unchanged `ExecutionAdapter` contract.
- **Durable port implementations** — supplied by future `aion-data`.
- **Multi-step workflow execution** — the `Workflow` contract exists; the
  orchestrator processes one command per run in Phase 1.
- **Context assembler and evaluator** — the control-plane components that pull
  context by reference and score success criteria are represented in the
  contracts (`contextReference`, `successCriteria`) but not implemented.
- **The learning loop / outcome realization** — only the `OutcomeReference`
  contract exists, so a future system can associate real outcomes with runs.
- **Evals** — Phase 1 contains no AI-driven behavior to evaluate (execution is
  mocked); the eval harness is future work.

## Recorded conflict — risk taxonomy

The Phase 1 build brief suggested a `LOW / MEDIUM / HIGH / CRITICAL` risk
taxonomy "if the docs allow implementation discretion." They do not:
[`governance/risk-levels.md`](https://github.com/Ceoloo/aion-docs/blob/main/governance/risk-levels.md)
already defines an authoritative **R0 / R1 / R2 / R3** (Trivial / Low / Moderate
/ High) model, and the brief instructs us to follow aion-docs on conflict.

**Resolution:** Core implements **R0–R3**. The fixed mapping *high-risk
categories → R3 → human gate* is honored; R2 is policy-dependent (gated per
capability or via `gateAllModerate`); R0/R1 proceed autonomously within policy.

## Known limitations

- **No durability.** All state is in-memory and lost on process exit — by
  design for Phase 1.
- **Single-command runs.** No multi-step workflow orchestration yet.
- **No timeouts on gates.** aion-docs describes gate timeouts failing safe;
  Phase 1 models approve/reject but not an automatic timeout. (Deferred.)
- **Cost is abstract.** `ExecutionCost.units` is a dimensionless placeholder
  until a real runtime/pricing mapping exists.
- **No concurrency control.** In-memory adapters assume single-process,
  non-concurrent access.

## Phase 1 exit criteria

Phase 1 is complete when Core demonstrates the full lifecycle with tests proving:

| Requirement | Where |
|---|---|
| `ALLOW` | `tests/policy/policy-engine.test.ts`, Scenario A |
| `DENY` | `tests/policy/policy-engine.test.ts`, Scenario C |
| `REQUIRE_APPROVAL` | `tests/policy/policy-engine.test.ts`, Scenario B |
| `EXECUTION_SUCCESS` | Scenario A |
| `EXECUTION_FAILURE` | Scenario D (returned, thrown, and unrouted) |
| `APPROVAL_RESUME` (same run) | Scenario B |
| `TRACE_CONTINUITY` | Trace-continuity integration test |

Quality gates (all green): `lint`, `typecheck`, `test`, `build`, and the example
runs. No secrets, no external network dependency in tests, no production
database, no provider SDK.

**Status: READY FOR PHASE 2.**
