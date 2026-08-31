import type { MissionRepository } from '../ports/mission-repository.js';
import type { Mission } from '../contracts/mission.js';
import type { MissionId } from '../contracts/identifiers.js';

/** In-memory {@link MissionRepository}. Phase 1 default; not durable. */
export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, Mission>();

  async get(id: MissionId): Promise<Mission | undefined> {
    return this.missions.get(id);
  }

  async save(mission: Mission): Promise<void> {
    this.missions.set(mission.missionId, mission);
  }
}
