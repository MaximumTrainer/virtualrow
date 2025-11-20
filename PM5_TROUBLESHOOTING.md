# PM5 Bluetooth Connection Troubleshooting Guide

## Issue: "No Services matching UUID ce060000-43e5-11e4-916c-0800200c9a66 found in Device"

This error occurs when the Web Bluetooth API cannot find the expected Concept2 PM5 service UUID on your rower monitor. This is typically a Bluetooth pairing or device state issue, not an application bug.

## Solutions (Try in Order)

### 1. **Power Cycle the PM5 Monitor** (Most Effective)
This is the single most effective fix for most connection issues.

```
1. Locate the power button on your Concept2 PM5 monitor
2. Turn the monitor completely OFF (wait for display to go black)
3. Wait 30-45 seconds
4. Turn the monitor back ON
5. Wait for the splash screen and normal startup sequence
6. Return to VirtualRow and try connecting again
```

### 2. **Reset Bluetooth Pairing**
Sometimes the device pairing cache becomes corrupted.

**On Windows 10/11:**
```
1. Open Settings > Bluetooth & devices
2. Find "PM5" or "Rower" in the paired devices list
3. Click on it and select "Remove device"
4. Confirm removal
5. Restart your computer (not just disconnect)
6. Restart the browser
7. Return to VirtualRow and try connecting again
```

**On macOS:**
```
1. Open System Preferences > Bluetooth
2. Find "PM5" or "Rower" in the list
3. Click the X next to it to forget the device
4. Restart your Mac
5. Restart the browser
6. Try connecting again
```

### 3. **Improve Bluetooth Signal**
Physical proximity and interference are critical factors.

- Move within **1-2 meters** (3-6 feet) of the PM5 monitor
- Move away from:
  - WiFi routers
  - Microwave ovens
  - Other BLE devices (smartwatches, fitness trackers, headphones)
  - USB 3.0 devices (can cause interference)
- Try a different location in your home if possible

### 4. **Update Firmware**
Outdated PM5 firmware can cause Bluetooth issues.

- Visit the [Concept2 website](https://www.concept2.com/)
- Check for PM5 firmware updates
- Follow their instructions to update your monitor if needed

### 5. **Browser Compatibility & Updates**
Ensure you're using a compatible browser with working Bluetooth support.

**Best supported browsers:**
- Google Chrome (v56+) - Recommended
- Microsoft Edge (v79+)
- Opera (v43+)
- Samsung Internet (v6+)

**Known limitations:**
- Firefox: Requires manual flag enabling
- Safari: Limited support, may require native bridge
- Internet Explorer: Not supported

**Fix:**
- Update your browser to the latest version
- Try using Google Chrome if having issues with other browsers

### 6. **Advanced: Check Console Logs**
For diagnostic information:

```
1. Open your browser's Developer Tools (F12 or Ctrl+Shift+I)
2. Click the "Console" tab
3. Try connecting to PM5
4. Note any detailed error messages
5. Share these messages in a bug report if the above steps don't help
```

**Example console outputs:**
```
"No services found on device" → PM5 not properly powered on
"GATT server disconnected" → Bluetooth interference or PM5 battery low
"Failed to get characteristic" → PM5 in wrong Bluetooth mode
```

## What Happens When Connection Succeeds

Once connected, you should see:
1. ✅ "Connected" status indicator changes to green
2. ✅ Real-time metrics appear (pace, distance, power, cadence)
3. ✅ The device name displays (e.g., "PM5 Monitor")
4. ✅ You can start a workout session

## Intermittent Connection Loss

If the connection drops during a workout:

1. **Brief drops (< 5 seconds):** Normal in BLE, the app will auto-reconnect
2. **Sustained loss (> 10 seconds):** 
   - Move closer to the monitor
   - Check for new WiFi interference sources
   - Consider power cycling the PM5
3. **Repeated drops:**
   - Try resetting Bluetooth pairing (see Solution #2)
   - Update PM5 firmware
   - Consider environmental factors (microwave, etc.)

## Still Not Working?

If you've tried all of the above:

1. **Test with other apps**: Try the official Concept2 app or another rower app to see if the hardware itself is working
2. **Update OS**: Ensure your operating system is up to date (Windows Update, macOS Software Update)
3. **Check Bluetooth Hardware**: 
   - Restart Bluetooth adapter: turn Bluetooth OFF and back ON
   - In Device Manager (Windows), uninstall and rescan Bluetooth devices
   - On Mac, reset NVRAM (if comfortable doing so)
4. **Report an Issue**: If nothing works, provide:
   - Exact error message
   - Browser version
   - Operating system and version
   - Console logs (see Advanced section)
   - Steps you've already tried

## Hardware Compatibility

### Tested Devices
- ✅ Concept2 PM5 (all firmware versions)
- ✅ PC with built-in Bluetooth
- ✅ Mac with built-in Bluetooth
- ✅ Bluetooth USB adapters (most work)

### Unsupported
- ❌ Very old PM3 or PM4 monitors (different Bluetooth protocol)
- ❌ Computers without Bluetooth hardware
- ❌ Some Virtual Machines (Bluetooth passthrough not supported)

## Background: Why This Error Occurs

The Web Bluetooth API requires devices to advertise their GATT services during the connection handshake. If:

1. **PM5 isn't powered on** → No service advertisement
2. **PM5 is pairing with another device** → Service not advertised
3. **Bluetooth cache is corrupted** → Services appear unavailable
4. **Device is low on battery** → May not advertise services
5. **Interference is too high** → Connection drops before services load

VirtualRow now includes fallback detection and better error messages to help identify which scenario applies to your situation.

## Questions?

Check the main README.md file for additional troubleshooting or browse the application's Help section for more information.
