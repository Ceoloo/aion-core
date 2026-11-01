# Canonical control-plane entities (AIO-10), schema v1

Source: `src/contracts/canonical-entities.ts`. Tests: `tests/contracts/canonical-entities.test.ts`.

**Status: additive contract layer only.** No runtime path uses these yet. Existing exports (`Workflow`, `AionEvent`, `OutcomeReference`, `PolicyDecision`, `AgentRegistryRecord`, `EconomicsMetrics`, ...) are unchanged. AIO-10 is **partial**: the distribution strategy and producer/consumer migration are still open.

## Envelope (every entity)
| Field | Rule |
|---|---|
| `kind` | Discriminator: one of the 12 entity names |
| `schemaVersion` | Literal `"1"`. `parseCanonicalEntity` throws `UnknownSchemaVersionError` for any other value, including missing |
| `tenantId` | **Required** `TenantId` (`tnt_…`). Every canonical entity is tenant-scoped |
| `createdAt`, `updatedAt` | UTC ISO-8601 |
| `correlationId`, `executionId` | Optional existing trace IDs (`cor_`, `exe_`) |
| `provenance` | Optional `{ source, sourceRef?, recordedBy? }` |
| `metadata` | Free record, default `{}` |

## Entities and IDs
| Entity | Schema | ID (prefix) | Entity-specific required fields |
|---|---|---|---|
| Agent | `CanonicalAgent` | `AgentId` (`agt_`, existing) | name, ownerId |
| Workforce | `CanonicalWorkforce` | `WorkforceId` (`wfc_`) | name |
| Task | `CanonicalTask` | `TaskId` (`tsk_`) | title, status |
| Workflow | `CanonicalWorkflow` | `WorkflowId` (`wf_`, existing) | name, definitionVersion |
| Event | `CanonicalEvent` | `EventId` (`evt_`, existing) | eventType, occurredAt |
| Policy | `CanonicalPolicy` | `PolicyId` (`pol_`) | name, policyVersion |
| Memory | `CanonicalMemory` | `MemoryId` (`mem_`) | subjectRef, content |
| LearningSignal | `CanonicalLearningSignal` | `LearningSignalId` (`lsg_`) | signal |
| Outcome | `CanonicalOutcome` | `OutcomeId` (`out_`, existing) | status |
| Customer | `CanonicalCustomer` | `CustomerId` (`cus_`) | name |
| Opportunity | `CanonicalOpportunity` | `OpportunityId` (`opp_`) | customerId, stage |
| EconomicValue | `CanonicalEconomicValue` | `EconomicValueId` (`ecv_`) | amountMinor (integer minor units), currency (ISO 4217) |

New ID kinds live in `CANONICAL_ID_KIND`, not `ID_KIND`, so the existing ID inventory is unchanged.

## Versioning rules
- A breaking change means a new literal (`"2"`) and a new schema. v1 parsers keep rejecting v2.
- Adding optional fields within v1 is allowed.
- Status and stage fields are plain strings in v1. Binding them to state machines is an open decision (see the PR).

## Open decisions (not decided here)
1. Distribution of `@aion/core` (private package, git pin, or registry).
2. Whether any entity (e.g. Policy, Workflow templates) can be global rather than tenant-scoped.
3. Mapping to existing shapes (`Workflow.version` vs `definitionVersion`, `OutcomeStatus` enum vs string, `AgentRegistryRecord.tenant` vs `tenantId`).
4. State machines for Task status / Opportunity stage.
5. Format of the tenant ID (`tnt_` prefix) vs the existing free-string `tenantId` on Actor/Approval/Authority.
