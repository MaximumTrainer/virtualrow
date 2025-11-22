# Workout Generator - User Guide

## Overview

The Workout Generator feature brings structured interval training to VirtualRow, similar to Auuki for cycling training but designed specifically for rowing. It allows you to follow structured workouts with precise target zones while rowing on your favorite water routes.

## Key Features

- **Pre-built workout templates** (pyramid intervals, steady state, etc.)
- **intervals.icu integration** - Import workouts from your existing training plans
- **Real-time progress tracking** with visual segment indicators
- **Target zones** for pace, power, and heart rate
- **Automatic pacing feedback** - know when you're on/off target
- **Dynamic visualization** - 3D view speed adjusts based on workout intensity

## Getting Started

### 1. Browse Available Workouts

Navigate to the **Workouts** tab (💪) in the sidebar. You'll see:
- Pre-loaded sample workouts
- Imported workouts from intervals.icu
- Workout details including duration, distance, and segment count

### 2. Import from intervals.icu (Optional)

If you use intervals.icu for training planning:

1. Click **"Import from intervals.icu"** button
2. Enter your credentials:
   - **API Key**: Get from intervals.icu → Settings → API
   - **Athlete ID**: Found in your intervals.icu profile URL
   - **Workout ID**: The ID of the specific workout to import
3. Click **Import**
4. The workout will be added to your library

### 3. Select a Workout

Click on any workout card to select it. Selected workouts are highlighted in blue. The workout will be used for your next session.

### 4. Start a Workout Session

1. Go to the **Routes** tab
2. Select a water route
3. Connect your PM5 device
4. Click **"Start Workout"**
5. The app will combine the selected route with your structured workout

## During Your Workout

### Workout Progress Display

The workout progress panel shows (top-left overlay):

1. **Overall Progress** - Percentage completion of entire workout
2. **Current Segment** - Type (warmup, work, rest, cooldown) with color coding
3. **Target Metrics** - Specific targets for current segment:
   - Pace range (seconds per 500m)
   - Power target (watts)
   - Heart rate zone (bpm)
   - Cadence (strokes per minute)
4. **Segment Progress Bar** - Visual completion of current interval
5. **Target Compliance Indicator**:
   - ✓ **Green "On Target"** - You're meeting the target metrics
   - ↑ **Orange "Too Fast"** - Slow down to meet targets
   - ↓ **Orange "Too Slow"** - Speed up to meet targets
6. **Workout Timeline** - Visual bar showing all segments with current position marked

### Understanding Segment Types

- 🟢 **Warmup** (Zone 1) - Easy, comfortable pace to prepare
- 🔵 **Work** (Zone 2-3) - Steady state or moderate intensity
- 🟡 **Interval** (Zone 4-5) - High intensity efforts
- 🟠 **Rest/Recovery** - Active recovery between intervals
- 🟣 **Cooldown** (Zone 1) - Easy pace to finish

### Color-Coded Intensity Zones

| Color | Intensity | Description |
|-------|-----------|-------------|
| Light Green | Recovery | Very easy, conversational pace |
| Sky Blue | Zone 1 | Easy aerobic, warmup pace |
| Yellow | Zone 2 | Moderate aerobic, steady state |
| Orange | Zone 3 | Tempo pace, controlled discomfort |
| Red-Orange | Zone 4 | Threshold/VO2max, hard effort |
| Red | Zone 5 | Maximum effort, short bursts |
| Dark Red | Max | All-out sprint |

### Automatic Progression

The app automatically advances to the next segment when:
- Time-based segments: Target duration is reached
- Distance-based segments: Target distance is completed

## Workout Structure

### Sample Workout: 20min Pyramid Intervals

```
1. Warmup (5 min)          - Zone 1, Pace: 135-145s/500m
2. Work Interval (4 min)   - Zone 4, Pace: 105-115s/500m
3. Rest (1 min)            - Recovery, Pace: 140-155s/500m
4. Work Interval (4 min)   - Zone 4, Pace: 105-115s/500m
5. Rest (1 min)            - Recovery, Pace: 140-155s/500m
6. Work Interval (4 min)   - Zone 4, Pace: 105-115s/500m
7. Rest (1 min)            - Recovery, Pace: 140-155s/500m
8. Work Interval (4 min)   - Zone 4, Pace: 105-115s/500m
9. Cooldown (5 min)        - Zone 1, Pace: 135-150s/500m
```

### Creating Custom Workouts

While the UI doesn't yet support creating workouts, you can:
1. Create workouts in intervals.icu and import them
2. Modify the sample workouts in the code
3. Use the intervals.icu workout builder then import

## intervals.icu Integration

### What is intervals.icu?

intervals.icu is a popular training planning and analysis platform for endurance athletes. It allows you to create, schedule, and track structured workouts.

### How Integration Works

VirtualRow imports workouts from intervals.icu and converts them to rowing-specific formats:

1. **Workout Structure** - Steps/intervals are mapped to segments
2. **Target Metrics** - Power, pace, and heart rate targets are preserved
3. **Intensity Zones** - Converted to rowing-specific zones
4. **Repeats** - Automatically expanded into individual segments

### Getting Your API Credentials

1. Go to [intervals.icu](https://intervals.icu)
2. Log in to your account
3. Navigate to **Settings** → **API**
4. Click **"Generate API Key"**
5. Copy the key and your **Athlete ID** (from profile URL)

### Finding Workout IDs

1. Open any workout in intervals.icu
2. Look at the URL: `intervals.icu/activities/i12345678`
3. The workout ID is the number after `/i` (e.g., `12345678`)

## Tips for Success

### 1. Set Realistic Targets

- Start with easier workouts to learn the system
- Adjust targets based on your fitness level
- Consider your PM5 drag factor settings

### 2. Focus on Compliance

- Green "On Target" means you're training effectively
- Don't chase faster paces during recovery segments
- Trust the workout structure

### 3. Use Routes Wisely

- Longer routes for longer workouts
- Any route works - workout segments override free rowing
- Route visualization adds immersion without affecting targets

### 4. Monitor Multiple Metrics

- Pace is primary for rowing
- Power provides consistency feedback
- Heart rate validates effort level
- Cadence maintains technique

### 5. Progressive Overload

- Start with steady state workouts
- Progress to interval work
- Build volume before intensity

## Technical Details

### Segment Types

```typescript
type SegmentType = 'warmup' | 'work' | 'rest' | 'cooldown' | 'interval';
```

### Target Metrics

Each segment can have:
- **Pace Range** - Min/max seconds per 500m
- **Target Power** - Watts (±10% tolerance)
- **Heart Rate Zone** - Min/max BPM
- **Cadence** - Target strokes per minute
- **Duration** - Time in seconds OR
- **Distance** - Meters to complete

### Compliance Calculation

The app checks if your current PM5 metrics fall within target ranges:
- **On Target** - All metrics within specified ranges
- **Too Fast/Slow** - Deviation shown as percentage
- Updates every second based on PM5 data

## Troubleshooting

### Workout Not Progressing

- Ensure PM5 is connected and transmitting data
- Check that distance or time is increasing
- Verify workout has valid segment durations/distances

### Import Failed

- Verify API key is correct and not expired
- Check athlete ID matches your intervals.icu profile
- Ensure workout ID exists and you have access
- Check network connection for API requests

### Targets Don't Make Sense

- intervals.icu workouts may be cycling-specific
- Convert cycling power to rowing power (generally lower)
- Adjust pace expectations for rowing vs running
- Consider your personal fitness zones

### Progress Display Not Showing

- Ensure a structured workout is selected
- Check that workout started successfully
- Verify workout has segments with targets

## Future Enhancements

Planned features for workout generator:

- [ ] Workout builder UI (create custom workouts in-app)
- [ ] Two-way sync with intervals.icu
- [ ] Automatic workout scheduling based on training plan
- [ ] TrainingPeaks integration
- [ ] Audio cues for segment transitions
- [ ] Real-time coaching feedback
- [ ] Workout sharing and community library
- [ ] AI-generated workout suggestions
- [ ] Adaptive workouts based on performance

## Resources

- [intervals.icu Documentation](https://forum.intervals.icu/t/intervals-icu-api/3)
- [Concept2 Pace Calculator](https://www.concept2.com/indoor-rowers/training/calculators/pace-calculator)
- [Rowing Training Zones](https://www.concept2.com/indoor-rowers/training/tips-and-general-info/training-zones)
- [VirtualRow GitHub Repository](https://github.com/MaximumTrainer/virtualrow)

## Feedback

Have suggestions for the workout generator? Open an issue on GitHub or contribute improvements via pull request!

---

**Happy Training! 🚣💪**
