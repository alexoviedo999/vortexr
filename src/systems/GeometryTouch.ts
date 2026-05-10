import {
  createSystem,
  Types,
  Vector3,
} from "@iwsdk/core";
import { Object3D } from "three";
import { TouchableGeometry, PsychedelicMaterial } from "../components/VortexrComponents.js";
import { TunnelSegment } from "./TunnelGenerator.js";
import { AudioReactorSystem, EffectParam } from "./AudioReactor.js";
import { PsychedelicFXSystem } from "./PsychedelicFX.js";

/**
 * GeometryTouchSystem
 *
 * Detects proximity between player hands and TouchableGeometry entities.
 * Uses player.indexTipSpaces (finger tip positions from hand tracking
 * or controller fallback) to detect when a hand is close enough to "touch".
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
  private touchRadius = 0.3; // 30cm proximity
  private tempVec = new Vector3();

  // Track which entities are currently being touched to fire events once
  private prevTouched = new Set<number>();

  init() {}

  update(delta: number, _time: number) {
    const { player } = this;
    const deltaSec = delta / 1000;

    const leftHand = player.indexTipSpaces?.left;
    const rightHand = player.indexTipSpaces?.right;

    const currentlyTouched = new Set<number>();

    // Expand touch radius significantly for VR - rings are at radius 2.5 from center
    const touchRadius = 2.0;

    for (const entity of this.queries.touchable.entities) {
      const obj = entity.object3D as Object3D | undefined;
      if (!obj) continue;

      const decayRate = (entity.getValue(TouchableGeometry, "decayRate") ?? 1.5);
      const targetVal = (entity.getValue(TouchableGeometry, "touchValue") ?? 1.0);
      let currentVal = (entity.getValue(TouchableGeometry, "currentValue") ?? 0);

      // Proximity check against left and right hand tips
      let isTouched = false;

      if (leftHand) {
        leftHand.getWorldPosition(this.tempVec);
        const dist = this.tempVec.distanceTo(obj.position);
        if (dist < touchRadius) {
          isTouched = true;
        }
      }

      if (!isTouched && rightHand) {
        rightHand.getWorldPosition(this.tempVec);
        const dist = this.tempVec.distanceTo(obj.position);
        if (dist < touchRadius) {
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
          console.log("[GeometryTouch] TOUCH! ringIndex=" + (entity.getValue(TunnelSegment, "ringIndex") ?? "?") + " entityIdx=" + entity.index);
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

    // Debug: log hand availability every 120 frames
    if (((this as any)._debugFrames || 0) >= 120) {
      (this as any)._debugFrames = 0;
      console.log("[GeometryTouch] leftHand=" + !!leftHand + " rightHand=" + !!rightHand + " touchableCount=" + this.queries.touchable.entities.size);
    }
    (this as any)._debugFrames = ((this as any)._debugFrames || 0) + 1;
  }

  private triggerTouchFlash(entity: import("@iwsdk/core").Entity) {
    const obj = entity.object3D as Object3D | undefined;
    if (!obj) return;

    // Check if this entity was already flashing (debounce rapid touches)
    const prevFlash = entity.getValue(TunnelSegment, "touchFlash") ?? 0;
    if (prevFlash > 0.5) return;  // skip if still bright from recent touch

    const mat = (obj as any).material;
    if (mat && mat.color) {
      mat.color.setRGB(1.0, 1.0, 1.0);
      mat.opacity = 1.0;
      entity.setValue(TunnelSegment, "touchFlash", 1.0);
      // Also scale up the ring segment on touch for a "pop" effect
      obj.scale.setScalar(1.5);
      console.log("[GeometryTouch] FLASH ringIndex=" + (entity.getValue(TunnelSegment, "ringIndex") ?? "?") + " entityIdx=" + entity.index);
    }
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