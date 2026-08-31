import type { Mission } from '../contracts/mission.js';
import type { MissionId } from '../contracts/identifiers.js';

/**
 * MissionRepository port.
 *
 * A persistence *contract* — Core declares the capability it needs and never
 * imports a concrete database (aion-docs critical design rule: Core must not
 * depend on a database implementation). Durable implementations are supplied
 * externally (future aion-data); Phase 1 uses an in-memory adapter.
 */
export interface MissionRepository {
  get(id: MissionId): Promise<Mission | undefined>;
  save(mission: Mission): Promise<void>;
}
