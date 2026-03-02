import * as THREE from 'three';
import { Vehicle } from './vehicle';
import { TrackManager } from './track';

/** Autonomous racing opponent driven by a simple look-ahead steering controller. */
export class NPCController {
  public car: Vehicle;
  private track: TrackManager;
  private baseTargetSpeed = 45;
  private stuckTimer = 0;

  constructor(
    scene: THREE.Scene,
    track: TrackManager,
    color: string,
    startPos: THREE.Vector3,
    startAngle: number
  ) {
    this.track = track;
    this.car = new Vehicle(scene, track, color, startPos, startAngle);
  }

  /**
   * Steps the NPC's AI and physics forward by `delta` seconds.
   * Returns the wall-impact force so callers can play sounds/rumble.
   */
  update(delta: number): number {
    const info = this.track.getClosestInfo(this.car.mesh.position, this.car.trackIndex);
    this.car.trackIndex = info.index;

    // Recovery: reverse with full-right steering to un-wedge from a wall.
    if (this.stuckTimer > 0) {
      this.stuckTimer -= delta;
      return this.car.update({ throttle: 0, brake: 0.8, steering: -1 }, delta);
    }

    // Detect stuck state: nearly stopped AND close to a wall.
    if (Math.abs(this.car.velocity) < 2 && info.distance > this.track.config.width / 2 - 3) {
      this.stuckTimer = 1.5;
      return 0;
    }

    // Pick a look-ahead waypoint proportional to current speed.
    const lookaheadPoints = Math.floor(Math.max(10, Math.abs(this.car.velocity) * 0.4));
    const targetIndex = (info.index + lookaheadPoints) % this.track.points.length;
    const targetPos = this.track.points[targetIndex].clone();

    const dx = targetPos.x - this.car.mesh.position.x;
    const dz = targetPos.z - this.car.mesh.position.z;
    const targetAngle = Math.atan2(dx, dz);

    let diff = targetAngle - this.car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const steering = Math.max(-1, Math.min(1, -diff * 4.0));

    let throttle = 0; let brake = 0;
    const cornerSeverity = Math.abs(diff);
    let currentTargetSpeed = this.baseTargetSpeed;

    // Slow down for tight corners.
    if (cornerSeverity > 0.4) currentTargetSpeed = 15;
    else if (cornerSeverity > 0.2) currentTargetSpeed = 25;

    if (this.car.velocity < currentTargetSpeed) throttle = 0.8;
    else if (this.car.velocity > currentTargetSpeed + 2) brake = 0.8;

    return this.car.update({ throttle, brake, steering }, delta);
  }
}