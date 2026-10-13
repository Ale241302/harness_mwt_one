/**
 * Composer submission policy: the live busy-Enter preference shared by the
 * composer bar's submission gestures and its Settings row. Gesture resolution
 * lives in the contract (`resolveSubmitMode`); this module owns the preference
 * and its Host-backed persistence. Host and Agent keep the actual
 * delivery-window authority.
 */
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { BusyEnterBehavior } from '../contract/composer-submission.ts'
import { BUSY_ENTER_FIELD, DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'

export { DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'

/**
 * Busy-Enter preference shared by the composer bar inject face and its
 * Settings row: one live store the bar's submission gestures and Send label
 * read, backed by the Host user-settings document when one is composed.
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the composer bar and the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the busy-state submission behavior; the live value publishes
   * before the durable write starts.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Adopt the scope's accepted durable behavior without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.busyEnter.getSnapshot() === section.busyEnter) return
    this.busyEnter.set(section.busyEnter)
  }
}
