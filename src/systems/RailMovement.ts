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
    speed: { type: Types.Float32, default: 15.0 },
    active: { type: Types.Boolean, default: true },
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
    let newProgress = progress + speed * (_delta / 1000);

    // Wrap progress using modulo for true infinite loop
    newProgress = newProgress % 1.0;

    // Fire loop callback when progress wraps
    if (this.lastProgress > 0.9 && newProgress < 0.1) {
      if (this.onLoop) this.onLoop();
    }

    this.lastProgress = newProgress;
    this.config.progress.value = newProgress;

    const { player } = this.world;
    // Increase ride length from 2500 to 15000 units so rings (spacing 3.0) last much longer
    player.position.z = -newProgress * 15000;
  }
}
