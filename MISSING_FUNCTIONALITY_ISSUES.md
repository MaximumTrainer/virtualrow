# Missing Functionality Issues

This document outlines GitHub issues that should be created based on a review of the VirtualRow documentation versus the actual implementation. Each section below represents a suggested GitHub issue.

---

## Issue 1: Add Workouts Tab to Main Navigation

**Title:** Add "💪 Workouts" tab to main navigation sidebar

**Labels:** `enhancement`, `ui`

**Description:**
The README.md documentation (lines 341-355) states:
> 1. **Navigate to the Workouts tab** - Click the "💪 Workouts" tab in the sidebar
> 2. **Browse available workouts** - View pre-built workout templates

However, the current implementation in `App.tsx` only has three navigation tabs:
- 🗺️ Routes
- ⏱️ Workout
- 📊 History

**Acceptance Criteria:**
- [ ] Add a "💪 Workouts" tab to the sidebar navigation in `App.tsx`
- [ ] Clicking the tab should show the WorkoutGenerator component
- [ ] Tab should be positioned between Routes and Workout tabs

**Files to modify:**
- `src/App.tsx`
- `src/App.css` (if needed for styling)

---

## Issue 2: Integrate WorkoutGenerator Component into App

**Title:** Integrate WorkoutGenerator component into main application

**Labels:** `enhancement`, `ui`

**Description:**
The `WorkoutGenerator` component (`src/components/WorkoutGenerator.tsx`) exists and provides functionality for:
- Browsing pre-built workout templates
- Importing workouts from intervals.icu
- Selecting workouts for sessions

However, this component is not integrated into `App.tsx` and is therefore not accessible to users.

**Acceptance Criteria:**
- [ ] Import and render `WorkoutGenerator` component in App.tsx
- [ ] Add state management for selected structured workout
- [ ] Connect workout selection to the workout start flow
- [ ] Show selected workout info before starting a session

**Files to modify:**
- `src/App.tsx`

---

## Issue 3: Display WorkoutProgressDisplay During Active Workout

**Title:** Show workout progress display during structured workout sessions

**Labels:** `enhancement`, `ui`

**Description:**
The `WorkoutProgressDisplay` component (`src/components/WorkoutProgressDisplay.tsx`) provides real-time feedback during structured workouts including:
- Current segment type and targets
- Segment progress bar
- On/off target indicator
- Workout structure timeline

Per README.md (lines 365-376):
> During a structured workout, the app displays:
> - **Segment progress bar** - Shows completion of current interval
> - **Target compliance** - Green (✓ On Target) or Orange (↑/↓ Too Fast/Slow)
> - **Workout timeline** - Visual representation of all segments

This component exists but is not rendered during active workouts in `App.tsx`.

**Acceptance Criteria:**
- [ ] Import `WorkoutProgressDisplay` in App.tsx
- [ ] Render component when a structured workout is active
- [ ] Connect to `workoutGeneratorService` for progress updates
- [ ] Position as overlay (top-left as documented in WORKOUT_GENERATOR_GUIDE.md)

**Files to modify:**
- `src/App.tsx`
- Possibly `src/App.css` for overlay positioning

---

## Issue 4: Add UI for Selecting Structured Workout Before Starting

**Title:** Allow users to select a structured workout before starting a session

**Labels:** `enhancement`, `ui`, `ux`

**Description:**
Documentation states users should be able to:
1. Select a structured workout from the Workouts tab
2. Select a route
3. Connect PM5
4. Start workout with the structured workout applied

Currently, clicking "Start Workout" starts a free-rowing session without any option to apply a structured workout.

**Acceptance Criteria:**
- [ ] Display currently selected workout (if any) on the Routes view
- [ ] Show "Clear Selection" option to remove selected workout
- [ ] When starting workout with selection, link to `workoutGeneratorService.startWorkout()`
- [ ] Pass progress updates to WorkoutProgressDisplay during session

**Files to modify:**
- `src/App.tsx`
- `src/services/workoutService.ts` (may need integration)

---

## Issue 5: Add Export Workout Data UI

**Title:** Add UI for exporting workout data as CSV/JSON

**Labels:** `enhancement`, `ui`

**Description:**
README.md (line 44) states:
> Export workout data (CSV, JSON)

The `workoutService.ts` has implemented methods:
- `exportSessionsAsJSON(): string`
- `exportSessionsAsCSV(): string`

However, there is no UI to trigger these exports.

**Acceptance Criteria:**
- [ ] Add Export buttons to History view
- [ ] "Export as CSV" button triggers download of CSV file
- [ ] "Export as JSON" button triggers download of JSON file
- [ ] Use proper file download mechanism (Blob + URL.createObjectURL)

**Files to modify:**
- `src/App.tsx` (History view section)

---

## Issue 6: Add Route Filtering UI

**Title:** Add route filtering controls (by difficulty, distance)

**Labels:** `enhancement`, `ui`

**Description:**
README.md (lines 9-10) states:
> Filter routes by difficulty, distance, and location

The `routeService.ts` has implemented methods:
- `filterRoutesByDifficulty(difficulty: string): WaterRoute[]`
- `filterRoutesByDistance(min: number, max: number): WaterRoute[]`

However, there is no UI to use these filters.

**Acceptance Criteria:**
- [ ] Add filter dropdown for difficulty (Easy, Moderate, Hard, All)
- [ ] Add distance range slider or inputs
- [ ] Apply filters to routes list in real-time
- [ ] Show number of matching routes

**Files to modify:**
- `src/App.tsx` (Routes view section)
- `src/App.css` (filter UI styling)

---

## Issue 7: Add Route Search Functionality

**Title:** Add route search input field

**Labels:** `enhancement`, `ui`

**Description:**
PROJECT_SUMMARY.md states:
> Route search functionality

The `routeService.ts` has implemented:
- `searchRoutes(query: string): WaterRoute[]`

However, there is no search input UI.

**Acceptance Criteria:**
- [ ] Add search input field above routes list
- [ ] Search by route name, location, and tags
- [ ] Real-time filtering as user types
- [ ] Clear search button

**Files to modify:**
- `src/App.tsx` (Routes view section)
- `src/App.css` (search UI styling)

---

## Issue 8: Add Personal Bests UI

**Title:** Display personal best times per route

**Labels:** `enhancement`, `ui`

**Description:**
README.md (line 49) states:
> Personal best tracking per route

The application stores workout history linked to routes, so personal bests can be calculated, but there is no UI to display them.

**Acceptance Criteria:**
- [ ] Calculate best pace for each route from workout history
- [ ] Display personal best on route details panel
- [ ] Show "New PB!" indicator after completing a workout with best time
- [ ] Optionally show PB badge on route cards in list

**Files to modify:**
- `src/App.tsx`
- `src/services/workoutService.ts` (add `getPersonalBest(routeId)` method if needed)

---

## Issue 9: Add Heart Rate Zones Analysis

**Title:** Add heart rate zones analysis and visualization

**Labels:** `enhancement`, `analytics`

**Description:**
README.md (line 51) states:
> Heart rate zones analysis

The app collects heart rate data during workouts via the HeartRateMonitor component, but there is no analysis or visualization of time spent in each HR zone.

**Acceptance Criteria:**
- [ ] Define HR zones (Zone 1-5 based on max HR or user preference)
- [ ] Calculate time/percentage spent in each zone per workout
- [ ] Display zone breakdown in workout history details
- [ ] Add optional aggregate zone analysis across all workouts

**Files to modify:**
- `src/services/workoutService.ts`
- `src/App.tsx` (History view enhancement)
- New component: `src/components/HeartRateZonesChart.tsx`

---

## Issue 10: Add Real-time Performance Graphs During Workout

**Title:** Add real-time performance graphs during active workout

**Labels:** `enhancement`, `ui`, `analytics`

**Description:**
README.md (line 43) states:
> Real-time performance graphs

Currently, only a HeartRateChart component exists. During active workouts, there should be real-time graphs for:
- Pace over time
- Power over time
- Distance progression
- Heart rate (already exists)

**Acceptance Criteria:**
- [ ] Create or extend chart component for multiple metrics
- [ ] Store time-series data during workout session
- [ ] Display mini-graphs in workout view (optional toggle)
- [ ] Use Chart.js (already a dependency)

**Files to modify:**
- `src/services/workoutService.ts` (store time-series data)
- New component: `src/components/PerformanceChart.tsx`
- `src/App.tsx` (integrate in workout view)

---

## Issue 11: Integrate Structured Workout with 3D View Speed

**Title:** Dynamic 3D view speed adjustment based on workout intensity zones

**Labels:** `enhancement`, `3d`

**Description:**
README.md (line 21) states:
> **Dynamic speed adjustment** in 3D view based on workout intensity zones

The `workoutGeneratorService.ts` has a method `getSpeedAdjustmentFactor()` that returns a speed multiplier based on current workout intensity, but this is not connected to the Rower3D component.

**Acceptance Criteria:**
- [ ] Pass intensity adjustment factor to Rower3D component
- [ ] Adjust boat animation speed based on workout zone (not just raw PM5 pace)
- [ ] Visual indication of intensity zone changes

**Files to modify:**
- `src/App.tsx`
- `src/components/Rower3D.tsx`

---

## Issue 12: Workout Compliance Tracking in History

**Title:** Track and display workout compliance metrics in history

**Labels:** `enhancement`, `analytics`

**Description:**
README.md (line 52) states:
> Workout compliance tracking (on/off target metrics)

After completing a structured workout, users should be able to see:
- Percentage of time spent on-target
- Average deviation from targets
- Per-segment compliance breakdown

**Acceptance Criteria:**
- [ ] Store compliance data in WorkoutSession when using structured workouts
- [ ] Display compliance percentage in workout history items
- [ ] Show detailed segment-by-segment compliance in expanded view
- [ ] Add compliance summary to workout stats

**Files to modify:**
- `src/types/index.ts` (extend WorkoutSession type)
- `src/services/workoutService.ts`
- `src/App.tsx` (History view)

---

## Summary

| Issue # | Title | Priority | Complexity |
|---------|-------|----------|------------|
| 1 | Add Workouts Tab | High | Low |
| 2 | Integrate WorkoutGenerator | High | Medium |
| 3 | Display WorkoutProgressDisplay | High | Medium |
| 4 | Select Structured Workout | High | Medium |
| 5 | Export Workout Data UI | Medium | Low |
| 6 | Route Filtering UI | Medium | Low |
| 7 | Route Search UI | Medium | Low |
| 8 | Personal Bests UI | Medium | Medium |
| 9 | Heart Rate Zones Analysis | Low | High |
| 10 | Real-time Performance Graphs | Low | High |
| 11 | 3D Speed from Workout Intensity | Low | Medium |
| 12 | Workout Compliance Tracking | Low | High |

---

*Generated by reviewing VirtualRow documentation (README.md, WORKOUT_GENERATOR_GUIDE.md, PROJECT_SUMMARY.md, DEVELOPMENT.md, QUICKSTART.md) against current implementation in `src/`.*
