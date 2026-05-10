import {
  createSystem,
  Types,
  Vector3,
} from "@iwsdk/core";
import { Object3D } from "three";
import { TouchableGeometry, PsychedelicMaterial } from "../components/VortexrComponents.js";
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
 *   - visual flash triggers on PsychedelicMaterial
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
        if (this.tempVec.distanceTo(obj.position) < this.touchRadius + 0.5) {
          isTouched = true;
        }
      }

      if (!isTouched && rightHand) {
        rightHand.getWorldPosition(this.tempVec);
        if (this.tempVec.distanceTo(obj.position) < this.touchRadius + 0.5) {
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
  }

  private triggerTouchFlash(entity: import("@iwsdk/core").Entity) {
    const obj = entity.object3D as Object3D | undefined;
    if (!obj) return;

    // Emit spark particles at touch position
    const fxSystem = this.world.getSystem(PsychedelicFXSystem);
    fxSystem?.emitTouchSpark(obj.position.x, obj.position.y, obj.position.z);

    const mat = (obj as any).material;
    if (mat && mat.color && mat.color.setHSL) {
      const baseHue = (entity.getValue(PsychedelicMaterial, "baseHue") ?? 0);
      mat.color.setHSL(((baseHue + 180) % 360) / 360, 1.0, 0.85);
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