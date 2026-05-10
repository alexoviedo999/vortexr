import {
  createSystem,
  createComponent,
  Types,
  Vector3,
} from "@iwsdk/core";
import { RailPoint } from "../components/VortexrComponents.js";

/**
 * RailMovementSystem
 *
 * Moves the player along the z-axis in a continuous loop.
 */
export class RailMovementSystem extends createSystem(
  {
    railPoints: { required: [RailPoint] },
  },
  {
    progress: { type: Types.Float32, default: 0.0 },
    speed: { type: Types.Float32, default: 3.0 },
    active: { type: Types.Boolean, default: true },
    pathLength: { type: Types.Float32, default: 15000.0 },
  }
) {
  private splinePoints: Vector3[] = [];
  public onLoop: (() => void) | null = null;
  private lastProgress = 0;

  init() {}

  rebuild(): void {
    const points = [...this.queries.railPoints.entities]
      .map((entity) => {
        const obj = entity.object3D;
        const order = entity.getValue(RailPoint, "order") ?? 0;
        return { pos: obj ? (obj as any).position.clone() : new Vector3(), order };
      })
      .sort((a, b) => a.order - b.order);

    this.splinePoints = points.map((p) => new Vector3(p.pos.x, p.pos.y, p.pos.z));
  }

  update(_delta: number, _time: number) {
    if (!this.config.active.peek()) return;

    const progress = this.config.progress.peek();
    const speed = this.config.speed.peek();
    const pathLength = this.config.pathLength.peek();
    let newProgress = progress + speed * (_delta / 1000);

    // Clamp to 1.0 so ride ends when song ends (no looping)
    if (newProgress >= 1.0) {
      newProgress = 1.0;
      this.config.active.value = false;  // stop rail movement when done
    }

    this.lastProgress = newProgress;
    this.config.progress.value = newProgress;

    const { player } = this.world;
    player.position.z = -newProgress * pathLength;
  }
}
