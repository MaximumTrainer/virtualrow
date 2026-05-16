## Summary
Implement the Workout Generator experience in VirtualRow so users can select structured workouts, start them on any route, follow segment-by-segment targets (pace/power/HR/cadence), and complete workouts with automatic progression and real-time compliance feedback.

## Problem
Users need guided rowing workouts (warmup/work/interval/rest/cooldown) similar to structured cycling training tools. Current experience needs complete implementation across workout selection, execution, progress tracking, target feedback, and workout import from intervals.icu.

## Goals
- Support structured workouts with segment-level targets.
- Provide real-time feedback on whether rower metrics are on target.
- Auto-progress through workout segments by time or distance.
- Allow importing workouts from intervals.icu into workout library.
- Ensure workouts work consistently across different workout styles.

## Functional Requirements

### 1) Workout Library & Selection
- Add a Workouts tab listing:
  - Prebuilt workouts (for example, steady state and pyramid intervals).
  - Imported workouts from intervals.icu.
- Show workout metadata: name, total duration/distance, segment count.
- Allow selecting one workout as the active workout for next session.
- Persist selected workout across navigation/session as appropriate.

### 2) Workout Start Flow
- From Routes tab, user can start a route session with selected structured workout.
- Structured workout overlays route/free-row with segment targets and progression.
- If no workout selected, app behavior remains unchanged (normal row session).

### 3) Segment Model & Types
- Support segment types:
  - `warmup`, `work`, `interval`, `rest`, `cooldown`
- Each segment supports:
  - Duration (seconds) or Distance (meters)
  - Optional target metrics:
    - Pace min/max (sec/500m)
    - Power target/range
    - Heart-rate min/max
    - Cadence target/range
  - Intensity zone metadata for color coding.

### 4) Real-Time Workout Execution
- Display overlay with:
  - Overall workout progress (%)
  - Current segment type/name
  - Segment progress bar
  - Current target values
  - Timeline of all segments with current position
- Auto-advance to next segment when completion condition met:
  - Time-based segment: elapsed >= duration
  - Distance-based segment: distance >= target meters
- End workout cleanly after final segment completion.

### 5) Compliance Feedback
- Evaluate PM5 live metrics at regular interval (for example, every second).
- Show compliance state:
  - On Target (green)
  - Too Fast (orange/up)
  - Too Slow (orange/down)
- Compliance must consider configured metric targets for current segment.
- Handle missing metrics gracefully (do not crash; use available metrics).

### 6) Intensity & Visualization
- Apply color coding for segment intensity zones in timeline/overlay.
- Adjust 3D rowing visualization speed/intensity behavior based on current segment intensity.

### 7) intervals.icu Import
- Provide import workflow requiring:
  - API Key
  - Athlete ID
  - Workout ID
- Fetch workout and map to internal segment model:
  - Steps/intervals -> segments
  - Preserve targets where available (pace/power/HR/cadence)
  - Expand repeats into concrete segments
- Add imported workout to workout library.
- Show clear import failure reasons for invalid credentials, missing workout, or network/API issues.

### 8) Error Handling
- If PM5 disconnects during workout, show clear status and pause/handle progression safely.
- If segment data is invalid (no duration/distance), prevent start and show validation message.
- If imported targets are incompatible/unavailable, fallback gracefully and inform user.

## Acceptance Criteria
- [ ] User can view workout library with prebuilt and imported workouts.
- [ ] User can select a workout and start it from Routes flow.
- [ ] Workout runs through all segment types (`warmup/work/interval/rest/cooldown`) correctly.
- [ ] Time-based segments auto-complete by elapsed time.
- [ ] Distance-based segments auto-complete by covered distance.
- [ ] Overlay shows overall progress, segment progress, targets, and timeline.
- [ ] Compliance indicator updates live and reflects on-target/too-fast/too-slow states.
- [ ] Intensity zone color coding is visible and consistent with segment metadata.
- [ ] intervals.icu import succeeds with valid credentials/workout ID and creates usable workout.
- [ ] intervals.icu import failures show actionable errors without crashing.
- [ ] Workout completion state is handled correctly after final segment.
- [ ] Non-workout rowing flow remains unaffected when no workout is selected.

## Test Verification Steps

### A. Steady State Workout (primarily Zone 2/Work)
1. Open Workouts tab and select a steady-state workout.
2. Start session on any route with PM5 connected.
3. Verify single long work segment appears with expected pace/power/HR/cadence targets.
4. Row below target, at target, and above target.
5. Confirm compliance indicator switches correctly (too slow/on target/too fast).
6. Confirm segment/workout completes at expected duration or distance.

### B. Pyramid Intervals Workout (work/rest repeats)
1. Select pyramid interval workout (warmup + repeated intervals + rest + cooldown).
2. Start workout session.
3. Verify segment order and durations match workout definition.
4. At each transition, confirm auto-advance and UI updates current segment.
5. Verify rest segments use recovery targets and compliance reflects easier targets.
6. Confirm final cooldown completes and workout ends cleanly.

### C. High-Intensity Interval Workout (Zone 4/5 intervals)
1. Select workout containing short hard intervals.
2. During interval segment, exceed/undershoot targets intentionally.
3. Verify compliance changes promptly and consistently.
4. Confirm intensity color/visual cues represent high-intensity zones.
5. Validate progression across repeated hard/rest blocks.

### D. Distance-Based Segment Workout
1. Use/select workout with at least one segment defined by meters (not time).
2. Start session and row until distance target is reached.
3. Verify segment does not advance early by time alone.
4. Confirm transition occurs immediately on distance completion.
5. Repeat for another distance segment if present.

### E. intervals.icu Imported Workout
1. Import a valid workout using API key, athlete ID, and workout ID.
2. Confirm imported workout appears in library with expected metadata.
3. Start imported workout and validate segment structure and targets.
4. Verify repeated blocks are expanded and executed correctly.
5. Run negative tests:
   - Invalid API key
   - Wrong athlete ID
   - Non-existent workout ID
   - Network/API failure
6. Confirm each failure path shows clear error message and app remains stable.

### F. Resilience / Edge Cases
1. Disconnect PM5 mid-workout.
2. Verify app displays device/data issue and handles progression safely.
3. Attempt to start workout with invalid segment config (missing duration and distance).
4. Confirm start is blocked with validation error.
5. Start route without selected workout and confirm normal rowing behavior unchanged.

## Notes
- Keep architecture aligned with existing hexagonal boundaries: domain/application ports must stay independent of infrastructure adapters, and new adapters must be registered through dependency injection in the composition root.
- Follow Red-Green-Refactor for workout behavior changes; add/extend tests first for progression logic, compliance logic, and import mapping, then implement to pass.
- Ensure no regressions to existing route/session flow.
