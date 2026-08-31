# aion-core

**The AION control-plane kernel.** `aion-core` is the Company OS and control
plane for the AION ecosystem: it *decides and coordinates* work — it does not
perform every business function itself. It is a small, explicit, testable,
vendor- and database-agnostic kernel that future AION systems build upon.

> Architecture and governance are authoritative in **[aion-docs](https://github.com/Ceoloo/aion-docs)**.
> This repository implements the contracts defined there. On any conflict,
> aion-docs wins.

This is the **Phase 1** foundation build (see
[`roadmap/build-order.md`](https://github.com/Ceoloo/aion-docs/blob/main/roadmap/build-order.md)
in aion-docs). It proves the control-plane architecture end-to-end against
in-memory/mock implementations — no database, no broker, no provider SDK, no
network required.

---

## What AION Core owns

For a unit of requested work, Core decides:

- **what** work is being requested (the Command / intent);
- **who or what** is requesting it (the Actor — human, agent, service, system);
- **what capability** is required;
- **whether** the action is permitted (policy + permissions);
- **what risk level** applies (R0–R3);
- **whether human approval** is required (the human gate);
- **which execution adapter** should perform the work (capability-based routing);
- **how the run is identified and traced** (the ID chain);
- **how execution results are normalized** (the Result contract);
- **what events and telemetry** are emitted (facts + the observability spine).

## What AION Core does **not** own

No database, product UI, infrastructure, CRM, or department-specific workflow.
Core coordinates systems; it is not the doer and not the store. Concretely, this
repo contains **no** dependency on Supabase, Postgres, Redis, Dynamo, Mongo,
Pinecone, Kafka, or any provider/model SDK. Persistence is expressed as **ports**
and supplied externally (future `aion-data`); runtimes are expressed as
**execution adapters** and supplied externally.

---

## Architecture

```
MISSION / REQUEST
      ↓
COMMAND            ← intent, with an identifiable actor
      ↓
CONTEXT / VALIDATION
      ↓
POLICY + PERMISSION CHECK   → DENY ─────────────► run denied (adapter never called)
      ↓
RISK EVALUATION (R0–R3)
      ↓
APPROVAL GATE      → REQUIRE_APPROVAL ─► run awaiting_approval ─► human decision
      ↓                                                              ├─ approve → resume SAME run
EXECUTION ROUTING  ← capability-based                                └─ reject  → run denied
      ↓
EXECUTION ADAPTER  ← interchangeable runtime (mock in Phase 1)
      ↓
RESULT             ← normalized, vendor-neutral
      ↓
EVENTS + TELEMETRY ← past-tense facts + observability spine
      ↓
OUTCOME REFERENCE  ← a result is not an outcome
```

Layers:

- **contracts/** — the owned, stable shapes (identifiers, risk, mission, actor,
  capability, tool, command, event, policy, approval, result, outcome, workflow,
  run, telemetry).
- **policy/** — deterministic permission evaluation, central risk classification,
  and the composed policy engine (ALLOW / DENY / REQUIRE_APPROVAL).
- **approvals/** — the human-gate abstraction and an in-memory store.
- **execution/** — the common execution contract, a capability-based registry,
  and a mock adapter.
- **events/** + **observability/** — event emission and the telemetry spine.
- **orchestration/** — the run lifecycle state machine and the orchestrator
  kernel that ties it all together.
- **ports/** — the persistence/observability seams Core depends on instead of
  concrete infrastructure.
- **adapters/** — in-memory implementations of those ports for Phase 1.

See [`docs/architecture.md`](docs/architecture.md) for the implementation
architecture and [`docs/phase-1.md`](docs/phase-1.md) for scope, deferrals, and
exit criteria.

---

## Install

```bash
npm install
```

Requires Node.js ≥ 20. Runtime dependencies: **zod** only.

## Run the tests

```bash
npm test          # unit + integration (vitest)
npm run typecheck # strict tsc, no emit
npm run lint      # eslint
npm run build     # emit dist/
npm run check     # lint + typecheck + test + build
```

## Run the example

```bash
npm run example
```

This runs [`examples/simple-mission.ts`](examples/simple-mission.ts): a governed
`ResearchAgent` performs a low-risk `research.summary` command through the mock
adapter, and the program prints the traced result, event sequence, and telemetry
count. No real model is called.

## Minimal usage

```ts
import {
  createInMemoryControlPlane,
  createAgentActor,
  MockExecutionAdapter,
  capability,
} from '@aion/core';

const research = capability('research.summary');

const plane = createInMemoryControlPlane({
  policy: { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
  adapters: [new MockExecutionAdapter({ capabilities: [research] })],
});

const agent = createAgentActor({
  name: 'ResearchAgent',
  purpose: 'Summarize research.',
  owner: 'growth-team',
  permissions: [research],
  maxRiskLevel: 'R2',
});

const outcome = await plane.orchestrator.submit({
  name: 'ResearchProspect',
  actor: agent,
  capability: research,
});

console.log(outcome.status); // "completed"
```

For a high-risk command the orchestrator returns `status: "awaiting_approval"`
with an `approval` request; call `orchestrator.resume({ approvalId, approve,
decidedBy })` to resume the **same** run.

---

## Lifecycle (run states)

```
created ─▶ evaluating ─┬─▶ denied
                       ├─▶ awaiting_approval ─┬─▶ approved ─▶ executing ─┬─▶ completed
                       │                      └─▶ denied                └─▶ failed
                       └─▶ executing …
```

Illegal transitions are rejected (`InvalidStateTransitionError`). Denied actions
never reach an execution adapter. Approval resumes the original run.

## Extension points

- **Execution runtimes** — implement `ExecutionAdapter` (`canHandle` +
  `execute`) and register it. Future adapters (Claude Code, Codex, Cursor, Grok,
  Kimi/OpenClaw, deterministic services, human operators) plug in here without
  changing orchestration. Core never learns which vendor is behind an adapter.
- **Persistence** — implement the ports (`RunRepository`, `MissionRepository`,
  `EventSink`, `ApprovalStore`, `TelemetrySink`) against a durable store
  (future `aion-data`) and inject them.
- **Policy** — configure `PolicyEngine` (capability→risk map, gated
  capabilities) or supply custom `PermissionEvaluator` / `RiskEvaluator`.

## Relationship to the ecosystem

| Repo | Role | Relationship to core |
|---|---|---|
| **aion-docs** | Architecture & governance (authoritative) | Governs core; core imports nothing from it. |
| **aion-core** | Control plane / Company OS | This repo. |
| **aion-data** | Canonical schemas, events, memory, outcomes | Implements core's persistence ports; core depends on data's contracts, never the reverse. |
| **aion-infra** | Environments, IaC, observability backends | Core runs *on* infra; does not import it. |
| **aion-products** | Products built on the platform | Depend on core; core never depends on products. |

Dependencies flow downward only:
`aion-products → aion-core → aion-data`. See
[`repositories/dependency-rules.md`](https://github.com/Ceoloo/aion-docs/blob/main/repositories/dependency-rules.md).

---

## Note on the risk taxonomy

Core uses the **R0–R3** risk model defined in
[`governance/risk-levels.md`](https://github.com/Ceoloo/aion-docs/blob/main/governance/risk-levels.md)
(Trivial / Low / Moderate / High), which is authoritative — not the
`LOW/MEDIUM/HIGH/CRITICAL` naming suggested by the Phase 1 build brief. This
conflict and its resolution are recorded in [`docs/phase-1.md`](docs/phase-1.md).
