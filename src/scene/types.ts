import type { AssetFile } from '../data/catalog.ts';

export type Family = 'forest' | 'hill';
export type FlightDirection = 'left-to-right' | 'right-to-left';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export interface SceneInput {
  family: Family;
  season: Season;
  yokaiId: string | null;
  placement?: 'verified-default';
  /** Same monotonic time domain as sampleScene(nowMs). Never reset on a map swap. */
  playback: { originMs: number };
  effectsEnabled?: boolean;
  flightDirection?: FlightDirection;
}
export interface Timing {
  sequence: readonly number[];
  durationsMs: readonly number[];
  startOffsetMs?: number;
}
export interface OpacityPulse { min: number; max: number; periodMs: number }
export interface FlightMotion { distance: number; durationMs: number; arcHeight: number }
export interface LayerMetadata {
  opacityPulse?: OpacityPulse;
  type?: string;
  frameSize: readonly number[];
  sourceOrigin?: readonly number[];
  anchor?: readonly number[];
  contactPoint?: readonly number[];
  logicalScale?: number;
  order?: number;
  sync?: string;
  sequence?: readonly number[];
  durationsMs?: readonly number[];
  startOffsetMs?: number;
}
export interface BodyMetadata extends LayerMetadata {
  flight?: FlightMotion;
  sequence: readonly number[];
  durationsMs: readonly number[];
  anchor: readonly number[];
  contactPoint: readonly number[];
  sourceOrigin: readonly number[];
  giant: boolean;
  bodyOrder?: number;
  foregroundSpot?: string;
}
export interface SceneMap {
  id: string;
  family: string;
  season: string;
  scene: AssetFile;
  foreground: Record<string, AssetFile>;
}
export interface SceneCatalog {
  maps: readonly SceneMap[];
  yokai: readonly {
    id: string;
    no: number;
    art: {
      animation: {
        metadata: BodyMetadata;
        frames: readonly AssetFile[];
        halo: AssetFile | null;
        layers: readonly {
          metadata: LayerMetadata;
          usage: string;
          image: AssetFile | null;
          frames: readonly AssetFile[];
        }[];
      };
    } | null;
  }[];
  compatibility: { metadata: { verifiedDefaults: readonly {
    no: number;
    season: string;
    sourceAnchor: readonly number[];
    sourceContactPoint: readonly number[];
    families: readonly string[];
    status: string;
  }[] } };
}
export interface SceneLayer {
  readonly flight?: FlightMotion;
  readonly id: string;
  readonly files: readonly AssetFile[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly order: number;
  readonly opacityPulse?: OpacityPulse;
  readonly timing?: Timing;
  readonly sync?: 'bodyCel';
}
export interface ScenePlan {
  readonly input: Readonly<SceneInput>;
  readonly mapId: string;
  readonly layers: readonly SceneLayer[];
}
export interface DrawLayer {
  readonly flipX?: boolean;
  readonly opacity?: number;
  readonly id: string;
  readonly file: AssetFile;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cel: number;
}
