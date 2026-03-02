export interface CarInputs {
  steering: number;
  throttle: number;
  brake: number;
}

/** Non-driving auxiliary inputs. */
export interface AuxInputs {
  horn: boolean;
  toggleLights: boolean;   // true on the frame the key is first pressed
  lookLeft: boolean;
  lookRight: boolean;
  lookBack: boolean;
}

/** Maps keyboard keys to car inputs with analogue-like smoothing. */
export class KeyboardManager {
  /** Current smoothed analogue values */
  private _steering = 0;
  private _throttle = 0;
  private _brake = 0;

  /** Raw key state */
  private keys: Set<string> = new Set();

  /** Per-axis ramp-up and ramp-down speeds (units/second, 1 = full deflection). */
  // Throttle & brake are kept gentle so the car doesn't bolt off the line.
  private readonly THROTTLE_UP = 1.8;
  private readonly THROTTLE_DOWN = 4.0;
  private readonly BRAKE_UP = 2.5;
  private readonly BRAKE_DOWN = 5.0;
  // Steering needs to be responsive enough for quick corrections.
  private readonly STEER_UP = 4.0;
  private readonly STEER_DOWN = 7.0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Prevent default browser scrolling for arrow/space keys during gameplay
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      this.keys.add(e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }

  /**
   * Must be called once per frame with the elapsed delta to update
   * the smoothed analogue values. Returns the current CarInputs.
   */
  update(delta: number): CarInputs {
    const wantSteering = (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A'))
      ? -1
      : (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D'))
        ? 1
        : 0;

    const wantThrottle = (this.keys.has('ArrowUp') || this.keys.has('w') || this.keys.has('W')) ? 1 : 0;
    const wantBrake = (this.keys.has('ArrowDown') || this.keys.has('s') || this.keys.has('S') || this.keys.has(' ')) ? 1 : 0;

    this._steering = this._ramp(this._steering, wantSteering, delta, this.STEER_UP, this.STEER_DOWN);
    this._throttle = this._ramp(this._throttle, wantThrottle, delta, this.THROTTLE_UP, this.THROTTLE_DOWN);
    this._brake = this._ramp(this._brake, wantBrake, delta, this.BRAKE_UP, this.BRAKE_DOWN);

    return {
      steering: this._steering,
      throttle: this._throttle,
      brake: this._brake,
    };
  }

  /** Returns single-frame auxiliary inputs. */
  getAux(): AuxInputs {
    const toggleLights = this.keys.has('l') || this.keys.has('L');
    // Edge-detect: only fire on the frame the key is first pressed
    const toggleFired = toggleLights && !this._prevToggle;
    this._prevToggle = toggleLights;

    return {
      horn: this.keys.has('h') || this.keys.has('H'),
      toggleLights: toggleFired,
      lookLeft: this.keys.has('q') || this.keys.has('Q'),
      lookRight: this.keys.has('e') || this.keys.has('E'),
      lookBack: this.keys.has('c') || this.keys.has('C'),
    };
  }
  private _prevToggle = false;

  /** Smoothly moves `current` toward `target` using the supplied ramp rates. */
  private _ramp(current: number, target: number, delta: number, rampUp: number, rampDown: number): number {
    const rate = (Math.abs(target) > Math.abs(current) || Math.sign(target) !== Math.sign(current))
      ? rampUp
      : rampDown;
    const step = rate * delta;
    if (current < target) return Math.min(current + step, target);
    if (current > target) return Math.max(current - step, target);
    return current;
  }
}

/** Reads from the G923 (or any Gamepad API gamepad). */
export class GamepadManager {
  private gamepadIndex: number | null = null;

  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      if (this.gamepadIndex === null) this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  isConnected(): boolean {
    if (this.gamepadIndex === null) return false;
    return !!navigator.getGamepads()[this.gamepadIndex];
  }

  getInputs(): CarInputs {
    const gp = navigator.getGamepads()[this.gamepadIndex!];
    if (!gp) return { steering: 0, throttle: 0, brake: 0 };

    return {
      steering: gp.axes[0] || 0,
      throttle: this._invertAndNormalize(gp.axes[2] !== undefined ? gp.axes[2] : 1),
      brake: this._invertAndNormalize(gp.axes[5] !== undefined ? gp.axes[5] : 1),
    };
  }

  /** Basic Force-Feedback rumble. */
  applyRumble(intensity: number): void {
    if (this.gamepadIndex === null) return;
    const gp = navigator.getGamepads()[this.gamepadIndex] as any;
    if (gp?.vibrationActuator?.playEffect) {
      gp.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: 50,
        weakMagnitude: intensity,
        strongMagnitude: intensity,
      }).catch(() => { }); // suppress browser-blocked errors
    }
  }

  private _prevToggle = false;

  getAux(): AuxInputs | null {
    if (this.gamepadIndex === null) return null;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return null;

    const btn = (i: number) => gp.buttons[i]?.pressed || false;

    // G923 / Standard Gamepad tentative mappings:
    // 0: X
    // 1: Square
    // 3: Triangle
    // 4: Paddle Left
    // 5: Paddle Right
    const toggleLights = btn(3);
    const toggleFired = toggleLights && !this._prevToggle;
    this._prevToggle = toggleLights;

    return {
      horn: btn(0),
      toggleLights: toggleFired,
      lookLeft: btn(4),
      lookRight: btn(5),
      lookBack: btn(1),
    };
  }

  private _invertAndNormalize(val: number): number {
    return (1 - val) / 2;
  }
}

export type InputMode = 'gamepad' | 'keyboard';

/**
 * Automatically routes input from the G923 wheel when connected,
 * falling back to keyboard controls when it is disconnected.
 */
export class InputRouter {
  private readonly gamepad: GamepadManager;
  private readonly keyboard: KeyboardManager;

  constructor() {
    this.gamepad = new GamepadManager();
    this.keyboard = new KeyboardManager();
  }

  getMode(): InputMode {
    return this.gamepad.isConnected() ? 'gamepad' : 'keyboard';
  }

  getInputs(delta: number): CarInputs {
    const ki = this.keyboard.update(delta);

    // Keyboard steering is capped at 40% so it feels consistent regardless
    // of whether a wheel is connected or not.
    const KB_STEER_CAP = 0.4;

    if (!this.gamepad.isConnected()) {
      return {
        steering: ki.steering * KB_STEER_CAP,
        throttle: ki.throttle,
        brake: ki.brake,
      };
    }

    const gi = this.gamepad.getInputs();
    // Wheel input is proportional to physical deflection (0 → 1 at full lock).
    // A G923 has a 900-degree lock (450 left, 450 right), so physical turning
    // gives very small inputs relative to the keyboard. Amplify heavily so
    // a 120-130 degree physical rotation yields full steering lock in-game.
    const WHEEL_STEER_AMP = 3.5;

    return {
      steering: Math.max(-1, Math.min(1, gi.steering * WHEEL_STEER_AMP + ki.steering * KB_STEER_CAP)),
      throttle: Math.max(0, Math.min(1, gi.throttle + ki.throttle)),
      brake: Math.max(0, Math.min(1, gi.brake + ki.brake)),
    };
  }

  /** Returns auxiliary inputs (horn, lights, look), merging wheel and keyboard. */
  getAuxInputs(): AuxInputs {
    const kAux = this.keyboard.getAux();
    if (!this.gamepad.isConnected()) return kAux;

    const gAux = this.gamepad.getAux();
    if (!gAux) return kAux;

    return {
      horn: kAux.horn || gAux.horn,
      toggleLights: kAux.toggleLights || gAux.toggleLights,
      lookLeft: kAux.lookLeft || gAux.lookLeft,
      lookRight: kAux.lookRight || gAux.lookRight,
      lookBack: kAux.lookBack || gAux.lookBack,
    };
  }

  applyRumble(intensity: number): void {
    this.gamepad.applyRumble(intensity);
  }
}