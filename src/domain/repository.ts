import type { BackgroundFamily, GameState, GrantSource, ObservationOwner, Season } from './state.ts';

export interface StartedVisit {
  visitId: string;
  yokaiId: string;
  itemId: string;
  appearedAt: string;
  captureDeadlineAt: string;
  /** Exact live duration; optional for older v3. ISO timestamps truncate submilliseconds. */
  dwellMs?: number;
  /** Photo slot season, resolved from static definitions by A04/A06. */
  season: Season;
  backgroundFamily: BackgroundFamily;
}
export type Command =
  | { type: 'claimObservation'; sessionId: string; expectedEpoch: number }
  | { type: 'startVisit'; owner: ObservationOwner; visit: StartedVisit }
  | { type: 'settleVisit'; owner: ObservationOwner; visitId: string; source: GrantSource; at: string;
      /** Live monotonic elapsed time, bound to the persisted start anchors. Never reconstructed on recovery. */
      timing?: { appearedAt: string; captureDeadlineAt: string; elapsedMs: number };
      photo?: { photoKey: string; slotSeason?: Season; sceneSeason?: Season; capturedGameSeason?: Season; shared?: boolean } }
  | { type: 'finishVisit'; owner: ObservationOwner; visitId: string }
  | { type: 'markYokaiViewed'; yokaiId: string; viewedAt: string }
  | { type: 'markItemViewed'; itemId: string; viewedAt: string; manualCount: number; leftCount: number }
  | { type: 'updatePhotoStatus'; yokaiId: string; season: Season; photoKey: string;
      attemptId?: string; status: 'saved' | 'failed' }
  | { type: 'changeSettings'; patch: { sound?: boolean; arrivalChime?: boolean; backgroundFamily?: BackgroundFamily; seasonMode?: 'auto' | 'fixed'; fixedSeason?: Season }; firstRunDone?: boolean; viewedCutscenes?: string[] };

/** account is reserved for the future server adapter; no account implementation in A02. */
export type Persistence = 'volatile' | 'local' | 'account';
export type StorageFailure = {
  status: 'unavailable'; operation: 'lock' | 'read' | 'write' | 'backup'; reason: string;
};
export type LoadFailure = StorageFailure
  | { status: 'unsupported-version'; version: unknown }
  | { status: 'corrupt'; raw: string; recovered: GameState; backup: 'saved' | 'failed'; reason: string };
export type ReadResult = LoadFailure
  | { status: 'ok'; state: GameState; origin: 'empty' | 'stored' | 'migrated'; persistence: Persistence;
      /** Account-only durable import receipt; never changes counters on photo resume. */
      migration?: { migrationId: string; fingerprint: string } };
export type CommitResult = LoadFailure
  | { status: 'applied' | 'unchanged'; state: GameState; persistence: Persistence }
  | { status: 'conflict'; actualRevision: number }
  | { status: 'invalid'; reason: string };
/** Commands, never a UI-owned replacement snapshot. Remote adapters implement this same port. */
export interface GameRepository {
  /** Explicit remote protocol: browser guard immediately before send, server revision/epoch CAS. */
  readonly guardSemantics?: 'remote-preflight-cas';
  /** Explicit acquisition/retry bypasses the remote display cache. */
  read(options?: { fresh?: boolean }): Promise<ReadResult>;
  /** Optional local capability: inspect a detached latest snapshot while holding
   * the SAME metadata writer lock through a short asynchronous file transaction.
   * No encoding, metadata commit, or nested repository calls inside work.
   * Adapters without this capability must disable guarded photo file writes. */
  withSnapshot?<T>(work: (latest: Readonly<GameState>) => Promise<T>): Promise<
    LoadFailure | { status: 'inspected'; value: T }>;
  commit(command: Command, options?: {
    expectedRevision?: number;
    /** Synchronous, fail-closed live policy check inside the storage lock, immediately before transition/write.
     * Local adapters must implement it or reject guarded commands. An explicitly declared
     * remote-preflight-cas adapter instead evaluates on a fresh read before sending a revision-bound command;
     * the callback does not execute inside the remote lock and cannot revoke an already sent event. */
    guard?: (latest: Readonly<GameState>) => boolean;
  }): Promise<CommitResult>;
}
