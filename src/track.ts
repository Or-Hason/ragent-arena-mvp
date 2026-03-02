import * as THREE from 'three';

export interface TrackConfig {
  id: string;
  name: string;
  curve: THREE.CatmullRomCurve3;
  width: number;
}

/** All available track definitions. Width is set wide enough to prevent wall self-intersection. */
export const tracks: Record<string, TrackConfig> = {
  ring: {
    id: 'ring', name: 'The Ring (Beginner)', width: 24,
    curve: new THREE.CatmullRomCurve3([
      new THREE.Vector3(60, 0, 0), new THREE.Vector3(0, 0, 60),
      new THREE.Vector3(-60, 0, 0), new THREE.Vector3(0, 0, -60)
    ], true, 'catmullrom', 0.5)
  },
  oval: {
    id: 'oval', name: 'Speedway Oval', width: 24,
    curve: new THREE.CatmullRomCurve3([
      new THREE.Vector3(80, 0, -40), new THREE.Vector3(80, 0, 40),
      new THREE.Vector3(40, 0, 80), new THREE.Vector3(-40, 0, 80),
      new THREE.Vector3(-80, 0, 40), new THREE.Vector3(-80, 0, -40),
      new THREE.Vector3(-40, 0, -80), new THREE.Vector3(40, 0, -80)
    ], true, 'catmullrom', 0.5)
  },
  snake: {
    id: 'snake', name: 'Snake Winding (Pro)', width: 24,
    curve: new THREE.CatmullRomCurve3([
      new THREE.Vector3(120, 0, -30),
      new THREE.Vector3(80, 0, 40),
      new THREE.Vector3(30, 0, 70),
      new THREE.Vector3(-30, 0, 40),
      new THREE.Vector3(-80, 0, -30),
      new THREE.Vector3(-120, 0, -70),
      new THREE.Vector3(-120, 0, -120),
      new THREE.Vector3(-70, 0, -160),
      new THREE.Vector3(0, 0, -170),
      new THREE.Vector3(70, 0, -160),
      new THREE.Vector3(120, 0, -120),
      new THREE.Vector3(140, 0, -70),
    ], true, 'catmullrom', 0.3)
  }
};

export class TrackManager {
  config: TrackConfig;
  /** Uniformly-sampled centre-line points used for all distance/progress queries. */
  points: THREE.Vector3[];

  constructor(trackId: string) {
    this.config = tracks[trackId] || tracks.ring;
    this.points = this.config.curve.getPoints(300);
  }

  /**
   * Returns the world position, facing direction, and the tangent at the exact
   * point[0] of the sampled centre-line — used to place cars and the finish line
   * at precisely the same location the lap tracker recognises as t=0.
   *
   * @param isNpc When true, offsets the position to the left lane.
   */
  getStartData(isNpc = false) {
    // Use points[0] (not getPointAt(0)) so the position matches what
    // getClosestInfo reports as index 0 / t=0.
    const centre = this.points[0].clone();
    const tangent = this.points[1].clone().sub(this.points[0]).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const offset = isNpc ? -5 : 5;
    const pos = centre.clone().add(normal.multiplyScalar(offset));
    const angle = Math.atan2(tangent.x, tangent.z);
    return { pos, centre, angle, tangent };
  }

  /**
   * Returns the closest sampled point to `pos` on the track, together with
   * its normalised parameter `t` and lateral distance from centre.
   *
   * Uses a narrow windowed search around `lastIndex` when provided (avoids
   * ambiguity on figure-8 style tracks and is faster).
   */
  getClosestInfo(pos: THREE.Vector3, lastIndex = -1) {
    let minDist = Infinity;
    let closestIndex = 0;

    if (lastIndex !== -1) {
      for (let i = -15; i <= 30; i++) {
        const idx = (lastIndex + i + this.points.length) % this.points.length;
        const d = pos.distanceToSquared(this.points[idx]);
        if (d < minDist) { minDist = d; closestIndex = idx; }
      }
    } else {
      for (let i = 0; i < this.points.length; i++) {
        const d = pos.distanceToSquared(this.points[i]);
        if (d < minDist) { minDist = d; closestIndex = i; }
      }
    }

    const t = closestIndex / this.points.length;
    return { point: this.points[closestIndex], distance: Math.sqrt(minDist), t, index: closestIndex };
  }
}