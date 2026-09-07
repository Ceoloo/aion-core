import { describe, expect, it } from 'vitest';
import {
  applyIntake,
  approveBlueprint,
  attachBlueprintDraft,
  createImplementationCase,
  draftBlueprintFromCase,
  qualifyIntake,
  type ImplementationIntake,
} from '../../src/index.js';

const NOW = '2026-09-07T12:00:00.000Z';

function readyIntake(
  overrides: Partial<ImplementationIntake> = {},
): ImplementationIntake {
  return {
    businessContext: 'Service business losing leads after inquiry',
    primaryBottleneck: 'leads_lost_inquiry_followup',
    measurableProblem: 'Follow-up starts >24h after inquiry 60% of the time',
    namedOwner: 'operator-alex',
    accessReady: true,
    approvedScope: true,
    deliveryCapacityFeasible: true,
    outOfScope: false,
    needsDiscovery: false,
    modelAccessStatus: 'pending',
    ...overrides,
  };
}

describe('IE-001 ImplementationCase qualification', () => {
  it('maps bottleneck to Revenue OS and ignores model access for package selection', () => {
    const rec = qualifyIntake({
      intake: readyIntake({ modelAccessStatus: 'blocked' }),
      now: NOW,
    });
    expect(rec.outcome).toBe('recommend_package');
    expect(rec.recommendedPackage).toBe('revenue_os');
    expect(rec.rationale).toMatch(/Model access is a downstream gate/i);
  });

  it('holds when readiness gates are missing', () => {
    const rec = qualifyIntake({
      intake: readyIntake({ accessReady: false, approvedScope: false }),
      now: NOW,
    });
    expect(rec.outcome).toBe('hold_missing_inputs');
    expect(rec.missingInputs).toEqual(
      expect.arrayContaining(['access_ready', 'approved_scope']),
    );
  });

  it('requests discovery / declines out of scope without forcing a package sale', () => {
    expect(
      qualifyIntake({
        intake: readyIntake({ needsDiscovery: true }),
        now: NOW,
      }).outcome,
    ).toBe('request_discovery');

    expect(
      qualifyIntake({
        intake: readyIntake({
          outOfScope: true,
          outOfScopeReason: 'Not an AION fit',
        }),
        now: NOW,
      }).outcome,
    ).toBe('decline_out_of_scope');
  });

  it('runs create → intake → blueprint draft → approve', () => {
    let c = createImplementationCase({
      tenantId: 'aion-systems',
      clientRef: 'client-acme',
      clientName: 'Acme Services',
      ownerId: 'operator-alex',
      createdAt: NOW,
    });
    expect(c.deliveryStatus).toBe('draft');
    expect(
      c.provisioning?.steps.find((s) => s.key === 'ghl_connection')?.status,
    ).toBe('blocked');

    c = applyIntake(c, readyIntake({ completedBy: 'operator-alex' }), NOW);
    expect(c.deliveryStatus).toBe('recommendation_ready');
    expect(c.recommendation?.recommendedPackage).toBe('revenue_os');

    const draft = draftBlueprintFromCase({
      caseRecord: c,
      packageKey: 'revenue_os',
      deliveryOwner: 'operator-alex',
      now: NOW,
    });
    c = attachBlueprintDraft(c, draft, NOW);
    expect(c.deliveryStatus).toBe('blueprint_draft');
    expect(c.blueprint?.version).toBe(1);
    expect(c.blueprint?.status).toBe('draft');

    c = approveBlueprint(c, 'operator-alex', NOW);
    expect(c.deliveryStatus).toBe('blueprint_approved');
    expect(c.blueprint?.status).toBe('approved');
    expect(c.blueprint?.approvedBy).toBe('operator-alex');
  });

  it('keeps commercial status independent of delivery readiness', () => {
    const c = createImplementationCase({
      tenantId: 'aion-systems',
      clientRef: 'client-paid',
      clientName: 'Paid Co',
      ownerId: 'ops',
      commercialStatus: 'paid',
      createdAt: NOW,
    });
    expect(c.commercialStatus).toBe('paid');
    expect(c.deliveryStatus).toBe('draft');
  });
});
