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

  function buildPM5DataView({ pace = 120, distance = 0, elapsedTime = 0, power = 0, cadence = 0, heartRate = 0 } = {}) {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint16(0, Math.round(pace * 100), true); // pace * 100
    view.setUint32(2, Math.floor(distance), true);
    view.setUint32(6, Math.floor(elapsedTime), true);
    view.setUint16(10, Math.round(power), true);
    view.setUint8(13, Math.round(cadence));
    view.setUint8(14, Math.round(heartRate));
    return view;
  }

  function buildHRDataView(bpm = 80, useUint16 = false) {
    const buffer = new ArrayBuffer(useUint16 ? 3 : 2);
    const dv = new DataView(buffer);
    dv.setUint8(0, useUint16 ? 0x01 : 0x00);
    if (useUint16) dv.setUint16(1, bpm, true); else dv.setUint8(1, bpm);
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
      const dv = buildPM5DataView(msg.payload);
      // call both PM5 characteristic handlers if present
      if (window.__pm5Char) window.__pm5Char._dispatch(dv);
    } else if (msg.type === 'hr') {
      const dv = buildHRDataView(msg.payload.bpm, !!msg.payload.uint16);
      if (window.__hrChar) window.__hrChar._dispatch(dv);
    }
  }

  // Expose a simulated navigator.bluetooth override
  const originalBluetooth = navigator.bluetooth;
  // Pre-create characteristic instances so they are shared across getCharacteristic calls
  if (!window.__pm5Char) window.__pm5Char = createCharacteristic('pm5');
  if (!window.__hrChar) window.__hrChar = createCharacteristic('hr');

  const mockBluetooth = {
    requestDevice: async function (options) {
      console.log('mock-bluetooth requestDevice called', JSON.stringify(options));
      const services = options?.filters?.flatMap(f => f.services || []) || [];
      // Build a device that simulates the Web Bluetooth API minimal surface
      const device = {
        name: 'SimulatorDevice',
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
          connect: async function () {
            console.log('mock gatt.connect called', options?.filters);
            const server = {
              connected: true,
              getPrimaryService: async (uuid) => {
                return {
                  getCharacteristic: async (charUuid) => {
                    const s = String(charUuid).toLowerCase();
                    if (s.includes('2a37') || s === '0x2a37') {
                      return window.__hrChar;
                    }
                    return window.__pm5Char;
                  }
                };
              },
              disconnect: function () {
                console.log('mock gatt.disconnect called');
                this.connected = false;
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
    emitPM5: (payload) => ws.send(JSON.stringify({ type: 'pm5', payload })),
    emitHR: (payload) => ws.send(JSON.stringify({ type: 'hr', payload })),
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
