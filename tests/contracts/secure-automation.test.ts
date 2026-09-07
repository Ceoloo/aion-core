import { describe, expect, it } from 'vitest';
import {
  LEAD_TO_APPOINTMENT_V1,
  SECURE_AUTOMATION_CONTROLS,
  SECURE_AUTOMATION_PRODUCTION_BLOCKERS,
  SECURE_AUTOMATION_RESEARCH_CAVEATS,
  SECURE_AUTOMATION_STANDARD_ID,
  SECURE_AUTOMATION_STANDARD_VERSION,
  applyIntake,
  attachBlueprintDraft,
  buildSecureAutomationAppointmentCatalog,
  createImplementationCase,
  draftBlueprintFromCase,
  getSecureAutomationStandard,
  type ImplementationIntake,
} from '../../src/index.js';

const NOW = '2026-09-07T14:00:00.000Z';

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

describe('SA-STD-001 Secure Automation', () => {
  it('publishes a versioned standard with required controls', () => {
    const std = getSecureAutomationStandard();
    expect(std.standardId).toBe(SECURE_AUTOMATION_STANDARD_ID);
    expect(std.standardVersion).toBe(SECURE_AUTOMATION_STANDARD_VERSION);
    expect(std.controls.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'tenant_isolation',
        'scoped_permissions',
        'approved_communication',
        'durable_execution',
        'duplicate_prevention',
        'auditability',
        'outcome_measurement',
      ]),
    );
    expect(SECURE_AUTOMATION_CONTROLS).toHaveLength(7);
  });

  it('defines L2A v1 without customer send and with human appointment booking', () => {
    expect(LEAD_TO_APPOINTMENT_V1.workflowId).toBe('lead-to-appointment-v1');
    expect(LEAD_TO_APPOINTMENT_V1.prohibitedCapabilities).toContain(
      'crm.message.send',
    );
    expect(LEAD_TO_APPOINTMENT_V1.permissions).not.toContain('crm.message.send');
    const book = LEAD_TO_APPOINTMENT_V1.steps.find(
      (s) => s.name === 'book-appointment',
    );
    expect(book?.humanOperated).toBe(true);
  });

  it('drafts Revenue OS blueprints onto SA-STD-001 / L2A v1', () => {
    let c = createImplementationCase({
      tenantId: 'aion-systems',
      clientRef: 'client-acme',
      clientName: 'Acme Services',
      ownerId: 'operator-alex',
      createdAt: NOW,
    });
    c = applyIntake(c, readyIntake({ completedBy: 'operator-alex' }), NOW);
    const draft = draftBlueprintFromCase({
      caseRecord: c,
      packageKey: 'revenue_os',
      deliveryOwner: 'operator-alex',
      now: NOW,
    });
    expect(draft.firstWorkflow.name).toBe('Lead-to-Appointment v1');
    expect(draft.secureAutomation?.standardId).toBe('SA-STD-001');
    expect(draft.secureAutomation?.workflowId).toBe('lead-to-appointment-v1');
    expect(draft.prohibitedActions).toEqual(
      expect.arrayContaining(['crm.message.send', 'autonomous_customer_messaging']),
    );
    expect(draft.acceptanceTests.some((t) => /idempotency/i.test(t))).toBe(true);

    c = attachBlueprintDraft(c, draft, NOW);
    expect(c.blueprint?.secureAutomation?.standardVersion).toBe('1.0.0');
  });

  it('keeps appointment catalog stubs inactive', () => {
    const stubs = buildSecureAutomationAppointmentCatalog();
    expect(stubs).toHaveLength(3);
    expect(stubs.every((s) => s.status === 'inactive')).toBe(true);
    expect(stubs.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'crm.appointment.read',
        'crm.appointment.create',
        'crm.appointment.update',
      ]),
    );
  });

  it('maps OL verification and lists production blockers with claim caveats', () => {
    const std = getSecureAutomationStandard();
    expect(std.olVerification.map((o) => o.olId)).toEqual([
      'OL-001',
      'OL-002',
      'OL-003',
      'OL-004',
      'OL-005',
    ]);
    expect(std.olVerification.find((o) => o.olId === 'OL-001')?.verificationStatus).toBe(
      'blocked',
    );
    expect(
      SECURE_AUTOMATION_PRODUCTION_BLOCKERS.some((b) => b.id === 'AIO-16'),
    ).toBe(true);
    expect(
      SECURE_AUTOMATION_PRODUCTION_BLOCKERS.some((b) => b.id === 'AIO-17'),
    ).toBe(true);
    expect(
      SECURE_AUTOMATION_RESEARCH_CAVEATS.every(
        (c) => c.status === 'unverified_research_input',
      ),
    ).toBe(true);
  });
});
