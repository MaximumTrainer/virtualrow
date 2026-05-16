#!/usr/bin/env node
// Minimal WebSocket-based simulator server for PM5 and Heart Rate devices
// CommonJS entry (for Node with "type": "module"). Use this file to avoid ESM issues.

const { WebSocketServer } = require('ws');
const http = require('http');

const port = parseInt(process.env.PORT || '9001', 10);
const wss = new WebSocketServer({ port });

let sockets = new Set();
let sequences = {};

function u16le(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function i16le(value) {
  const normalized = value & 0xffff;
  return [normalized & 0xff, (normalized >> 8) & 0xff];
}

function u24le(value) {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}

function buildFtmsRowerPacket({
  moreData = false,
  strokeRate = 24,
  strokeCount = 0,
  averageStrokeRate = 0,
  distance = 0,
  paceCs = 0,
  averagePaceCs = 0,
  power = 0,
  averagePower = 0,
  resistance = 0,
  calories = 0,
  heartRate = 0,
  metabolicEquivalent = 0,
  elapsedTime = 0,
  remainingTime = 0,
}) {
  let flags = 0;
  if (moreData) flags |= 0x0001;
  flags |= 0x0002; // average stroke rate present
  flags |= 0x0004; // total distance present
  flags |= 0x0008; // instantaneous pace present
  flags |= 0x0010; // average pace present
  flags |= 0x0020; // instantaneous power present
  flags |= 0x0040; // average power present
  flags |= 0x0080; // resistance present
  flags |= 0x0100; // expended energy present
  flags |= 0x0200; // heart rate present
  flags |= 0x0400; // metabolic equivalent present
  flags |= 0x0800; // elapsed time present
  flags |= 0x1000; // remaining time present

  const bytes = [
    ...(!moreData
      ? [
          Math.max(0, Math.min(255, Math.round(strokeRate * 2))),
          ...u16le(Math.max(0, Math.round(strokeCount))),
        ]
      : []),
    Math.max(0, Math.min(255, Math.round(averageStrokeRate * 2))),
    ...u24le(Math.max(0, Math.round(distance))),
    ...u16le(Math.max(0, Math.round(paceCs))),
    ...u16le(Math.max(0, Math.round(averagePaceCs))),
    ...i16le(Math.round(power)),
    ...i16le(Math.round(averagePower)),
    ...i16le(Math.round(resistance)),
    ...u16le(Math.max(0, Math.round(calories))),
    ...u16le(0), // kcal/hr placeholder
    0, // kcal/min placeholder
    Math.max(0, Math.min(255, Math.round(heartRate))),
    Math.max(0, Math.min(255, Math.round(metabolicEquivalent))),
    ...u16le(Math.max(0, Math.round(elapsedTime))),
    ...u16le(Math.max(0, Math.round(remainingTime))),
  ];

  return { flags, bytes };
}

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.action === 'broadcast') {
        broadcast(JSON.stringify(data.payload));
      }
    } catch (e) {
      console.error('Invalid message', e);
    }
  });
  ws.on('close', () => sockets.delete(ws));
});

function broadcast(message) {
  for (const s of sockets) {
    if (s.readyState === s.OPEN) {
      s.send(message);
    }
  }
}

const server = http.createServer((req, res) => {
  // Simple CORS support for browser fetch requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/emit') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        broadcast(JSON.stringify(payload));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid payload' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/sequence') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { id, sequence } = JSON.parse(body);
        if (!id || !Array.isArray(sequence)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid sequence' }));
          return;
        }
        if (sequences[id]) clearTimeout(sequences[id].timer);
        let idx = 0;
        function runNext() {
          if (idx >= sequence.length) {
            delete sequences[id];
            return;
          }
          const item = sequence[idx++];
          if (item.payload) broadcast(JSON.stringify(item.payload));
          sequences[id].timer = setTimeout(runNext, item.delay || 100);
        }
        sequences[id] = { timer: null };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
        runNext();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid payload' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/route') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { id, distance = 2000, step = 250, startHr = 90, endHr = 110, msPerStep = 1000 } = JSON.parse(body);
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid id' }));
          return;
        }
        const steps = Math.ceil(distance / step);
        const sequence = [];
        for (let i = 0; i < steps; i++) {
          const distanceVal = Math.min(distance, i * step);
          const time = i * msPerStep;
          const hr = Math.round(startHr + (endHr - startHr) * (i / Math.max(1, steps - 1)));
          sequence.push({ delay: 0, payload: { type: 'pm5', payload: { distance: distanceVal, elapsedTime: time, pace: 120, power: 200, cadence: 30, heartRate: hr } } });
          sequence.push({ delay: 10, payload: { type: 'hr', payload: { bpm: hr } } });
          sequence.push({ delay: 20 });
        }
        if (sequences[id]) clearTimeout(sequences[id].timer);
        let idx = 0;
        function runNext() {
          if (idx >= sequence.length) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: true }));
            delete sequences[id];
            return;
          }
          const item = sequence[idx++];
          if (item.payload) broadcast(JSON.stringify(item.payload));
          sequences[id].timer = setTimeout(runNext, item.delay || 100);
        }
        sequences[id] = { timer: null };
        runNext();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid payload' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/ftms/route') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const {
          id,
          distance = 10000,
          step = 100,
          strokeRate = 24,
          pace = 12000,
          power = 180,
          elapsedStepSeconds = 1,
          msPerStep = 100,
        } = JSON.parse(body);
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid id' }));
          return;
        }
        const steps = Math.max(1, Math.ceil(distance / step));
        const totalElapsedSeconds = steps * elapsedStepSeconds;
        const sequence = [];
        for (let i = 0; i < steps; i++) {
          const distanceVal = Math.min(distance, (i + 1) * step);
          const elapsed = i * elapsedStepSeconds;
          const packet = buildFtmsRowerPacket({
            moreData: false,
            strokeRate,
            strokeCount: i,
            averageStrokeRate: strokeRate,
            distance: distanceVal,
            paceCs: pace,
            averagePaceCs: pace,
            power,
            averagePower: power,
            resistance: 0,
            calories: Math.round(distanceVal / 20),
            heartRate: 120,
            metabolicEquivalent: 8,
            elapsedTime: elapsed,
            remainingTime: Math.max(0, totalElapsedSeconds - elapsed),
          });
          sequence.push({
            delay: 0,
            payload: { type: 'ftms', payload: packet },
          });
          sequence.push({ delay: msPerStep });
        }
        if (sequences[id]) clearTimeout(sequences[id].timer);
        let idx = 0;
        function runNext() {
          if (idx >= sequence.length) {
            delete sequences[id];
            return;
          }
          const item = sequence[idx++];
          if (item.payload) broadcast(JSON.stringify(item.payload));
          sequences[id].timer = setTimeout(runNext, item.delay ?? 0);
        }
        sequences[id] = { timer: null };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
        runNext();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid payload' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url && req.url.startsWith('/sequence/stop/')) {
    const id = req.url.split('/').pop();
    if (id && sequences[id]) {
      clearTimeout(sequences[id].timer);
      delete sequences[id];
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ stopped: id }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Simulator server running');
});

server.on('listening', () => console.log(`Simulator server HTTP+WS listening on port ${port}`));
server.on('error', (e) => console.error('Server error', e));

server.listen(port + 1); // HTTP
console.log('WebSocket Server port', port);
console.log('HTTP control port', port + 1);

process.on('SIGINT', () => {
  wss.close(() => process.exit(0));
});
