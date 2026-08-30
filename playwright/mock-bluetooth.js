(function () {
  // Indicate we're running inside Playwright test harness so app exposes test hooks
  try { window.__PLAYWRIGHT_TESTING = true; } catch (e) { /* ignore */ }
  // Connect to simulator WS
  const port = 9001;
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.addEventListener('open', () => console.log('Simulator WS connected'));
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleSimulatorMessage(msg);
    } catch (e) {
      console.error('Failed to parse sim message', e);
    }
  });

  function buildPM5GeneralDataView({ distance = 0, elapsedTime = 0 } = {}) {
    const buf = new ArrayBuffer(11);
    const v = new Uint8Array(buf);
    const cs = Math.round(elapsedTime * 100);
    v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
    const dm = Math.round(distance * 10);
    v[3] = dm & 0xff; v[4] = (dm >> 8) & 0xff; v[5] = (dm >> 16) & 0xff;
    v[10] = 2; // strokeState = rowing
    return new DataView(buf);
  }

  function buildPM5AdditionalDataView({ elapsedTime = 0, pace = 120, cadence = 0, heartRate = 0 } = {}) {
    const buf = new ArrayBuffer(11);
    const v = new Uint8Array(buf);
    const cs = Math.round(elapsedTime * 100);
    v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
    const speedMmS = pace > 0 ? Math.round(500000 / pace) : 0;
    v[3] = speedMmS & 0xff; v[4] = (speedMmS >> 8) & 0xff;
    v[5] = Math.round(cadence);
    v[6] = Math.round(heartRate);
    const paceCs = Math.round(pace * 100);
    v[7] = paceCs & 0xff; v[8] = (paceCs >> 8) & 0xff;
    v[9] = paceCs & 0xff; v[10] = (paceCs >> 8) & 0xff;
    return new DataView(buf);
  }

  function buildHRDataView(bpm = 80, useUint16 = false) {
    const buffer = new ArrayBuffer(useUint16 ? 3 : 2);
    const dv = new DataView(buffer);
    dv.setUint8(0, useUint16 ? 0x01 : 0x00);
    if (useUint16) dv.setUint16(1, bpm, true); else dv.setUint8(1, bpm);
    return dv;
  }

  function buildFTMSDataView({ flags = 0x0001, bytes = [] } = {}) {
    const buffer = new ArrayBuffer(2 + bytes.length);
    const dv = new DataView(buffer);
    dv.setUint16(0, flags, true);
    for (let i = 0; i < bytes.length; i++) {
      dv.setUint8(2 + i, bytes[i] & 0xff);
    }
    return dv;
  }

  // Simplified event emitter for characteristic
  function createCharacteristic(type) {
    const listeners = new Map();
    const characteristic = {
      _listeners: listeners,
      startNotifications: async function () {
        console.log('mock characteristic startNotifications', type);
        return this; // Return the characteristic itself for chaining
      },
      stopNotifications: async function () {
        console.log('mock characteristic stopNotifications', type);
        return this; // Return the characteristic itself for chaining
      },
      addEventListener: function (event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      removeEventListener: function (event, handler) {
        const arr = listeners.get(event) || [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      },
      _dispatch: function (value) {
        const arr = listeners.get('characteristicvaluechanged') || [];
        const ev = { target: { value } };
        arr.forEach((h) => h(ev));
      },
    };
    return characteristic;
  }

  function handleSimulatorMessage(msg) {
    if (msg.type === 'pm5') {
      if (window.__pm5CharGeneral) window.__pm5CharGeneral._dispatch(buildPM5GeneralDataView(msg.payload));
      if (window.__pm5CharAdditional) window.__pm5CharAdditional._dispatch(buildPM5AdditionalDataView(msg.payload));
    } else if (msg.type === 'ftms') {
      const dv = buildFTMSDataView(msg.payload);
      if (window.__ftmsChar) window.__ftmsChar._dispatch(dv);
    } else if (msg.type === 'hr') {
      const dv = buildHRDataView(msg.payload.bpm, !!msg.payload.uint16);
      if (window.__hrChar) window.__hrChar._dispatch(dv);
    }
  }

  function uuidMatches(value, hex) {
    const normalizedHex = String(hex).toLowerCase().replace(/^0x/, '').replace(/-/g, '');
    if (typeof value === 'number') {
      return value === parseInt(normalizedHex, 16);
    }

    const normalizedValue = String(value).toLowerCase().replace(/^0x/, '').replace(/-/g, '');
    if (normalizedValue === normalizedHex) return true;

    // Standard Bluetooth base UUID (e.g. 00001826-0000-1000-8000-00805f9b34fb)
    if (normalizedValue.length === 32) {
      if (normalizedHex.length === 4) {
        return normalizedValue.slice(4, 8) === normalizedHex;
      }
      if (normalizedHex.length === 8) {
        return normalizedValue.slice(0, 8) === normalizedHex;
      }
    }

    return false;
  }

  // Expose a simulated navigator.bluetooth override
  const originalBluetooth = navigator.bluetooth;
  // Pre-create characteristic instances so they are shared across getCharacteristic calls.
  // Each PM5 UUID gets its own characteristic so that pm5-base.js attaches only one listener
  // per characteristic — prevents the 3× dispatch accumulation that caused stack overflows.
  if (!window.__pm5CharGeneral) window.__pm5CharGeneral = createCharacteristic('pm5-general');
  if (!window.__pm5CharAdditional) window.__pm5CharAdditional = createCharacteristic('pm5-additional');
  if (!window.__pm5CharMux) window.__pm5CharMux = createCharacteristic('pm5-mux');
  // Keep __pm5Char as an alias to the multiplexed char for backward compatibility
  if (!window.__pm5Char) window.__pm5Char = window.__pm5CharMux;
  if (!window.__hrChar) window.__hrChar = createCharacteristic('hr');
  if (!window.__ftmsChar) window.__ftmsChar = createCharacteristic('ftms');

  const mockBluetooth = {
    requestDevice: async function (options) {
      console.log('mock-bluetooth requestDevice called', JSON.stringify(options));
      const services = options?.filters?.flatMap(f => f.services || []) || [];
      // Determine device name based on requested services
      // PM5 uses ce060000-43e5-11e4-916c-0800200c9a66, HR uses 0000180d-0000-1000-8000-00805f9b34fb
      const isPM5 = services.some(s => uuidMatches(s, 'ce060000'));
      const isHR = services.some(s => uuidMatches(s, '180d'));
      const isFTMS = services.some(s => uuidMatches(s, '1826'));
      const deviceName = isPM5 ? 'Concept2 PM5' : (isFTMS ? 'FTMS Rower' : (isHR ? 'Heart Rate Monitor' : 'SimulatorDevice'));
      // Build a device that simulates the Web Bluetooth API minimal surface
      const device = {
        name: deviceName,
        _listeners: new Map(),
        addEventListener: function (event, handler) {
          if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
          }
          this._listeners.get(event).push(handler);
        },
        removeEventListener: function (event, handler) {
          const arr = this._listeners.get(event) || [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        },
        gatt: {
          connected: false,
          connect: async function () {
            console.log('mock gatt.connect called', options?.filters);
            device.gatt.connected = true;
            const server = {
              connected: true,
              getPrimaryService: async (uuid) => {
                return {
                  getCharacteristic: async (charUuid) => {
                    if (uuidMatches(charUuid, '2a37')) {
                      return window.__hrChar;
                    }
                    if (uuidMatches(charUuid, '2ad1')) {
                      return window.__ftmsChar;
                    }
                    // Route PM5 UUIDs to their dedicated characteristic objects so each
                    // gets exactly one listener instead of all sharing __pm5Char.
                    if (uuidMatches(charUuid, 'ce060031')) return window.__pm5CharGeneral;
                    if (uuidMatches(charUuid, 'ce060032')) return window.__pm5CharAdditional;
                    if (uuidMatches(charUuid, 'ce060080')) return window.__pm5CharMux;
                    return window.__pm5CharMux;
                  }
                };
              },
              disconnect: function () {
                console.log('mock gatt.disconnect called');
                this.connected = false;
                device.gatt.connected = false;
                const handlers = device._listeners.get('gattserverdisconnected') || [];
                handlers.slice().forEach((h) => { try { h(); } catch (_) { } });
              }
            };
            return server;
          }
        }
      };
      return device;
    }
  };

  // Define a simple global simulator API to be used by Playwright tests
  window.__simulator = {
    emitPM5: (payload) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pm5', payload })); },
    emitFTMS: (payload) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ftms', payload })); },
    emitHR: (payload) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'hr', payload })); },
    startSequence: async (id, sequence) => {
      // POST to control HTTP endpoint to start a sequence on the simulator
      try {
        await fetch(`http://localhost:9002/sequence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, sequence }),
        });
        return true;
      } catch (e) {
        console.error('Failed to start sequence', e);
        return false;
      }
    },
    startRoute: async (id, options) => {
      // options: { distance, step, startHr, endHr, msPerStep }
      try {
        await fetch(`http://localhost:9002/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...options }),
        });
        return true;
      } catch (e) {
        console.error('Failed to start route', e);
        return false;
      }
    },
    startFtmsRoute: async (id, options) => {
      try {
        await fetch(`http://localhost:9002/ftms/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...options }),
        });
        return true;
      } catch (e) {
        console.error('Failed to start FTMS route', e);
        return false;
      }
    },
    stopSequence: async (id) => {
      try {
        await fetch(`http://localhost:9002/sequence/stop/${id}`, { method: 'POST' });
        return true;
      } catch (e) {
        console.error('Failed to stop sequence', e);
        return false;
      }
    }
  };

  // Install override
  try {
    Object.defineProperty(navigator, 'bluetooth', { value: mockBluetooth, configurable: true });
    console.log('Navigator.bluetooth overridden for test simulation');
  } catch (e) {
    console.warn('Could not override navigator.bluetooth', e);
  }
})();
