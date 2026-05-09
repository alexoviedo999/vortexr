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
 * Moves the player straight along the z-axis.
 * Simple linear motion - no spline needed.
 */
export class RailMovementSystem extends createSystem(
  {
    railPoints: { required: [RailPoint] },
  },
  {
    progress: { type: Types.Float32, default: 0.0 },
    speed: { type: Types.Float32, default: 40.0 },
    active: { type: Types.Boolean, default: true },
  },
) {
  private splinePoints: Vector3[] = [];

  init() {}

  rebuild(): void {
    // Build spline for reference only - we use simple linear z movement
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
    const newProgress = Math.min(progress + speed * (_delta / 1000), 1.0);
    this.config.progress.value = newProgress;

    const { player } = this.world;
    // Straight linear motion in +z direction
    player.position.z = -newProgress * 200;
  }
}
