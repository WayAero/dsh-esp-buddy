import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

import { ESP_BUDDY_INVOCATIONS } from './contract.ts'

export const TYPERT_MANIFEST: TypertContribution = {
  package: 'dsh-esp-buddy',
  face: 'host',
  schemas: [],
  model: {
    services: [{
      key: 'espBuddy',
      exportName: 'EspBuddyRuntime',
      description: 'Current ESP32 Buddy transport and workload status.',
      tags: [],
      members: [{
        kind: 'method', name: 'officialApprovals',
        signature: 'officialApprovals(sessionId: string): ApprovalMirror[]',
      }, {
        kind: 'method',
        name: 'status',
        signature: 'status(): EspBuddyStatus',
      }, {
        kind: 'method',
        name: 'reconnect',
        signature: 'reconnect(): Promise<EspBuddyStatus>',
      }, {
        kind: 'method',
        name: 'installRolePack',
        signature: 'installRolePack(files: RolePackWireFile[]): Promise<RolePackProgress>',
      }, {
        kind: 'method',
        name: 'cancelRolePack',
        signature: 'cancelRolePack(): RolePackProgress',
      }],
      types: [],
    }],
    events: [],
    objects: [],
  },
  invocations: ESP_BUDDY_INVOCATIONS,
}
