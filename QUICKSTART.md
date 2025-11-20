# 🚣 VirtualRow Quick Start Guide

## Installation & Running

```bash
# Install dependencies (if not already done)
npm install

# Start development server
npm run dev

# Open http://localhost:5173/ in your browser
```

## First Run Walkthrough

### 1. **Browse Water Routes** (Routes Tab)
- View 5 pre-loaded scenic water routes
- Each route shows:
  - Interactive map with route path
  - Distance and estimated time
  - Difficulty level (Easy/Moderate/Hard)
  - Terrain and location info
- Click on any route card to select it

### 2. **Connect Your Concept2 PM5** (Device Panel)
- Click the blue **"Connect PM5"** button
- Browser will ask permission to scan for Bluetooth devices
- Select your "PM5" or "Rower" device from the list
- Once connected, you'll see:
  - ● Green "Connected" status
  - Real-time metrics (pace, distance, time, power, cadence, heart rate)

### 3. **Start a Workout** (Routes Tab)
- Select your desired water route
- Make sure PM5 is connected (green status)
- Click **"▶ Start Workout"** button
- You'll be taken to the Workout tab

### 4. **Row Your Workout** (Workout Tab)
- Large display shows:
  - Current pace (seconds per 500m)
  - Distance rowed (km)
  - Elapsed time
  - Power (watts)
  - Cadence (strokes per minute)
  - Heart rate (if available)
- These metrics update in real-time from your PM5
- Row as normal on your Concept2!

### 5. **End Workout & Review** (Workout Tab)
- When done, click **"⏹ End Workout"**
- Workout is saved automatically
- View it in the History tab

### 6. **Review Workout History** (History Tab)
- See all completed workouts
- Shows for each:
  - Route name and date
  - Distance, time, pace
  - Calories burned
  - Sorted by most recent first
- View aggregated stats:
  - Total workouts
  - Total distance
  - Total time

## Menu Navigation

### Left Sidebar
- **🗺️ Routes**: Browse and select water routes
- **⏱️ Workout**: Active workout monitoring (only during session)
- **📊 History**: Past workouts and overall statistics

### Device Panel
- Shows PM5 connection status
- Real-time metrics when connected
- Connect/Disconnect button

### Statistics Panel
- Workouts count
- Total distance rowed
- Total time spent rowing

## Key Metrics Explained

| Metric | Unit | What It Means |
|--------|------|---------------|
| **Pace** | s/500m | Time to row 500 meters |
| **Distance** | km | Total distance rowed |
| **Time** | h:m:s | Elapsed workout time |
| **Power** | watts | Your current output |
| **Cadence** | spm | Strokes per minute |
| **Heart Rate** | bpm | Heartbeats per minute |
| **Calories** | kcal | Energy burned |

## Tips for Best Results

### ✅ Do's
- Make sure PM5 is powered on before connecting
- Keep Bluetooth device within 10 meters
- Row with steady strokes for accurate data
- Close other Bluetooth connections
- Use Chrome/Edge for best compatibility

### ❌ Don'ts
- Don't turn off PM5 mid-workout
- Don't get too far from your device
- Don't have too many browser tabs open
- Don't use Firefox Safari without workarounds
- Don't disable JavaScript (needed for Web Bluetooth)

## Troubleshooting

### PM5 Won't Connect
1. Ensure PM5 is powered on (check battery)
2. Verify Bluetooth is enabled on your device
3. Make sure it's close (within 10m)
4. Try refreshing the page and connecting again
5. Restart your browser

### Map Not Showing
1. Check your internet connection
2. Wait for map tiles to load (may take a moment)
3. Zoom in/out to refresh
4. Clear browser cache and reload

### Metrics Not Updating
1. Check PM5 connection status (should be green)
2. Try disconnecting and reconnecting
3. Restart the PM5 device
4. Clear browser console errors

### Performance Issues
1. Close other browser tabs
2. Disable browser extensions
3. Clear browser cache
4. Try a different browser
5. Check internet connection

## Supported Browsers

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | ✅ Full | Recommended |
| Edge | ✅ Full | Chromium-based, works well |
| Opera | ✅ Full | Chromium-based |
| Samsung Internet | ✅ Full | Mobile |
| Firefox | ⚠️ Experimental | May require flags |
| Safari | ❌ No | Use workaround apps |

## Water Routes Reference

### 🏔️ Lake Tahoe Circuit
- Distance: 28.5 km
- Difficulty: Hard
- Time: ~180 minutes
- Best for: Long-distance training

### 🏙️ Central Park Loop
- Distance: 2.4 km
- Difficulty: Easy
- Time: ~30 minutes
- Best for: Warm-up/cool-down

### 🌉 Thames River Challenge
- Distance: 12.8 km
- Difficulty: Moderate
- Time: ~90 minutes
- Best for: Steady-state workouts

### 🌋 Crater Lake Explorer
- Distance: 7.7 km
- Difficulty: Moderate
- Time: ~60 minutes
- Best for: Recovery rows

### ⚡ Finger Lakes Sprint
- Distance: 8.2 km
- Difficulty: Hard
- Time: ~55 minutes
- Best for: High-intensity intervals

## Keyboard Shortcuts

- **No shortcuts yet** (future enhancement)

## Data Storage

- All workouts stored in browser memory
- Data persists between sessions
- No account required
- No data sent to servers
- Export available in future updates

## Advanced Features (Planned)

- 📊 Workout analytics charts
- 🏆 Leaderboards
- 👥 Social sharing
- 📱 Mobile app
- 🗓️ Training programs
- 💾 Cloud sync

## Getting Help

1. **Check Console**: Press F12 to see console for errors
2. **Read README.md**: Full technical documentation
3. **Browser Compatibility**: Verify you're on supported browser
4. **GitHub Issues**: Report bugs or request features

---

## That's It! 🎉

You're ready to start rowing! Remember to:
1. ✅ Connect your PM5
2. ✅ Select a route
3. ✅ Start your workout
4. ✅ Row!

**Happy Rowing!** 🚣⛵
