import {
  createSystem,
  Types,
  Vector3,
} from "@iwsdk/core";
import { Object3D, Color, Mesh, MeshBasicMaterial } from "three";
import { TouchableGeometry, PsychedelicMaterial } from "../components/VortexrComponents.js";
import { TunnelRing } from "./TunnelGenerator.js";
import { AudioReactorSystem, EffectParam } from "./AudioReactor.js";
import { AudioAnalyzerSystem } from "./AudioAnalyzer.js";

/**
 * GeometryTouchSystem
 *
 * Detects proximity between player controllers/hands and TouchableGeometry entities.
 * Uses player.gripSpaces (controller grip transform, real position) to detect
 * when a controller is close enough to "touch".
 *
 * On touch:
 *   - currentValue ramps to touchValue instantly
 *   - calls AudioReactorSystem.applyTouch() → modulates audio effect parameters
 *   - touch decays back to 0 at decayRate per second
 *   - visual flash + spark particles trigger on PsychedelicFXSystem
 */
export class GeometryTouchSystem extends createSystem(
  {
    touchable: { required: [TouchableGeometry] },
  },
  {}
) {
  private _touchRadius = 0.3; // small — must reach deliberately
  private tempVec = new Vector3();
  private leftPos = new Vector3();
  private rightPos = new Vector3();
  private leftDir = new Vector3();
  private rightDir = new Vector3();

  // Track which entities are currently being touched to fire events once
  private prevTouched = new Set<number>();

  // Expanding ring ripples from touch
  private ripples: Array<{ mesh: Mesh; entityIndex: number; life: number }> = [];

  // DNA-driven settings
  private _analyzerSystem: AudioAnalyzerSystem | null = null;

  setAnalyzer(analyzer: AudioAnalyzerSystem): void {
    this._analyzerSystem = analyzer;
  }

  init() {}

  update(delta: number, _time: number) {
    const { player } = this;
    const deltaSec = delta / 1000;

    // Use gripSpaces for actual controller/grab point position (not the ray or fingertip fallback)
    const leftCtrl = player.gripSpaces?.left;
    const rightCtrl = player.gripSpaces?.right;

    const currentlyTouched = new Set<number>();

    // Rings at 1.5m from tunnel center. Controller radial distance changes as user reaches
    // left: ~0.25m x → radial ~1.51m (near tunnel edge when reaching left)
    // right: ~0.14-0.40m x → radial ~1.59-1.68m (moves when reaching right)
    // Ring center orbits at spiralRadius from tunnel center
    // Ring shapes extend out to ~tunnelRadius from that center
    // Controller must be within ~spiralRadius+tunnelRadius of (0,0) AND near the ring's z
    const tunnelRadius = 3.0;
    const spiralRadius = 2.3;
    // Maximum radial distance where ring geometry can be touched
    const touchRingOuterRadius = spiralRadius + tunnelRadius;
    const touchRingInnerRadius = Math.max(0, spiralRadius - tunnelRadius);
    // Read from HTML slider debug config
    const debugCfg = (window as any).__debugConfig || {};
    const dna = this._analyzerSystem?.visualDNA.value;
    const dnaSensitivity = dna?.touchSensitivity ?? 1.0;
    const touchRadius = (debugCfg.touchRadius ?? this._touchRadius) * dnaSensitivity;

    // Pre-compute hand world positions once
    if (leftCtrl) leftCtrl.getWorldPosition(this.leftPos);
    if (rightCtrl) rightCtrl.getWorldPosition(this.rightPos);

    for (const entity of this.queries.touchable.entities) {
      const obj = entity.object3D as Object3D | undefined;
      if (!obj) continue;

      const decayRate = (entity.getValue(TouchableGeometry, "decayRate") ?? 1.5);
      const targetVal = (entity.getValue(TouchableGeometry, "touchValue") ?? 1.0);
      let currentVal = (entity.getValue(TouchableGeometry, "currentValue") ?? 0);

      // Radial reach + depth check: must be near ring's radial distance AND near ring's z-depth
      // This separates "flying past a ring" from "reaching toward a ring"
      let isTouched = false;

      if (leftCtrl) {
        const dist = this.leftPos.distanceTo(obj.position);
        const distFromOrigin = Math.sqrt(this.leftPos.x ** 2 + this.leftPos.y ** 2);
        // Must be within the annular ring where ring geometry exists
        const isInRingZone = distFromOrigin >= touchRingInnerRadius && distFromOrigin <= touchRingOuterRadius;
        const zDiff = Math.abs(this.leftPos.z - obj.position.z);
        const isNearRingDepth = zDiff < 5.0;
        const isCloseEnough = dist < touchRadius;
        if (isInRingZone && isNearRingDepth && isCloseEnough) {
          isTouched = true;
        }
      }

      if (!isTouched && rightCtrl) {
        const dist = this.rightPos.distanceTo(obj.position);
        const distFromOrigin = Math.sqrt(this.rightPos.x ** 2 + this.rightPos.y ** 2);
        const isInRingZone = distFromOrigin >= touchRingInnerRadius && distFromOrigin <= touchRingOuterRadius;
        const zDiff = Math.abs(this.rightPos.z - obj.position.z);
        const isNearRingDepth = zDiff < 5.0;
        const isCloseEnough = dist < touchRadius;
        if (isInRingZone && isNearRingDepth && isCloseEnough) {
          isTouched = true;
        }
      }

      if (isTouched) {
        currentVal = targetVal;
        entity.setValue(TouchableGeometry, "currentValue", currentVal);
        currentlyTouched.add(entity.index);

        // Fire audio modulation on touch start (not every frame while held)
        if (!this.prevTouched.has(entity.index)) {
          const audioParam = entity.getValue(TouchableGeometry, "audioParam") as string ?? "gain";
          const param = stringToEffectParam(audioParam);
          const audioSystem = this.world.getSystem(AudioReactorSystem);
          audioSystem?.applyTouch(entity.index, param, targetVal);
          console.log("[GeometryTouch] TOUCH! ringIndex=" + (entity.getValue(TunnelRing, "ringIndex") ?? "?") + " entityIdx=" + entity.index);
        }

        // Visual flash
        this.triggerTouchFlash(entity);
      } else {
        const decay = decayRate * deltaSec;
        const newVal = Math.max(0, currentVal - decay);
        entity.setValue(TouchableGeometry, "currentValue", newVal);
      }
    }

    this.prevTouched = currentlyTouched;

    // Update expanding ripples
    const deadRipples: typeof this.ripples = [];
    for (const ripple of this.ripples) {
      ripple.life -= deltaSec;
      if (ripple.life <= 0) {
        deadRipples.push(ripple);
        continue;
      }
      // Expand the ring
      const scale = 1.0 + (1.0 - ripple.life / 0.8) * 4.0;  // grows from 1x to 5x over lifetime
      ripple.mesh.scale.setScalar(scale);
      // Fade out
      const mat = (ripple.mesh as Mesh).material as MeshBasicMaterial;
      if (mat) mat.opacity = (ripple.life / 0.8) * 0.8;
    }
    for (const r of deadRipples) {
      this.world.scene.remove(r.mesh);
      const idx = this.ripples.indexOf(r);
      if (idx >= 0) this.ripples.splice(idx, 1);
    }

    // Debug: log grip world positions every 60 frames
    if (((this as any)._dbgFrames || 0) >= 60) {
      (this as any)._dbgFrames = 0;
      if (leftCtrl) {
        leftCtrl.getWorldPosition(this.leftPos);
        console.log("[GeometryTouch] left=" + this.leftPos.x.toFixed(2) + "," + this.leftPos.y.toFixed(2) + "," + this.leftPos.z.toFixed(2));
      }
      if (rightCtrl) {
        rightCtrl.getWorldPosition(this.rightPos);
        console.log("[GeometryTouch] right=" + this.rightPos.x.toFixed(2) + "," + this.rightPos.y.toFixed(2) + "," + this.rightPos.z.toFixed(2));
      }
    }
    (this as any)._dbgFrames = ((this as any)._dbgFrames || 0) + 1;
  }

  private triggerTouchFlash(entity: import("@iwsdk/core").Entity) {
    const obj = entity.object3D as Object3D | undefined;
    if (!obj) return;

    // Check if this entity was already flashing (debounce rapid touches)
    const prevFlash = entity.getValue(TunnelRing, "touchFlash") ?? 0;
    if (prevFlash > 0.5) return;  // skip if still bright from recent touch

    const mat = (obj as any).material;
    if (mat && mat.color) {
      mat.color.setRGB(1.0, 1.0, 1.0);
      mat.opacity = 1.0;
      entity.setValue(TunnelRing, "touchFlash", 2.0);
      console.log("[GeometryTouch] FLASH ringIndex=" + (entity.getValue(TunnelRing, "ringIndex") ?? "?") + " entityIdx=" + entity.index);
      // BIG scale pop on touch - 5.0x so it stands out even during max beat
      obj.scale.setScalar(5.0);
    }

    // Spawn expanding ring ripple at touch position
    // Use a flat RingGeometry (circle outline) that faces the camera and expands outward
    const ringIndex = entity.getValue(TunnelRing, "ringIndex") ?? 0;

    // Import RingGeometry dynamically to avoid top-level await issues
    import("three").then((three) => {
      const innerR = 0.5;
      const outerR = 1.0;
      const segments = 32;
      const rippleGeom = new three.RingGeometry(innerR, outerR, segments);
      const rippleMesh = new three.Mesh(
        rippleGeom,
        new three.MeshBasicMaterial({
          color: new Color().setHSL((ringIndex * 15) % 360 / 360, 1.0, 0.7),
          transparent: true,
          opacity: 0.8,
          side: three.DoubleSide,
        })
      );
      rippleMesh.position.copy(obj.position);
      rippleMesh.position.z += 0.5;
      rippleMesh.lookAt(rippleMesh.position.x, rippleMesh.position.y, rippleMesh.position.z + 10);
      this.world.scene.add(rippleMesh);
      this.ripples.push({ mesh: rippleMesh, entityIndex: entity.index, life: 0.8 });
    });
  }
}

// ─── Audio param mapping ───────────────────────────────────────────────────────

function stringToEffectParam(param: string): EffectParam {
  switch (param) {
    case "lowpass_freq":   return EffectParam.LOWPASS_FREQ;
    case "highpass_freq":  return EffectParam.HIGHPASS_FREQ;
    case "delay_feedback": return EffectParam.DELAY_FEEDBACK;
    case "delay_time":     return EffectParam.DELAY_TIME;
    case "reverb_mix":    return EffectParam.REVERB_MIX;
    case "distortion":     return EffectParam.DISTORTION;
    default:              return EffectParam.LOWPASS_FREQ;
  }
}