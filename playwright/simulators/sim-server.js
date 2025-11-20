#!/usr/bin/env node
// Minimal WebSocket-based simulator server for PM5 and Heart Rate devices
// Usage: node sim-server.js --port 9001

const { WebSocketServer } = require('ws');
const http = require('http');

const port = parseInt(process.env.PORT || '9001', 10);
const wss = new WebSocketServer({ port });

let sockets = new Set();
let sequences = {};

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      // echo back for now
      // Support control: { action: 'broadcast', payload: {...} }
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

// Simple HTTP control endpoint to emit messages to connected clients
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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            delete sequences[id];
            return;
          }
          const item = sequence[idx++];
          broadcast(JSON.stringify(item.payload));
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
  // Route simulation: start an automated route playback
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
          // linearly vary HR between start and end
          const hr = Math.round(startHr + (endHr - startHr) * (i / Math.max(1, steps - 1)));
          sequence.push({ delay: 0, payload: { type: 'pm5', payload: { distance: distanceVal, elapsedTime: time, pace: 120, power: 200, cadence: 30, heartRate: hr } } });
          sequence.push({ delay: 10, payload: { type: 'hr', payload: { bpm: hr } } });
          sequence.push({ delay: 20 });
        }
        // run the sequence
        if (sequences[id]) clearTimeout(sequences[id].timer);
        let idx = 0;
        function runNext() {
          if (idx >= sequence.length) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
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

  if (req.method === 'POST' && req.url && req.url.startsWith('/sequence/stop/')) {
    const id = req.url.split('/').pop();
    if (id && sequences[id]) {
      clearTimeout(sequences[id].timer);
      delete sequences[id];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stopped: id }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Simulator server running');
});

server.on('listening', () => console.log(`Simulator server HTTP+WS listening on port ${port}`));
server.on('error', (e) => console.error('Server error', e));

server.listen(port + 1); // HTTP on port+1
console.log('WebSocket Server port', port);
console.log('HTTP control port', port + 1);

process.on('SIGINT', () => {
  wss.close(() => process.exit(0));
});

// Add advanced control handlers: /sequence start and /sequence/stop
server.on('request', (req, res) => {
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

        // Run sequence in background
        if (sequences[id]) {
          clearTimeout(sequences[id].timer);
        }
        let idx = 0;
        function runNext() {
          if (idx >= sequence.length) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            delete sequences[id];
            return;
          }
          const item = sequence[idx++];
          broadcast(JSON.stringify(item.payload));
          sequences[id].timer = setTimeout(runNext, item.delay || 100);
        }
        sequences[id] = { timer: null };
        runNext();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid payload' }));
      }
    });
  } else if (req.method === 'POST' && req.url && req.url.startsWith('/sequence/stop/')) {
    const id = req.url.split('/').pop();
    if (id && sequences[id]) {
      clearTimeout(sequences[id].timer);
      delete sequences[id];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stopped: id }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
});
