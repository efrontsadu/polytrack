import express, { Express, Request, Response } from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import path from 'path';

const app: Express = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../')));

interface Player {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: number;
  ws: WebSocket;
}

interface Game {
  id: string;
  host: string;
  players: Map<string, Player>;
  created: number;
}

const games = new Map<string, Game>();
const playerToGame = new Map<string, string>();

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

function broadcast(gameId: string, message: any, exclude?: string) {
  const game = games.get(gameId);
  if (!game) return;
  const payload = JSON.stringify(message);
  game.players.forEach((player, playerId) => {
    if (exclude && playerId === exclude) return;
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(payload);
  });
}

function getGameStats(gameId: string): any {
  const game = games.get(gameId);
  if (!game) return null;
  const players = Array.from(game.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    position: p.position,
    rotation: p.rotation
  }));
  return { gameId, playerCount: players.length, players, created: game.created };
}

wss.on('connection', (ws: WebSocket) => {
  let playerId: string | null = null;
  let gameId: string | null = null;
  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'create_game': {
          const thisGameId = generateId();
          const thisPlayerId = generateId();
          playerId = thisPlayerId;
          gameId = thisGameId;
          const player: Player = {
            id: thisPlayerId,
            name: data.playerName || 'Player',
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            ws
          };
          const game: Game = {
            id: thisGameId,
            host: thisPlayerId,
            players: new Map([[thisPlayerId, player]]),
            created: Date.now()
          };
          games.set(thisGameId, game);
          playerToGame.set(thisPlayerId, thisGameId);
          ws.send(JSON.stringify({ type: 'game_created', gameId: thisGameId, playerId: thisPlayerId }));
          break;
        }
        case 'join_game': {
          const targetGameId = data.gameId as string;
          const game = games.get(targetGameId);
          if (!game) {
            ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
            break;
          }
          if (game.players.size >= 4) {
            ws.send(JSON.stringify({ type: 'error', message: 'Game is full (max 4 players)' }));
            break;
          }
          const newPlayerId = generateId();
          playerId = newPlayerId;
          gameId = targetGameId;
          const newPlayer: Player = {
            id: newPlayerId,
            name: data.playerName || 'Player',
            position: { x: Math.random() * 10 - 5, y: 0, z: Math.random() * 10 - 5 },
            rotation: Math.random() * Math.PI * 2,
            ws
          };
          game.players.set(newPlayerId, newPlayer);
          playerToGame.set(newPlayerId, targetGameId);
          const existingPlayers = Array.from(game.players.values()).filter(p => p.id !== newPlayerId)
            .map(p => ({ id: p.id, name: p.name, position: p.position, rotation: p.rotation }));
          ws.send(JSON.stringify({
            type: 'game_joined',
            gameId: targetGameId,
            playerId: newPlayerId,
            existingPlayers
          }));
          broadcast(targetGameId, { type: 'player_joined', playerId: newPlayerId, playerName: newPlayer.name, position: newPlayer.position }, newPlayerId);
          break;
        }
        case 'move': {
          if (!gameId || !playerId) break;
          const game = games.get(gameId);
          if (!game) break;
          const player = game.players.get(playerId);
          if (player) {
            player.position = data.position;
            player.rotation = data.rotation;
            broadcast(gameId, { type: 'player_moved', playerId, position: data.position, rotation: data.rotation }, playerId);
          }
          break;
        }
        case 'action': {
          if (!gameId || !playerId) break;
          broadcast(gameId, { type: 'player_action', playerId, action: data.action, data: data.data });
          break;
        }
        case 'get_stats': {
          if (!gameId) break;
          const stats = getGameStats(gameId);
          ws.send(JSON.stringify({ type: 'stats', data: stats }));
          break;
        }
        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });
  ws.on('close', () => {
    if (!playerId || !gameId) return;
    const game = games.get(gameId);
    if (!game) return;
    game.players.delete(playerId);
    playerToGame.delete(playerId);
    if (game.players.size === 0) {
      games.delete(gameId);
    } else {
      broadcast(gameId, { type: 'player_left', playerId, message: `Player left` });
    }
  });
  ws.on('error', () => { });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), games: games.size, wsClients: wss.clients.size });
});
app.get('/api/games', (_req: Request, res: Response) => {
  const gamesList = Array.from(games.values()).map(game => ({
    gameId: game.id,
    playerCount: game.players.size,
    maxPlayers: 4,
    created: game.created
  }));
  res.json({ success: true, games: gamesList, totalGames: gamesList.length });
});
app.get('/api/game/:gameId', (req: Request, res: Response) => {
  const game = games.get(req.params.gameId);
  if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
  const stats = getGameStats(req.params.gameId);
  res.json({ success: true, data: stats });
});
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../index.html'));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PolyTrack multiplayer server started on port ${PORT}`);
});
