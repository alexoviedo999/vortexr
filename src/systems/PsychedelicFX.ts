import {
  createSystem,
  Types,
  Vector3,
  Color,
  Object3D,
} from "@iwsdk/core";
import {
  Mesh,
  MeshBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
} from "three";
import { PsychedelicMaterial, AudioParticleEmitter } from "../components/VortexrComponents.js";
import { TunnelSegment } from "./TunnelGenerator.js";
import type { Entity } from "@iwsdk/core";

/**
 * PsychedelicFXSystem
 *
 * Drives all audio-reactive visual effects:
 *   - Hue rotation on wireframe/low-poly materials driven by audio energy
 *   - Scale pulsing (objects "breathe" with the beat)
 *   - Opacity flickering synced to treble energy
 *   - Particle bursts at audio peaks
 */
export class PsychedelicFXSystem extends createSystem(
  {
    psychedelicMaterials: { required: [PsychedelicMaterial] },
    particleEmitters: { required: [AudioParticleEmitter] },
    tunnelSegments: { required: [TunnelSegment] },
  },
  {
    pulseScale: { type: Types.Float32, default: 1.0 },
    intensity: { type: Types.Float32, default: 0.0 },
    beatIntensity: { type: Types.Float32, default: 0.0 },
    active: { type: Types.Boolean, default: true },
  }
) {
  private tempColor = new Color();

  // Particle pool - reduced to prevent buffer overflow
  private maxParticles = 500;
  private particlePositions!: Float32Array;
  private particleVelocities!: Float32Array;
  private particleLifetimes!: Float32Array;
  private activeParticleCount = 0;

  // Three.js particle object
  private particlePoints: Points | null = null;

  init() {
    this.initParticlePool();
  }

  /** Called by GeometryTouchSystem when a hand touches geometry — emits spark burst */
  emitTouchSpark(x: number, y: number, z: number): void {
    const burstCount = 20;
    const speed = 3.0;
    const lifetime = 0.4;

    let placed = 0;
    for (let i = 0; i < burstCount; i++) {
      const idx = this.findFreeParticleSlot();
      if (idx < 0) break;

      placed++;
      const i3 = idx * 3;
      this.particlePositions[i3] = x;
      this.particlePositions[i3 + 1] = y;
      this.particlePositions[i3 + 2] = z;

      // Random outward velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const v = speed * (0.5 + Math.random() * 0.5);
      this.particleVelocities[i3] = Math.sin(phi) * Math.cos(theta) * v;
      this.particleVelocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * v;
      this.particleVelocities[i3 + 2] = Math.cos(phi) * v;
      this.particleLifetimes[idx] = lifetime;
    }

    // Spark color: bright yellow/white
    if (this.particlePoints) {
      const mat = this.particlePoints.material as PointsMaterial;
      mat.color.setRGB(1.0, 0.95, 0.6);
    }
    console.log("[PsychedelicFX] emitTouchSpark at " + x.toFixed(1) + "," + y.toFixed(1) + "," + z.toFixed(1) + " placed=" + placed + "/" + burstCount);
  }

  private initParticlePool() {
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleVelocities = new Float32Array(this.maxParticles * 3);
    this.particleLifetimes = new Float32Array(this.maxParticles);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(this.particlePositions, 3)
    );

    const material = new PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });

    this.particlePoints = new Points(geometry, material);
    this.world.scene.add(this.particlePoints);
  }

  update(delta: number, _time: number) {
    if (!this.config.active.peek()) return;

    const intensity = this.config.intensity.peek();
    const deltaSec = delta / 1000;
    const beatIntensity = this.config.beatIntensity.peek();

    // ── Update tunnel ring segments (rotation synced to beat) ──────────────
    for (const entity of this.queries.tunnelSegments.entities) {
      const obj = entity.object3D as Object3D | undefined;
      if (!obj) continue;

      const ringIndex = entity.getValue(TunnelSegment, "ringIndex") ?? 0;
      const beatPulse = entity.getValue(TunnelSegment, "beatPulse") ?? 0;

      // Each ring rotates at its own speed + beats with the music
      const baseRotationRate = 0.2 + (ringIndex % 5) * 0.05;
      const beatBoost = beatIntensity * 8.0;  // very strong beat boost
      const currentRotationSpeed = baseRotationRate + beatBoost;

      // Apply rotation
      obj.rotation.y += currentRotationSpeed * deltaSec;
      obj.rotation.x += (currentRotationSpeed * 0.3) * deltaSec;

      // Scale pulse: multiply by beat intensity factor (not subtracted from previous)
      const scaleFactor = 1.0 + beatIntensity * 1.5;  // max 2.5x on full beat
      obj.scale.setScalar(scaleFactor);

      // Decay stored beatPulse that was set to 1.0 by TunnelGenerator on beat
      const storedBeat = entity.getValue(TunnelSegment, "beatPulse") ?? 0;
      const decayedBeat = Math.max(0, storedBeat - deltaSec * 4.0);
      entity.setValue(TunnelSegment, "beatPulse", decayedBeat);

      // Color flash: on beat, rings flash white (storedBeat ~= 1.0), decays to normal color
      if (storedBeat > 0.1) {
        if (obj instanceof LineSegments) {
          const mat = obj.material as MeshBasicMaterial;
          if (mat) {
            // storedBeat goes from 1.0 → 0, so white → normal color
            mat.color.setRGB(storedBeat, storedBeat, storedBeat);
          }
        }
      }
    }

    // ── Update psychedelic materials ──────────────────────────────────────
    for (const entity of this.queries.psychedelicMaterials.entities) {
      const obj = entity.object3D as Object3D | undefined;
      if (!obj) continue;

      const baseHue = (entity.getValue(PsychedelicMaterial, "baseHue") ?? 0);
      const hueShiftRange = (entity.getValue(PsychedelicMaterial, "hueShiftRange") ?? 60);
      const pulseAmp = (entity.getValue(PsychedelicMaterial, "pulseAmplitude") ?? 0.1);

      // Beat-synced pulse: normal pulse + beat boost
      const beatBoost = beatIntensity * 0.2;
      const hueShift = (baseHue + intensity * hueShiftRange) % 360;
      const lightness = 0.45 + intensity * 0.25 + beatBoost * 0.15;
      const pulse = 1.0 + Math.sin(_time * 0.005) * pulseAmp * intensity + beatBoost;

      obj.scale.setScalar(pulse * this.config.pulseScale.peek());

      if (obj instanceof Mesh) {
        const mat = obj.material as MeshBasicMaterial;
        if (mat && mat.color) {
          this.tempColor.setHSL(hueShift / 360, 1.0, lightness);
          mat.color.copy(this.tempColor);
          if (mat.transparent) {
            const opacityRange = (entity.getValue(PsychedelicMaterial, "opacityRange") ?? [0.3, 0.9]) as number[];
            mat.opacity = opacityRange[0] + (opacityRange[1] - opacityRange[0]) * intensity + beatBoost * 0.3;
          }
        }
      } else if (obj instanceof LineSegments) {
        const mat = obj.material as MeshBasicMaterial;
        if (mat && mat.color) {
          this.tempColor.setHSL(hueShift / 360, 1.0, lightness);
          mat.color.copy(this.tempColor);
        }
      }
    }

    // ── Update particle emitters ──────────────────────────────────────────
    for (const entity of this.queries.particleEmitters.entities) {
      const cooldown = (entity.getValue(AudioParticleEmitter, "cooldownTimer") ?? 0);
      const newCooldown = Math.max(0, cooldown - deltaSec);
      entity.setValue(AudioParticleEmitter, "cooldownTimer", newCooldown);

      const triggerThreshold = (entity.getValue(AudioParticleEmitter, "triggerThreshold") ?? 0.5);
      if (newCooldown <= 0 && intensity > triggerThreshold) {
        this.emitParticleBurst(entity);
        const cooldownDur = (entity.getValue(AudioParticleEmitter, "cooldown") ?? 0.1);
        entity.setValue(AudioParticleEmitter, "cooldownTimer", cooldownDur);
      }
    }

    this.updateParticles(deltaSec);
  }

  private emitParticleBurst(entity: Entity) {
    const burstCount = (entity.getValue(AudioParticleEmitter, "burstCount") ?? 30);
    const speed = (entity.getValue(AudioParticleEmitter, "speed") ?? 4.0);
    const lifetime = (entity.getValue(AudioParticleEmitter, "lifetime") ?? 1.2);
    const colorArr = (entity.getValue(AudioParticleEmitter, "particleColor") ?? [1, 1, 1, 1]) as number[];
    const spawnPos = (entity.object3D as Object3D | undefined)?.position;

    if (!spawnPos) return;

    for (let i = 0; i < burstCount; i++) {
      const idx = this.findFreeParticleSlot();
      if (idx < 0) break;

      const i3 = idx * 3;
      this.particlePositions[i3] = spawnPos.x;
      this.particlePositions[i3 + 1] = spawnPos.y;
      this.particlePositions[i3 + 2] = spawnPos.z;

      const angle = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const v = speed * (0.5 + Math.random() * 0.5);
      this.particleVelocities[i3] = Math.sin(phi) * Math.cos(angle) * v;
      this.particleVelocities[i3 + 1] = Math.sin(phi) * Math.sin(angle) * v;
      this.particleVelocities[i3 + 2] = Math.cos(phi) * v;
      this.particleLifetimes[idx] = lifetime;
    }

    if (this.particlePoints) {
      const mat = this.particlePoints.material as PointsMaterial;
      mat.color.setRGB(colorArr[0] ?? 1, colorArr[1] ?? 1, colorArr[2] ?? 1);
    }
  }

  private findFreeParticleSlot(): number {
    // Circular buffer - keep a high water mark to avoid rescanning dead slots
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particleLifetimes[i] <= 0) return i;
    }
    return -1;
  }

  private updateParticles(deltaSec: number) {
    if (!this.particlePoints) return;

    let activeCount = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particleLifetimes[i] <= 0) continue;
      this.particleLifetimes[i] -= deltaSec;

      const i3 = i * 3;
      this.particlePositions[i3] += this.particleVelocities[i3] * deltaSec;
      this.particlePositions[i3 + 1] += this.particleVelocities[i3 + 1] * deltaSec;
      this.particlePositions[i3 + 2] += this.particleVelocities[i3 + 2] * deltaSec;

      this.particleVelocities[i3] *= 0.98;
      this.particleVelocities[i3 + 1] *= 0.98;
      this.particleVelocities[i3 + 2] *= 0.98;

      activeCount++;
    }

    this.activeParticleCount = activeCount;

    const geom = this.particlePoints.geometry;
    const posAttr = geom.getAttribute("position") as Float32BufferAttribute;
    posAttr.array = this.particlePositions;
    posAttr.needsUpdate = true;
    geom.setDrawRange(0, activeCount);
  }
}