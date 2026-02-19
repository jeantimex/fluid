export class AABB {
  min: number[];
  max: number[];

  constructor(min: number[], max: number[]) {
    this.min = [min[0], min[1], min[2]];
    this.max = [max[0], max[1], max[2]];
  }

  computeVolume(): number {
    let volume = 1;
    for (let i = 0; i < 3; ++i) {
      volume *= this.max[i] - this.min[i];
    }
    return volume;
  }

  computeSurfaceArea(): number {
    const width = this.max[0] - this.min[0];
    const height = this.max[1] - this.min[1];
    const depth = this.max[2] - this.min[2];

    return 2 * (width * height + width * depth + height * depth);
  }

  clone(): AABB {
    return new AABB(
      [this.min[0], this.min[1], this.min[2]],
      [this.max[0], this.max[1], this.max[2]]
    );
  }

  randomPoint(): number[] {
    const point = [];
    for (let i = 0; i < 3; ++i) {
      point[i] = this.min[i] + Math.random() * (this.max[i] - this.min[i]);
    }
    return point;
  }
}
