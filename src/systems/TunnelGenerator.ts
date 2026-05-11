import {
  createSystem,
  createComponent,
  Types,
} from "@iwsdk/core";
import { BoxGeometry, SphereGeometry, TorusGeometry, OctahedronGeometry, EdgesGeometry, LineSegments, MeshBasicMaterial, Color, BufferGeometry, Float32BufferAttribute } from "three";
import { TouchableGeometry, PsychedelicMaterial } from "../components/VortexrComponents.js";
import { AudioAnalyzerSystem, VisualDNA } from "./AudioAnalyzer.js";

/**
 * TunnelRing
 * One entity per ring. Each ring is a single merged LineSegments (1 draw call).
 * All segments in a ring share one material and one transform.
 */
export const TunnelRing = createComponent("TunnelRing", {
  ringIndex: { type: Types.Int32, default: 0 },
  baseHue: { type: Types.Float32, default: 0 },
  beatPulse: { type: Types.Float32, default: 0.0 },
  touchFlash: { type: Types.Float32, default: 0.0 },
  persistent: { type: Types.Boolean, default: false }, // survives despawn culling
  spiralSide: { type: Types.Int32, default: 0 }, // 0 or 1 = opposite spirals
});

/**
 * TunnelGeneratorSystem
 *
 * Spawns rings of wireframe geometry every N units along the rail.
 * Each ring is a single merged LineSegments = 1 draw call.
 * Rings spawn continuously to fill ringsAhead gap + on beat.
 * Old rings behind the camera are destroyed to keep the pool bounded.
 */
export class TunnelGeneratorSystem extends createSystem(
  {
    tunnelRings: { required: [TunnelRing] },
  },
  {
    ringSpacing: { type: Types.Float32, default: 25.0 },
    segmentsPerRing: { type: Types.Int32, default: 6 },
    ringsAhead: { type: Types.Int32, default: 5 },
    despawnBehindRings: { type: Types.Int32, default: 20 },
    tunnelRadius: { type: Types.Float32, default: 3.0 },
    maxRings: { type: Types.Int32, default: 10000 },
    pendingBeatSpawn: { type: Types.Boolean, default: false },
    persistentInterval: { type: Types.Int32, default: 8 }, // every Nth ring is persistent
    spawnIntervalMs: { type: Types.Int32, default: 600 }, // ms between spawn bursts
  }
) {
  private highestRingSpawned = 0;
  private lastSpawnMs = 0;
  private _analyzerSystem: AudioAnalyzerSystem | null = null;

  rebuild(startFromRing: number = 0): void {
    this.highestRingSpawned = startFromRing;
    this.update(0, 0);
  }

  setAnalyzer(analyzer: AudioAnalyzerSystem): void {
    this._analyzerSystem = analyzer;
  }

  triggerBeatSpawn(): void {
    this.config.pendingBeatSpawn.value = true;
  }

  init() {}

  update(_delta: number, _time: number) {
    const { player } = this.world;
    const playerZ = player.position.z;
    const ringSpacing = this.config.ringSpacing.peek();
    const despawnBehind = this.config.despawnBehindRings.peek();
    const poolMax = this.config.maxRings.peek();
    const pendingBeat = this.config.pendingBeatSpawn.peek();
    const spawnIntervalMs = this.config.spawnIntervalMs.peek();
    this.config.pendingBeatSpawn.value = false;

    const debugCfg = (window as any).__debugConfig || {};
    if (debugCfg.ringsAhead !== undefined) {
      this.config.ringsAhead.value = debugCfg.ringsAhead;
    }

    const currentRingIdx = Math.round(-playerZ / ringSpacing);

    // Handle loop: when player loops back (ring index goes negative), reset
    // Only trigger if we're significantly past the start (avoid resetting at frame 0)
    if (currentRingIdx < -5) {
      for (const entity of this.queries.tunnelRings.entities) {
        entity.dispose();
      }
      this.highestRingSpawned = 0;
      return;
    }

    // Guard: don't spawn if entity count is dangerously high (IWSDK ECS pool limit ~16000)
    const MAX_POOL = 12000;
    const currentCount = this.queries.tunnelRings.entities.size;
    if (currentCount >= MAX_POOL) return;

    // Always despawn aggressively when pool is getting full
    const minRing = currentRingIdx - despawnBehind;
    if (currentCount > 6000) {
      const aggressiveMin = currentRingIdx - 5; // keep only 5 rings behind
      for (const entity of this.queries.tunnelRings.entities) {
        const ringIdx = entity.getValue(TunnelRing, "ringIndex");
        const isPersistent = entity.getValue(TunnelRing, "persistent") ?? false;
        if (!isPersistent && ringIdx !== null && ringIdx < aggressiveMin) {
          try { entity.dispose(); } catch (e) { /* ignore */ }
        }
      }
    } else {
      for (const entity of this.queries.tunnelRings.entities) {
        const ringIdx = entity.getValue(TunnelRing, "ringIndex");
        const isPersistent = entity.getValue(TunnelRing, "persistent") ?? false;
        if (!isPersistent && ringIdx !== null && ringIdx < minRing) {
          try { entity.dispose(); } catch (e) { /* ignore */ }
        }
      }
    }

    // Rate limit: only spawn one ring pair per spawnIntervalMs
    const nowMs = Date.now();
    if (nowMs - this.lastSpawnMs < spawnIntervalMs) return;
    this.lastSpawnMs = nowMs;

    if (pendingBeat && this.highestRingSpawned < poolMax) {
      const nextRing = currentRingIdx + 1;
      try {
        this.spawnRing(nextRing, 0);
      } catch (e) { /* skip spiral 0 */ }
      try {
        this.spawnRing(nextRing, 1);
      } catch (e) { /* skip spiral 1 */ }
      this.highestRingSpawned = nextRing;
    }

    const ringsAhead = this.config.ringsAhead.peek();
    const targetRing = currentRingIdx + ringsAhead;

    while (this.highestRingSpawned < targetRing && this.highestRingSpawned < poolMax) {
      this.highestRingSpawned++;
      try {
        this.spawnRing(this.highestRingSpawned, 0);
      } catch (e) {
        break;
      }
      try {
        this.spawnRing(this.highestRingSpawned, 1);
      } catch (e) {
        break;
      }
    }
  }

  private spawnRing(ringIndex: number, spiralSide: number) {
    const poolMax = this.config.maxRings.peek();
    if (ringIndex > poolMax) return;

    const numSegs = this.config.segmentsPerRing.peek();
    const radius = this.config.tunnelRadius.peek();
    const z = -ringIndex * this.config.ringSpacing.peek();
    const dna = this._analyzerSystem?.visualDNA.value;

    // Use DNA color hue range if available, else fallback
    const hueRange = dna?.colorHueRange ?? [0, 360] as [number, number];
    const hueSpan = hueRange[1] - hueRange[0];
    const hue = (hueRange[0] + ((ringIndex * 0.05 + spiralSide * 0.5) * hueSpan)) % 360;

    // Two spirals: spiral 0 = 0°, spiral 1 = 180° offset (opposite side)
    const spiralStep = 0.4;
    const spiralAngle = ringIndex * spiralStep + spiralSide * Math.PI;
    const spiralRadius = 2.3;
    const cx = Math.cos(spiralAngle) * spiralRadius;
    const cy = Math.sin(spiralAngle) * spiralRadius;

    // Pick shape type using DNA ringShapeBias if available
    let shapeType = ringIndex % 4;
    if (dna?.ringShapeBias) {
      const r = Math.random();
      const [box, sphere, torus, octa] = dna.ringShapeBias;
      if (r < box) shapeType = 0;
      else if (r < box + sphere) shapeType = 1;
      else if (r < box + sphere + torus) shapeType = 2;
      else shapeType = 3;
    }

    // Merge all segment geometries into one LineSegments (1 draw call)
    const mergedGeom = this.buildMergedRingGeometry(numSegs, radius, shapeType);
    const material = new MeshBasicMaterial({
      color: new Color().setHSL(hue / 360, 1.0, 0.5),
      transparent: true,
      opacity: 1.0,
    });
    const lines = new LineSegments(mergedGeom, material);
    lines.position.set(cx, cy, z);
    lines.lookAt(0, 0, -1000);

    const isPersistent = ringIndex % this.config.persistentInterval.peek() === 0;
    const entity = this.world.createTransformEntity(lines, { persistent: false });
    entity.addComponent(TunnelRing, {
      ringIndex,
      baseHue: hue,
      persistent: isPersistent,
      spiralSide,
    });

    // One TouchableGeometry per ring for audio modulation
    entity.addComponent(TouchableGeometry, {
      audioParam: "lowpass_freq",
      touchValue: 1.0,
      decayRate: 1.5,
      currentValue: 0.0,
    });

    // One PsychedelicMaterial per ring for color pulse
    entity.addComponent(PsychedelicMaterial, {
      baseHue: hue,
      hueShiftRange: 60,
      pulseAmplitude: 0.08,
      opacityRange: [0.3, 0.95, 0.3, 0.95],
    });
  }

  private buildMergedRingGeometry(numSegs: number, radius: number, shapeBias: number): BufferGeometry {
    // Collect all edge vertices from all segment shapes into one buffer
    const positions: number[] = [];

    for (let i = 0; i < numSegs; i++) {
      const angle = (i / numSegs) * Math.PI * 2;
      // shapeBias 0=box, 1=sphere, 2=torus, 3=octahedron — bias toward certain shapes
      const shapeType = Math.floor(((i + shapeBias * 2) % 4));
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const segGeom = this.createSegmentGeometry(shapeType, x, y);
      const edgeGeom = new EdgesGeometry(segGeom);
      segGeom.dispose();

      const pos = edgeGeom.attributes["position"];
      for (let j = 0; j < pos.count; j++) {
        positions.push(pos.getX(j), pos.getY(j), pos.getZ(j));
      }
      edgeGeom.dispose();
    }

    const merged = new BufferGeometry();
    merged.setAttribute("position", new Float32BufferAttribute(Float32Array.from(positions), 3));
    return merged;
  }

  private createSegmentGeometry(shapeType: number, x: number, y: number): import("three").BufferGeometry {
    switch (shapeType) {
      case 0: return new BoxGeometry(1.8, 1.8, 0.4, 1, 1, 1);
      case 1: return new SphereGeometry(1.1, 5, 4);
      case 2: return new TorusGeometry(1.2, 0.25, 4, 6);
      default: return new OctahedronGeometry(1.4, 0);
    }
  }
}
