'use strict';

// Minimal PM5 wrapper (extracted and adapted from ergarcade/pm5-base/js/pm5.js)
// This file is included as a vendor copy to provide PM5 parsing and event dispatching.

class EventTargetPoly {
  constructor() {
    this.listeners = {};
  }
  addEventListener(type, callback) {
    if (!(type in this.listeners)) this.listeners[type] = [];
    this.listeners[type].push(callback);
  }
  removeEventListener(type, callback) {
    if (!(type in this.listeners)) return;
    const stack = this.listeners[type];
    for (let i = 0; i < stack.length; i++) {
      if (stack[i] === callback) {
        stack.splice(i, 1);
        return;
      }
    }
  }
  dispatchEvent(event) {
    if (!(event.type in this.listeners)) return true;
    const stack = this.listeners[event.type].slice();
    for (let i = 0; i < stack.length; i++) stack[i].call(this, event);
    return !event.defaultPrevented;
  }
}

const services = {
  discovery: { id: 'ce060000-43e5-11e4-916c-0800200c9a66' },
  information: { id: 'ce060010-43e5-11e4-916c-0800200c9a66' },
  control: { id: 'ce060020-43e5-11e4-916c-0800200c9a66' },
  rowing: { id: 'ce060030-43e5-11e4-916c-0800200c9a66' },
};

const characteristics = {
  controlService: {
    transmit: { id: 'ce060021-43e5-11e4-916c-0800200c9a66', service: services.control },
    receive: { id: 'ce060022-43e5-11e4-916c-0800200c9a66', service: services.control },
  },
  rowingService: {
    generalStatus: { id: 'ce060031-43e5-11e4-916c-0800200c9a66', service: services.rowing },
    additionalStatus: { id: 'ce060032-43e5-11e4-916c-0800200c9a66', service: services.rowing },
    additionalStatus2: { id: 'ce060033-43e5-11e4-916c-0800200c9a66', service: services.rowing },
    multiplexedInformation: { id: 'ce060080-43e5-11e4-916c-0800200c9a66', service: services.rowing },
    strokeData: { id: 'ce060035-43e5-11e4-916c-0800200c9a66', service: services.rowing },
    // Where power lives. The PM5 puts stroke power here and nowhere else the
    // app reads, which is why a Concept2 rower saw 0 W for a whole row (#306).
    additionalStrokeData: { id: 'ce060036-43e5-11e4-916c-0800200c9a66', service: services.rowing },
  },
};

// Helper function to decode DataView to numbers used in PM5 parsing
function readUintLE(v, offset, length) {
  let result = 0;
  for (let i = 0; i < length; i++) result |= v[offset + i] << (8 * i);
  return result;
}

class PM5 {
  constructor(cb_connecting, cb_connected, cb_disconnected, cb_message) {
    this.idObjectMap = new Map();
    this.eventTarget = new EventTargetPoly();
    this.cb_connecting = cb_connecting;
    this.cb_connected = cb_connected;
    this.cb_disconnected = cb_disconnected;
    this.cb_message = cb_message;
    this.device = null;
    this.server = null;
  }

  doConnect() {
    return this.connect()
      .then(() => {
        if (this.cb_connecting) this.cb_connecting();
        return this.addEventListener('multiplexed-information', this.cb_message || (() => {}));
      })
      .then(() => {
        if (this.cb_connected) this.cb_connected();
      })
      .catch((e) => { console.error('PM5 doConnect error', e); throw e; });
  }

  doDisconnect() {
    try {
      if (this.server && this.server.connected) this.device.gatt.disconnect();
      if (this.cb_disconnected) this.cb_disconnected();
    } catch (err) {
      console.error('PM5 doDisconnect', err);
    }
  }

  addEventListener(type, callback) {
    this.eventTarget.addEventListener(type, callback);
    switch (type) {
      case 'general-status':
        return this._addGeneralStatusListener();
      case 'multiplexed-information':
        return this._addMultiplexedInformationListener();
      case 'additional-status':
        return this._addAdditionalStatus();
      case 'additional-stroke-data':
        return this._addAdditionalStrokeData();
      default:
        return Promise.resolve();
    }
  }

  removeEventListener(type, callback) {
    this.eventTarget.removeEventListener(type, callback);
    if (!this.connected()) return Promise.resolve();
    switch (type) {
      case 'general-status':
        return this._removeGeneralStatusListener();
      case 'multiplexed-information':
        return this._removeMultiplexedInformationListener();
      case 'additional-status':
        return this._removeAdditionalStatus();
      case 'additional-stroke-data':
        return this._removeAdditionalStrokeData();
      default:
        return Promise.resolve();
    }
  }

  connect() {
    if (!navigator.bluetooth) return Promise.reject('Bluetooth not available');
    return navigator.bluetooth
      .requestDevice({
        filters: [{ services: [services.discovery.id] }],
        optionalServices: [services.information.id, services.control.id, services.rowing.id],
      })
      .then((device) => {
        this.device = device;
        this.device.addEventListener('gattserverdisconnected', () => {
          this.idObjectMap.clear();
          this.eventTarget.dispatchEvent({ type: 'disconnect' });
        });
        return device.gatt.connect();
      })
      .then((server) => {
        this.server = server;
        return Promise.resolve();
      });
  }

  disconnect() {
    if (!this.connected()) return;
    this.device.gatt.disconnect();
  }

  connected() {
    return this.device && this.device.gatt && this.device.gatt.connected;
  }

  _getService(service) {
    const cached = this.idObjectMap.get(service.id);
    if (cached) return Promise.resolve(cached);
    return this.server.getPrimaryService(service.id).then((s) => {
      this.idObjectMap.set(service.id, s);
      return s;
    });
  }

  _getCharacteristic(characteristic) {
    const cached = this.idObjectMap.get(characteristic.id);
    if (cached) return Promise.resolve(cached);
    return this._getService(characteristic.service).then((s) => s.getCharacteristic(characteristic.id));
  }

  _setupCharacteristicValueListener(characteristic, callback) {
    return this._getCharacteristic(characteristic)
      .then((c) => c.startNotifications())
      .then((c) => {
        c.addEventListener('characteristicvaluechanged', (e) => callback(this, e));
        return Promise.resolve();
      });
  }
  _teardownCharacteristicValueListener(characteristic, callback) {
    return this._getCharacteristic(characteristic).then((c) => c.stopNotifications()).then((c) => {
      // No-op; the listener was removed when device disconnected
      return Promise.resolve();
    });
  }

  /* Listeners */
  _addGeneralStatusListener() {
    return this._setupCharacteristicValueListener(characteristics.rowingService.generalStatus, this._cbGeneralStatus);
  }
  _removeGeneralStatusListener() {
    return this._teardownCharacteristicValueListener(characteristics.rowingService.generalStatus, this._cbGeneralStatus);
  }
  _addAdditionalStatus() {
    return this._setupCharacteristicValueListener(characteristics.rowingService.additionalStatus, this._cbAdditionalStatus);
  }
  _removeAdditionalStatus() {
    return this._teardownCharacteristicValueListener(characteristics.rowingService.additionalStatus, this._cbAdditionalStatus);
  }
  _addAdditionalStrokeData() {
    return this._setupCharacteristicValueListener(characteristics.rowingService.additionalStrokeData, this._cbAdditionalStrokeData);
  }
  _removeAdditionalStrokeData() {
    return this._teardownCharacteristicValueListener(characteristics.rowingService.additionalStrokeData, this._cbAdditionalStrokeData);
  }
  _addMultiplexedInformationListener() {
    return this._setupCharacteristicValueListener(characteristics.rowingService.multiplexedInformation, this._cbMultiplexedInformation);
  }
  _removeMultiplexedInformationListener() {
    return this._teardownCharacteristicValueListener(characteristics.rowingService.multiplexedInformation, this._cbMultiplexedInformation);
  }

  /* Parsing callbacks */
  _extractGeneralStatus(e, multiplexed = false) {
    const v = new Uint8Array(e.target.value.buffer);
    const o = multiplexed ? 1 : 0;
    const data = {
      elapsedTime: (v[o + 0] + (v[o + 1] << 8) + (v[o + 2] << 16)) * 0.01,
      distance: (v[o + 3] + (v[o + 4] << 8) + (v[o + 5] << 16)) * 0.1,
      strokeState: v[o + 10],
    };
    return data;
  }

  _cbGeneralStatus(monitor, e, multiplexed = false) {
    const event = { type: multiplexed ? 'multiplexed-information' : 'general-status', source: monitor, raw: e.target.value, data: monitor._extractGeneralStatus(e, multiplexed) };
    monitor.eventTarget.dispatchEvent(event);
  }

  _extractAdditionalStatus(e, multiplexed = false) {
    const v = new Uint8Array(e.target.value.buffer);
    const o = multiplexed ? 1 : 0;
    const r = {
      elapsedTime: (v[o + 0] + (v[o + 1] << 8) + (v[o + 2] << 16)) * 0.01,
      speed: (v[o + 3] + (v[o + 4] << 8)) * 0.001,
      strokeRate: v[o + 5],
      heartRate: v[o + 6],
      currentPace: (v[o + 7] + (v[o + 8] << 8)) * 0.01,
      averagePace: (v[o + 9] + (v[o + 10] << 8)) * 0.01,
    };
    return r;
  }

  _cbAdditionalStatus(monitor, e, multiplexed = false) {
    const event = { type: multiplexed ? 'multiplexed-information' : 'additional-status', source: monitor, raw: e.target.value, data: monitor._extractAdditionalStatus(e, multiplexed) };
    monitor.eventTarget.dispatchEvent(event);
  }

  /**
   * Stroke power, and the fields either side of it.
   *
   * Transcribed from `_extractAdditionalStrokeData` in ergarcade/pm5-base
   * `lib/pm5-ble.js`, the upstream this file was adapted from, so the offsets
   * are the upstream's rather than a reading of the spec. `strokePower` is a
   * little-endian uint16 of watts with no multiplier.
   *
   * The multiplexed frame differs in its last field only, and the app does not
   * read that field; it is parsed anyway so the two shapes cannot silently
   * diverge.
   */
  _extractAdditionalStrokeData(e, multiplexed = false) {
    const v = new Uint8Array(e.target.value.buffer);
    const o = multiplexed ? 1 : 0;
    const r = {
      elapsedTime: (v[o + 0] + (v[o + 1] << 8) + (v[o + 2] << 16)) * 0.01,
      strokePower: v[o + 3] + (v[o + 4] << 8),
      strokeCaloricBurnRate: v[o + 5] + (v[o + 6] << 8),
      strokeCount: v[o + 7] + (v[o + 8] << 8),
      projectedWorkTime: v[o + 9] + (v[o + 10] << 8) + (v[o + 11] << 16),
      projectedWorkDistance: v[o + 12] + (v[o + 13] << 8) + (v[o + 14] << 16),
    };
    if (multiplexed) {
      r.workPerStroke = v[o + 15] + (v[o + 16] << 8);
    } else {
      r.projectedWorkOther = v[o + 15] + (v[o + 16] << 8) + (v[o + 17] << 16);
    }
    return r;
  }

  _cbAdditionalStrokeData(monitor, e, multiplexed = false) {
    const event = { type: multiplexed ? 'multiplexed-information' : 'additional-stroke-data', source: monitor, raw: e.target.value, data: monitor._extractAdditionalStrokeData(e, multiplexed) };
    monitor.eventTarget.dispatchEvent(event);
  }

  _cbMultiplexedInformation(monitor, e) {
    const event = { type: 'multiplexed-information', source: monitor, raw: e.target.value, data: null };
    monitor.eventTarget.dispatchEvent(event);
  }

  // Expose a helper to write to the control transmit characteristic
  writeTransmit(value) {
    return this._getCharacteristic(characteristics.controlService.transmit).then((c) => c.writeValue(value));
  }
}

export default PM5;
