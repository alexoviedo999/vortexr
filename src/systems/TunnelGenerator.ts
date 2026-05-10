import {
  createSystem,
  createComponent,
  eq,
  Types,
  Vector3,
} from "@iwsdk/core";
import { Object3D } from "three";
import { BoxGeometry, SphereGeometry, TorusGeometry, EdgesGeometry, LineSegments, MeshBasicMaterial, Color } from "three";
import { TouchableGeometry, PsychedelicMaterial, AudioParticleEmitter } from "../components/VortexrComponents.js";

/**
 * TunnelSegment
 * Each segment of the tunnel corridor has this component.
 */
export const TunnelSegment = createComponent("TunnelSegment", {
  shapeType: { type: Types.Int32, default: 0 },
  scale: { type: Types.Float32, default: 1.0 },
  ringIndex: { type: Types.Int32, default: 0 },
  baseHue: { type: Types.Float32, default: 0 },
  rotationSpeed: { type: Types.Float32, default: 0.0 },
  beatPulse: { type: Types.Float32, default: 0.0 },
});

/**
 * TunnelGeneratorSystem
 *
 * Spawns a ring of wireframe geometry every N units along the rail.
 * Each segment is a low-poly shape with PsychedelicMaterial.
 * Old rings behind the camera are destroyed to keep the pool bounded.
 */
export class TunnelGeneratorSystem extends createSystem(
  {
    tunnelSegments: { required: [TunnelSegment] },
  },
  {
    ringSpacing: { type: Types.Float32, default: 3.0 },
    segmentsPerRing: { type: Types.Int32, default: 8 },
    spawnAheadRings: { type: Types.Int32, default: 50 },
    despawnBehindRings: { type: Types.Int32, default: 2 },
    tunnelRadius: { type: Types.Float32, default: 2.5 },
    maxRings: { type: Types.Int32, default: 500 },
  }
) {
  private highestRingSpawned = 0;

  /** Called by index.ts after spawnInitialTunnel() populates initial entities. */
  rebuild(startFromRing: number = 0): void {
    this.highestRingSpawned = startFromRing;
    // Force first frame to spawn all needed rings
    this.update(0, 0);
  }

  init() {}

  update(_delta: number, _time: number) {
    const { player } = this.world;
    const playerZ = player.position.z;
    const ringSpacing = this.config.ringSpacing.peek();
    const spawnAhead = this.config.spawnAheadRings.peek();
    const despawnBehind = this.config.despawnBehindRings.peek();
    const maxRings = this.config.maxRings.peek();

    // Calculate which ring index the player is currently near
    const currentRingIdx = Math.round(-playerZ / ringSpacing);

    // Handle loop: when player loops back (ring index goes negative), reset
    if (currentRingIdx < 0) {
      for (const entity of this.queries.tunnelSegments.entities) {
        entity.dispose();
      }
      this.highestRingSpawned = 0;
      return;
    }

    // Spawn new rings ahead of player (up to maxRings limit)
    const targetRing = Math.min(currentRingIdx + spawnAhead, maxRings);
    while (this.highestRingSpawned < targetRing) {
      this.highestRingSpawned++;
      this.spawnRing(this.highestRingSpawned);
    }

    // Despawn rings behind player
    const minRing = currentRingIdx - despawnBehind;
    for (const entity of this.queries.tunnelSegments.entities) {
      const ringIdx = entity.getValue(TunnelSegment, "ringIndex");
      if (ringIdx !== null && ringIdx < minRing) {
        entity.dispose();
      }
    }
  }

  private spawnRing(ringIndex: number) {
    // Guard: don't spawn beyond maxRings
    if (ringIndex > this.config.maxRings.peek()) return;

    const numSegs = this.config.segmentsPerRing.peek();
    const radius = this.config.tunnelRadius.peek();
    const z = -ringIndex * this.config.ringSpacing.peek();

    for (let i = 0; i < numSegs; i++) {
      const angle = (i / numSegs) * Math.PI * 2;
      const shapeType = i % 4;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const hue = ((angle / (Math.PI * 2)) + ringIndex * 0.05) % 1.0;

      this.createSegment(shapeType, x, y, z, ringIndex, hue);
    }
  }

  private createSegment(
    shapeType: number,
    x: number,
    y: number,
    z: number,
    ringIndex: number,
    hue: number
  ) {
    let baseGeom: import("three").BufferGeometry;

    switch (shapeType) {
      case 0:
        baseGeom = new BoxGeometry(1.5, 1.5, 0.3, 1, 1, 1);
        break;
      case 1:
        baseGeom = new SphereGeometry(1.0, 4, 3);
        break;
      case 2:
        baseGeom = new TorusGeometry(0.8, 0.15, 4, 6);
        break;
      default:
        baseGeom = new BoxGeometry(1.2, 1.2, 1.2, 1, 1, 1);
    }

    const edges = new EdgesGeometry(baseGeom);
    baseGeom.dispose();

    const material = new MeshBasicMaterial({
      color: new Color().setHSL(hue, 1.0, 0.5),
      transparent: true,
      opacity: 0.6,
    });

    const lines = new LineSegments(edges, material);
    lines.position.set(x, y, z);
    lines.lookAt(0, 0, -1000);

    const entity = this.world.createTransformEntity(lines, { persistent: false });

    entity.addComponent(TunnelSegment, {
      shapeType,
      scale: 1.0,
      ringIndex,
      baseHue: hue * 360,
    });

    entity.addComponent(PsychedelicMaterial, {
      baseHue: hue * 360,
      hueShiftRange: 60,
      pulseAmplitude: 0.05,
      opacityRange: [0.3, 0.9, 0.3, 0.9],
    });

    entity.addComponent(TouchableGeometry, {
      audioParam: "gain",
      touchValue: 1.0,
      decayRate: 1.5,
      currentValue: 0.0,
    });

    entity.addComponent(AudioParticleEmitter, {
      burstCount: 30,
      triggerThreshold: 0.5,
      cooldown: 0.1,
      particleColor: [1, 1, 1, 1],
      lifetime: 1.2,
      speed: 4.0,
    });
  }
}