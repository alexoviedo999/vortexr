import { createComponent, Types } from "@iwsdk/core";

/**
 * Vortexr custom components
 */

/** Rail path waypoint — RailMovementSystem builds a CatmullRom spline from these. */
export const RailPoint = createComponent("RailPoint", {
  order: { type: Types.Float32, default: 0 },
});

/**
 * Geometry that can be "touched" by the player's hand.
 * Each segment maps to one audio effect parameter.
 */
export const TouchableGeometry = createComponent("TouchableGeometry", {
  /** Which EffectParam this geometry modulates on touch */
  audioParam: { type: Types.String, default: "lowpass_freq" },
  /** 0-1 normalized touch intensity */
  touchValue: { type: Types.Float32, default: 1.0 },
  /** How fast touchValue decays back to 0 (per second) */
  decayRate: { type: Types.Float32, default: 1.5 },
  /** Current blended value — written by GeometryTouchSystem */
  currentValue: { type: Types.Float32, default: 0.0 },
});

/**
 * Psychedelic material effect — hue, scale, and opacity driven by audio energy.
 */
export const PsychedelicMaterial = createComponent("PsychedelicMaterial", {
  baseHue: { type: Types.Float32, default: 0 },
  hueShiftRange: { type: Types.Float32, default: 60 },
  pulseAmplitude: { type: Types.Float32, default: 0.1 },
  opacityRange: { type: Types.Vec4, default: [0.3, 1.0, 0.3, 1.0] },
});

/**
 * Particle burst emitter triggered by audio peaks or touches.
 */
export const AudioParticleEmitter = createComponent("AudioParticleEmitter", {
  burstCount: { type: Types.Int32, default: 30 },
  triggerThreshold: { type: Types.Float32, default: 0.5 },
  cooldown: { type: Types.Float32, default: 0.1 },
  cooldownTimer: { type: Types.Float32, default: 0.0 },
  particleColor: { type: Types.Color, default: [1, 1, 1, 1] },
  lifetime: { type: Types.Float32, default: 1.2 },
  speed: { type: Types.Float32, default: 4.0 },
});