import type { AssetFile } from '../data/catalog.ts';
import type { DrawLayer, FlightDirection, LayerMetadata, SceneCatalog, SceneInput, SceneLayer, SceneMap, ScenePlan, Timing } from './types.ts';

/** Python round's nearest integer, ties-to-even, including negative halves. */
export function roundTiesToEven(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Non-finite coordinate');
  const lower = Math.floor(value);
  const fraction = value - lower;
  const result = fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
  return result === 0 ? 0 : result;
}

export function frameAt(timing: Timing, elapsedMs: number): { step: number; cel: number } {
  const { sequence, durationsMs } = timing;
  if (!Number.isFinite(elapsedMs) || !sequence.length || sequence.length !== durationsMs.length ||
      durationsMs.some(ms => !Number.isFinite(ms) || ms <= 0)) throw new Error('Invalid animation timing');
  const total = durationsMs.reduce((a, b) => a + b, 0);
  let phase = ((elapsedMs + (timing.startOffsetMs ?? 0)) % total + total) % total;
  for (let step = 0; step < durationsMs.length; step++) {
    if (phase < durationsMs[step]) return { step, cel: sequence[step] };
    phase -= durationsMs[step];
  }
  return { step: 0, cel: sequence[0] };
}

/** Use only after placement approval. Does not authorize a new spot. */
export function mapForeground(map: SceneMap, spot: 'bush_right' | 'rock_left'): AssetFile {
  const file = map.foreground[spot];
  if (!file) throw new Error(`Missing map foreground: ${map.id}/${spot}`);
  return file;
}

function geometry(meta: LayerMetadata) {
  const scale = meta.logicalScale ?? 1;
  const anchor = meta.anchor ?? [0, 0];
  const contact = meta.contactPoint ?? [0, 0];
  // contact is in scene units; anchor/frameSize are in source image units.
  // Animation anchors already include sourceOrigin padding. Do not add it again.
  return {
    x: roundTiesToEven(contact[0] - anchor[0] * scale),
    y: roundTiesToEven(contact[1] - anchor[1] * scale),
    width: roundTiesToEven(meta.frameSize[0] * scale),
    height: roundTiesToEven(meta.frameSize[1] * scale),
  };
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

/** Pure static compiler. No clock, I/O, user records, or game lifecycle callbacks. */
export function compileScene(catalog: SceneCatalog, input: SceneInput): ScenePlan {
  if (input.flightDirection !== undefined && !['left-to-right', 'right-to-left'].includes(input.flightDirection)) throw new Error('Invalid flight direction');
  if (!Number.isFinite(input.playback.originMs)) throw new Error('Invalid playback origin');
  if (input.placement !== undefined && input.placement !== 'verified-default') throw new Error('Unverified placement');
  const map = catalog.maps.find(m => m.family === input.family && m.season === input.season);
  if (!map) throw new Error('Unavailable map');
  const layers: SceneLayer[] = [{ id: 'background', files: [map.scene], x: 0, y: 0, width: 192, height: 256, order: -Infinity }];
  if (input.yokaiId !== null) {
    const yokai = catalog.yokai.find(y => y.id === input.yokaiId);
    if (!yokai?.art) throw new Error(`Unavailable yokai art: ${input.yokaiId}`);
    const animation = yokai.art.animation;
    const meta = animation.metadata;
    const approved = catalog.compatibility.metadata.verifiedDefaults.find(p => p.no === yokai.no &&
      p.season === input.season && p.families.includes(input.family) && p.status === 'verified_original_default');
    if (!approved || !meta.anchor.every((v, i) => v === approved.sourceAnchor[i]) ||
        !meta.contactPoint.every((v, i) => v === approved.sourceContactPoint[i])) throw new Error('No verified default placement');
    const body = geometry(meta);
    if (meta.flight && (![meta.flight.distance, meta.flight.durationMs, meta.flight.arcHeight].every(Number.isFinite)
      || meta.flight.durationMs <= 0 || meta.flight.distance <= 0 || meta.flight.arcHeight < 0)) throw new Error('Invalid flight path');
    // Keep authored contact points aligned with the fixed map foreground.
    layers.push({ id: 'body', files: animation.frames, ...body, ...(meta.flight ? { flight: meta.flight } : {}), order: meta.bodyOrder ?? 20,
      timing: { sequence: meta.sequence, durationsMs: meta.durationsMs, startOffsetMs: meta.startOffsetMs ?? 0 } });
    if (meta.foregroundSpot) {
      if (meta.foregroundSpot !== 'rock_left' && meta.foregroundSpot !== 'bush_right') throw new Error('Unverified foreground spot');
      layers.push({ id: 'foreground', files: [mapForeground(map, meta.foregroundSpot)],
        x: 0, y: 0, width: 192, height: 256, order: 30 });
    }
    if (animation.halo && input.effectsEnabled !== false) {
      layers.push({ id: 'halo', files: [animation.halo], x: 0, y: 0, width: 192, height: 256, order: 10 });
    }
    for (const layer of animation.layers) {
      const m = layer.metadata;
      // Original icicle/support pixels are already present in map.scene.
      if (layer.usage === 'included-in-map-scene') continue;
      if (layer.usage === 'map-foreground') {
        // Replacement has its own logical 192×256 geometry (034's old PNG was 2x).
        layers.push({ id: 'foreground', files: [mapForeground(map, 'bush_right')],
          x: 0, y: 0, width: 192, height: 256, order: m.order ?? 30 });
        continue;
      }
      if (input.effectsEnabled === false) continue;
      const files = layer.frames.length ? layer.frames : layer.image ? [layer.image] : [];
      if (!files.length) throw new Error(`Missing layer files: ${m.type}`);
      if (m.opacityPulse && (![m.opacityPulse.min, m.opacityPulse.max, m.opacityPulse.periodMs].every(Number.isFinite)
        || m.opacityPulse.min < 0 || m.opacityPulse.max > 1 || m.opacityPulse.min > m.opacityPulse.max || m.opacityPulse.periodMs <= 0)) throw new Error('Invalid layer opacity pulse');
      layers.push({ ...(m.opacityPulse ? { opacityPulse: m.opacityPulse } : {}), id: m.type ?? 'auxiliary', files, ...geometry(m), order: m.order ?? 30,
        ...(m.sync === 'bodyCel' ? { sync: 'bodyCel' as const } : files.length > 1 ? {
          timing: { sequence: m.sequence ?? meta.sequence, durationsMs: m.durationsMs ?? meta.durationsMs,
            startOffsetMs: m.startOffsetMs ?? meta.startOffsetMs ?? 0 },
        } : {}),
      });
    }
  }
  // Clone before freezing: neither caller input nor A01 catalog is mutated/frozen.
  return freezeTree(structuredClone({ input, mapId: map.id, layers: layers.sort((a, b) => a.order - b.order) }));
}

/** A visit chooses direction once; preparation retries reuse this immutable plan. */
export function withFlightDirection(plan: ScenePlan, direction: FlightDirection): ScenePlan {
  if (!['left-to-right', 'right-to-left'].includes(direction)) throw new Error('Invalid flight direction');
  if (!plan.layers.some(l => l.flight)) return plan;
  return freezeTree({ ...plan, input: { ...plan.input, flightDirection: direction } });
}

export function sampleScene(plan: ScenePlan, nowMs: number): readonly DrawLayer[] {
  const elapsed = nowMs - plan.input.playback.originMs;
  const body = plan.layers.find(l => l.id === 'body');
  const bodyCel = body?.timing ? frameAt(body.timing, elapsed).cel : 0;
  return plan.layers.map(layer => {
    const cel = layer.sync === 'bodyCel' ? bodyCel : layer.timing ? frameAt(layer.timing, elapsed).cel : 0;
    const file = layer.files[cel];
    if (!file) throw new Error(`Missing cel ${cel} for ${layer.id}`);
    const pulse = layer.opacityPulse;
    const opacity = pulse ? pulse.min + (pulse.max - pulse.min) * (1 - Math.cos(2 * Math.PI * elapsed / pulse.periodMs)) / 2 : undefined;
    const progress = layer.flight ? Math.max(0, Math.min(1, elapsed / layer.flight.durationMs)) : 0;
    const forwardX = layer.x + (layer.flight ? Math.round(layer.flight.distance * progress) : 0);
    const flipX = !!layer.flight && plan.input.flightDirection === 'right-to-left';
    const x = flipX ? 192 - forwardX - layer.width : forwardX;
    const y = layer.y - (layer.flight ? Math.round(layer.flight.arcHeight * Math.sin(Math.PI * progress)) : 0);
    return { ...(flipX ? { flipX: true } : {}), ...(opacity === undefined ? {} : { opacity }), id: layer.id, file, cel, x, y, width: layer.width, height: layer.height };
  });
}

export function sceneFiles(plan: ScenePlan): readonly AssetFile[] {
  return [...new Map(plan.layers.flatMap(l => l.files).map(f => [f.publicPath, f])).values()];
}

export function integerSceneScale(width: number, height: number): number {
  return Math.max(1, Math.min(2, Math.floor(width / 192), Math.floor((height - 64) / 256)));
}

/** CSS origin is snapped too: centering an even scene in an odd viewport can be fractional. */
export function integerSceneLayout(width: number, height: number) {
  const scale = integerSceneScale(width, height);
  return { scale, left: Math.max(0, Math.floor((width - 192 * scale) / 2)),
    top: Math.max(0, Math.floor((height - (256 * scale + 64)) / 2)) };
}
