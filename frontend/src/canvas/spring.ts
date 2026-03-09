/**
 * Spring Physics Engine — damped harmonic oscillator for GPU-driven animations.
 *
 * Used by SceneManager for drop animations, drag lift/release, delete fade-out,
 * group/ungroup, and inbox zone slide-in.
 *
 * Physics: F = -stiffness * displacement - damping * velocity
 *          a = F / mass
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
  precision: number;
}

const DEFAULT_CONFIG: SpringConfig = {
  stiffness: 180,
  damping: 12,
  mass: 1,
  precision: 0.01,
};

export const PRESETS = {
  drop:   { stiffness: 180, damping: 12, mass: 1, precision: 0.01 },
  gentle: { stiffness: 120, damping: 14, mass: 1, precision: 0.01 },
  snappy: { stiffness: 300, damping: 20, mass: 1, precision: 0.01 },
  bounce: { stiffness: 200, damping:  8, mass: 1, precision: 0.01 },
} as const satisfies Record<string, SpringConfig>;

export type PresetName = keyof typeof PRESETS;

// ---------------------------------------------------------------------------
// Spring
// ---------------------------------------------------------------------------

export class Spring {
  private _value: number;
  private _target: number;
  private _velocity: number = 0;
  private _done: boolean = false;

  private readonly _config: SpringConfig;

  /** Called every tick with the current value. */
  onUpdate: ((value: number) => void) | null = null;

  /** Called once when the spring settles (snaps to target). */
  onComplete: (() => void) | null = null;

  constructor(initial: number, target: number, config?: Partial<SpringConfig>) {
    this._value = initial;
    this._target = target;
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // -- Public accessors -----------------------------------------------------

  get value(): number {
    return this._value;
  }

  get target(): number {
    return this._target;
  }

  set target(t: number) {
    this._target = t;
    this._done = false;
  }

  get velocity(): number {
    return this._velocity;
  }

  get done(): boolean {
    return this._done;
  }

  // -- Simulation -----------------------------------------------------------

  /**
   * Advance the simulation by `dt` seconds.
   *
   * Uses semi-implicit Euler integration which is cheap, stable enough for
   * UI springs, and deterministic for a given dt.
   */
  tick(dt: number): void {
    if (this._done) return;

    const { stiffness, damping, mass, precision } = this._config;

    const displacement = this._value - this._target;

    // F = -k * x - c * v
    const force = -stiffness * displacement - damping * this._velocity;
    const acceleration = force / mass;

    // Semi-implicit Euler: update velocity first, then position.
    this._velocity += acceleration * dt;
    this._value += this._velocity * dt;

    // Settle check
    if (Math.abs(this._velocity) < precision && Math.abs(this._value - this._target) < precision) {
      this._value = this._target;
      this._velocity = 0;
      this._done = true;
      this.onUpdate?.(this._value);
      this.onComplete?.();
      return;
    }

    this.onUpdate?.(this._value);
  }
}

// ---------------------------------------------------------------------------
// SpringManager
// ---------------------------------------------------------------------------

export class SpringManager {
  private _springs: Set<Spring> = new Set();

  /** Register a spring and return it for chaining. */
  add(spring: Spring): Spring {
    this._springs.add(spring);
    return spring;
  }

  /** Advance all springs by `dt` seconds, removing settled ones. */
  tick(dt: number): void {
    for (const spring of this._springs) {
      spring.tick(dt);
      if (spring.done) {
        this._springs.delete(spring);
      }
    }
  }

  /** Number of currently active (unsettled) springs. */
  get active(): number {
    return this._springs.size;
  }
}
