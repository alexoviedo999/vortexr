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
  },
  {
    pulseScale: { type: Types.Float32, default: 1.0 },
    intensity: { type: Types.Float32, default: 0.0 },
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

    // ── Update psychedelic materials ──────────────────────────────────────
    for (const entity of this.queries.psychedelicMaterials.entities) {
      const obj = entity.object3D as Object3D | undefined;
      if (!obj) continue;

      const baseHue = (entity.getValue(PsychedelicMaterial, "baseHue") ?? 0);
      const hueShiftRange = (entity.getValue(PsychedelicMaterial, "hueShiftRange") ?? 60);
      const pulseAmp = (entity.getValue(PsychedelicMaterial, "pulseAmplitude") ?? 0.1);

      const hueShift = (baseHue + intensity * hueShiftRange) % 360;
      const lightness = 0.45 + intensity * 0.25;
      const pulse = 1.0 + Math.sin(_time * 0.005) * pulseAmp * intensity;

      obj.scale.setScalar(pulse * this.config.pulseScale.peek());

      if (obj instanceof Mesh) {
        const mat = obj.material as MeshBasicMaterial;
        if (mat && mat.color) {
          this.tempColor.setHSL(hueShift / 360, 1.0, lightness);
          mat.color.copy(this.tempColor);
          if (mat.transparent) {
            const opacityRange = (entity.getValue(PsychedelicMaterial, "opacityRange") ?? [0.3, 0.9]) as number[];
            mat.opacity = opacityRange[0] + (opacityRange[1] - opacityRange[0]) * intensity;
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