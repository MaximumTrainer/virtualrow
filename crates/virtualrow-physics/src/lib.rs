use wasm_bindgen::prelude::*;

// ──────────────────────────────────────────────────────────────────────────────
// Physics constants — single scull (FISA legal)
// ──────────────────────────────────────────────────────────────────────────────
const MASS_BOAT_KG: f64 = 14.0; // FISA minimum single scull
const MASS_ROWER_KG: f64 = 80.0; // Representative rower mass

// Hydrodynamic drag coefficient calibrated to Concept2 pace tables.
// Concept2's power-speed relationship: P = k_drag * v³
// At 200 W → v = 4.17 m/s (2:00/500m):
//   k_drag = 200 * 0.85 / (4.17³) ≈ 2.34  (efficiency × watts / v³)
// F_drag = k_drag * v²  (quadratic hull drag)
const K_DRAG: f64 = 2.34;

// Mechanical efficiency of converting erg watts to hull propulsion.
const DRIVE_EFFICIENCY: f64 = 0.85;

// Fraction of stroke cycle that is the drive (propulsive) phase — for animation.
const DRIVE_RATIO: f64 = 0.35;

// Minimum velocity for power-to-force division.
const V_MIN: f64 = 0.1;

// ──────────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────────

/// Current rowing stroke phase (used for oar/body animation on the JS side).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StrokePhase {
    Catch,
    Drive,
    Finish,
    Recovery,
}

/// Snapshot of boat physics state returned to JavaScript each tick.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct BoatState {
    /// Hull speed in metres per second.
    pub velocity_mps: f64,
    /// Cumulative distance travelled in metres.
    pub position_m: f64,
    /// Current stroke phase (Catch | Drive | Finish | Recovery).
    pub stroke_phase: StrokePhase,
    /// Normalised position within the current stroke cycle [0.0, 1.0).
    pub stroke_cycle_t: f64,
    /// Acceleration in m/s² (positive = forward).
    pub acceleration: f64,
}

/// Real-time metrics received from the PM5 / erg simulator.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct RowingMetrics {
    /// Power output in Watts.
    pub watts: f64,
    /// Stroke rate in strokes per minute.
    pub spm: f64,
    /// Distance covered according to the PM5 (metres).
    pub pm5_distance_m: f64,
}

#[wasm_bindgen]
impl RowingMetrics {
    #[wasm_bindgen(constructor)]
    pub fn new(watts: f64, spm: f64, pm5_distance_m: f64) -> RowingMetrics {
        RowingMetrics { watts, spm, pm5_distance_m }
    }
}

/// Tunable physics configuration (all values have sensible defaults via `PhysicsConfig::new`).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct PhysicsConfig {
    pub mass_boat_kg: f64,
    pub mass_rower_kg: f64,
    pub k_drag: f64,
    pub drive_ratio: f64,
    pub drive_efficiency: f64,
}

#[wasm_bindgen]
impl PhysicsConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> PhysicsConfig {
        PhysicsConfig {
            mass_boat_kg: MASS_BOAT_KG,
            mass_rower_kg: MASS_ROWER_KG,
            k_drag: K_DRAG,
            drive_ratio: DRIVE_RATIO,
            drive_efficiency: DRIVE_EFFICIENCY,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Physics engine
// ──────────────────────────────────────────────────────────────────────────────

/// Main physics engine.  Instantiate once; call `tick` every animation frame.
///
/// **Physics design:**
/// Propulsive force is computed from *average* erg power (continuous model).
/// This matches the Concept2 PM5 power-to-speed relationship used by coaches.
/// Stroke phase is tracked *separately* and returned purely for animation purposes
/// (oar sweep, body rock, seat travel) — it does not gate the force calculation.
#[wasm_bindgen]
pub struct PhysicsEngine {
    cfg: PhysicsConfig,
    velocity: f64,
    position: f64,
    stroke_cycle_t: f64,
}

#[wasm_bindgen]
impl PhysicsEngine {
    /// Create a new engine with the supplied (or default) config.
    #[wasm_bindgen(constructor)]
    pub fn new(cfg: PhysicsConfig) -> PhysicsEngine {
        PhysicsEngine {
            cfg,
            velocity: 0.0,
            position: 0.0,
            stroke_cycle_t: 0.0,
        }
    }

    /// Advance physics by `dt` seconds given current rowing metrics.
    pub fn tick(&mut self, dt: f64, metrics: &RowingMetrics) -> BoatState {
        let total_mass = self.cfg.mass_boat_kg + self.cfg.mass_rower_kg;

        // ── Stroke animation cycle ───────────────────────────────────────────
        let spm = metrics.spm.max(1.0);
        let stroke_period_s = 60.0 / spm;
        self.stroke_cycle_t = (self.stroke_cycle_t + dt / stroke_period_s).fract();
        let stroke_phase = classify_phase(self.stroke_cycle_t, self.cfg.drive_ratio);

        // ── Propulsive force (continuous average-power model) ────────────────
        // F_prop = P_effective / v  where P_effective = watts × drive_efficiency.
        // Using average power keeps steady-state velocity aligned with Concept2
        // pace tables regardless of stroke rate.
        let v_for_div = self.velocity.max(V_MIN);
        let f_prop = (metrics.watts * self.cfg.drive_efficiency) / v_for_div;

        // ── Hydrodynamic drag (quadratic) ────────────────────────────────────
        let f_drag = -self.cfg.k_drag * self.velocity * self.velocity.abs();

        // ── Euler integration ────────────────────────────────────────────────
        let f_net = f_prop + f_drag;
        let acceleration = f_net / total_mass;
        self.velocity = (self.velocity + acceleration * dt).max(0.0);
        self.position += self.velocity * dt;

        BoatState {
            velocity_mps: self.velocity,
            position_m: self.position,
            stroke_phase,
            stroke_cycle_t: self.stroke_cycle_t,
            acceleration,
        }
    }

    /// Reset engine to initial state (e.g., new workout session).
    pub fn reset(&mut self) {
        self.velocity = 0.0;
        self.position = 0.0;
        self.stroke_cycle_t = 0.0;
    }

    /// Current state without advancing time.
    pub fn get_state(&self) -> BoatState {
        BoatState {
            velocity_mps: self.velocity,
            position_m: self.position,
            stroke_phase: classify_phase(self.stroke_cycle_t, self.cfg.drive_ratio),
            stroke_cycle_t: self.stroke_cycle_t,
            acceleration: 0.0,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Map normalised stroke cycle position [0, 1) to a named phase.
///
/// Layout (drive_ratio = 0.35):
///   [0.00, 0.05) → Catch
///   [0.05, 0.35) → Drive
///   [0.35, 0.40) → Finish
///   [0.40, 1.00) → Recovery
fn classify_phase(t: f64, drive_ratio: f64) -> StrokePhase {
    let catch_end = 0.05_f64;
    let drive_end = drive_ratio;
    let finish_end = drive_ratio + 0.05_f64;

    if t < catch_end {
        StrokePhase::Catch
    } else if t < drive_end {
        StrokePhase::Drive
    } else if t < finish_end {
        StrokePhase::Finish
    } else {
        StrokePhase::Recovery
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests
// ──────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn default_engine() -> PhysicsEngine {
        PhysicsEngine::new(PhysicsConfig::new())
    }

    /// At 200 W steady-state, boat velocity should converge to ≈ 4.17 m/s (2:00/500m).
    /// Derivation: F_prop = F_drag → P*η/v = k*v² → v = (P*η/k)^(1/3)
    ///   = (200 * 0.85 / 2.34)^(1/3) = (72.65)^(1/3) ≈ 4.17 m/s
    #[test]
    fn steady_state_velocity_200w() {
        let mut engine = default_engine();
        let metrics = RowingMetrics { watts: 200.0, spm: 20.0, pm5_distance_m: 0.0 };
        // Run 120 virtual seconds to reach steady state (10 s at 60 fps equivalent).
        for _ in 0..12000 {
            engine.tick(0.01, &metrics);
        }
        let v = engine.velocity;
        // Allow ±0.25 m/s tolerance (~6% at 4.17 m/s).
        assert!(
            (v - 4.17).abs() < 0.25,
            "Expected ~4.17 m/s at 200W, got {v:.3} m/s"
        );
    }

    /// With zero power, a moving boat decelerates via quadratic drag.
    /// At v=4 m/s with k_drag=2.34, m=94kg:  v(t) = 1 / (k/m·t + 1/v₀)
    /// v(60s) ≈ 0.60 m/s  — boat slows noticeably but doesn't stop instantly.
    #[test]
    fn zero_power_deceleration() {
        let mut engine = default_engine();
        engine.velocity = 4.0;
        let metrics = RowingMetrics { watts: 0.0, spm: 20.0, pm5_distance_m: 0.0 };
        // Simulate 60 virtual seconds.
        for _ in 0..6000 {
            engine.tick(0.01, &metrics);
        }
        // Velocity must have dropped significantly from 4.0 m/s.
        assert!(
            engine.velocity < 1.5,
            "Expected velocity < 1.5 m/s after 60s coast; got {:.3} m/s",
            engine.velocity
        );
        // Must still be positive (boat can't go backwards).
        assert!(engine.velocity >= 0.0, "Velocity went negative");
    }

    /// Position must increase monotonically when power > 0.
    #[test]
    fn position_increases_with_power() {
        let mut engine = default_engine();
        let metrics = RowingMetrics { watts: 150.0, spm: 22.0, pm5_distance_m: 0.0 };
        let mut last_pos = 0.0_f64;
        for _ in 0..100 {
            let state = engine.tick(0.1, &metrics);
            assert!(state.position_m >= last_pos, "Position went backwards");
            last_pos = state.position_m;
        }
    }

    /// Stroke phases must cycle in the correct order.
    #[test]
    fn stroke_phase_cycle() {
        let phases: Vec<StrokePhase> = (0..100)
            .map(|i| classify_phase(i as f64 / 100.0, DRIVE_RATIO))
            .collect();
        let first_catch    = phases.iter().position(|p| *p == StrokePhase::Catch).unwrap();
        let first_drive    = phases.iter().position(|p| *p == StrokePhase::Drive).unwrap();
        let first_finish   = phases.iter().position(|p| *p == StrokePhase::Finish).unwrap();
        let first_recovery = phases.iter().position(|p| *p == StrokePhase::Recovery).unwrap();
        assert!(first_catch < first_drive);
        assert!(first_drive < first_finish);
        assert!(first_finish < first_recovery);
    }

    /// reset() must clear velocity and position.
    #[test]
    fn reset_clears_state() {
        let mut engine = default_engine();
        engine.velocity = 3.5;
        engine.position = 1000.0;
        engine.reset();
        assert_eq!(engine.velocity, 0.0);
        assert_eq!(engine.position, 0.0);
    }
}