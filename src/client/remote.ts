import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

import {
  ESP_BUDDY_INVOCATIONS,
  type EspBuddyStatus,
  type RolePackProgress,
  type RolePackWireFile,
} from '../contract.ts'

export const ESP_BUDDY_REMOTE: TypertRemoteContribution = {
  package: 'dsh-esp-buddy',
  descriptors: ESP_BUDDY_INVOCATIONS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6573704275646479 {
    status: () => Promise<RemoteResult<EspBuddyStatus>>
    reconnect: () => Promise<RemoteResult<EspBuddyStatus>>
    installRolePack: (files: readonly RolePackWireFile[]) => Promise<RemoteResult<RolePackProgress>>
    uninstall: () => Promise<RemoteResult<{ reloadRequired: true }>>
  }
  interface TypertRemoteMap {
    'espBuddy/status': () => Promise<RemoteResult<EspBuddyStatus>>
    'espBuddy/reconnect': () => Promise<RemoteResult<EspBuddyStatus>>
    'espBuddy/installRolePack': (files: readonly RolePackWireFile[]) => Promise<RemoteResult<RolePackProgress>>
    'espBuddy/uninstall': () => Promise<RemoteResult<{ reloadRequired: true }>>
  }
  interface TypertRemoteNamespaceMap {
    espBuddy: TypertRemoteNamespace$6573704275646479
  }
}
