// Calvin's George Racing Game - WebSocket Server
// Deploy this on Replit with: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// Serve static files
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  
  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
  };
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// Game rooms
const rooms = new Map();

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
}

function broadcastToRoom(roomCode, msg, excludeWs) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws !== excludeWs && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  });
}

function broadcastToAll(roomCode, msg) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws.readyState === 1) {
      p.ws.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerIndex = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'host': {
        const code = generateCode();
        rooms.set(code, {
          players: [{ ws, name: msg.name || 'Player 1', score: 0 }],
          state: 'waiting',
          round: 0,
          seed: Math.floor(Math.random() * 999999),
        });
        playerRoom = code;
        playerIndex = 0;
        ws.send(JSON.stringify({ type: 'hosted', code, playerIndex: 0 }));
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found! Check the code and try again.' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full!' }));
          return;
        }
        room.players.push({ ws, name: msg.name || 'Player 2', score: 0 });
        playerRoom = code;
        playerIndex = 1;
        ws.send(JSON.stringify({ type: 'joined', code, playerIndex: 1, seed: room.seed }));
        // Notify host
        room.players[0].ws.send(JSON.stringify({
          type: 'opponent_joined',
          name: msg.name || 'Player 2',
          seed: room.seed,
        }));
        break;
      }

      case 'ready': {
        const room = rooms.get(playerRoom);
        if (!room) return;
        room.players[playerIndex].ready = true;
        if (room.players.length === 2 && room.players.every(p => p.ready)) {
          room.round++;
          room.seed = Math.floor(Math.random() * 999999);
          broadcastToAll(playerRoom, {
            type: 'start_race',
            round: room.round,
            seed: room.seed,
          });
          room.players.forEach(p => p.ready = false);
        }
        break;
      }

      case 'position': {
        // Relay player position to opponent
        broadcastToRoom(playerRoom, {
          type: 'opponent_position',
          x: msg.x,
          y: msg.y,
          vy: msg.vy,
          boosting: msg.boosting,
        }, ws);
        break;
      }

      case 'finished': {
        const room = rooms.get(playerRoom);
        if (!room) return;
        room.players[playerIndex].score++;
        broadcastToAll(playerRoom, {
          type: 'race_over',
          winner: playerIndex,
          winnerName: room.players[playerIndex].name,
          scores: room.players.map(p => ({ name: p.name, score: p.score })),
        });
        break;
      }

      case 'chat': {
        broadcastToRoom(playerRoom, {
          type: 'chat',
          name: msg.name,
          text: msg.text,
        }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (playerRoom) {
      const room = rooms.get(playerRoom);
      if (room) {
        broadcastToRoom(playerRoom, { type: 'opponent_left' }, ws);
        rooms.delete(playerRoom);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🐶 Calvin's George Racing Game running on port ${PORT}!`);
  console.log(`   Open your browser to http://localhost:${PORT}`);
});
