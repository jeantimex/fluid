/**
 * Axis-aligned bounding box in world space.
 *
 * In this project, AABBs define "spawn regions" for fluid particles.
 * The simulation itself still runs on a fixed MAC grid; boxes only control
 * initial particle placement and density distribution.
 */
export class AABB {
  min: number[];
  max: number[];

  constructor(min: number[], max: number[]) {
    // Store copies to avoid accidental external mutation of constructor args.
    this.min = [min[0], min[1], min[2]];
    this.max = [max[0], max[1], max[2]];
  }

  /**
   * Computes box volume = width * height * depth.
   * Used to distribute target particle count proportionally across boxes.
   */
  computeVolume(): number {
    let volume = 1;
    for (let i = 0; i < 3; ++i) {
      volume *= this.max[i] - this.min[i];
    }
    return volume;
  }

  /**
   * Returns total box surface area.
   * Not currently used by the main loop, but useful for future heuristics
   * (e.g. spawn biasing near walls or interaction forces).
   */
  computeSurfaceArea(): number {
    const width = this.max[0] - this.min[0];
    const height = this.max[1] - this.min[1];
    const depth = this.max[2] - this.min[2];

    return 2 * (width * height + width * depth + height * depth);
  }

  /**
   * Deep-copy helper so callers can clone editable box state safely.
   */
  clone(): AABB {
    return new AABB(
      [this.min[0], this.min[1], this.min[2]],
      [this.max[0], this.max[1], this.max[2]]
    );
  }

  /**
   * Samples a uniformly random point inside the box volume.
   */
  randomPoint(): number[] {
    const point = [];
    for (let i = 0; i < 3; ++i) {
      point[i] = this.min[i] + Math.random() * (this.max[i] - this.min[i]);
    }
    return point;
  }
}
