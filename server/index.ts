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
app.use(express.static(path.join(__dirname, '..')));

// Types
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

// Storage
const games = new Map<string, Game>();
const playerToGame = new Map<string, string>();

// Utility Functions
function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function broadcast(gameId: string, message: any, exclude?: string) {
  const game = games.get(gameId);
  if (!game) return;

  const payload = JSON.stringify(message);
  game.players.forEach((player, playerId) => {
    if (exclude && playerId === exclude) return;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
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

  return {
    gameId,
    playerCount: players.length,
    players,
    created: game.created
  };
}

// WebSocket Connection Handler
wss.on('connection', (ws: WebSocket) => {
  let playerId: string | null = null;
  let gameId: string | null = null;

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'create_game': {
          gameId = generateId();
          playerId = generateId();

          const player: Player = {
            id: playerId,
            name: data.playerName || 'Player',
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            ws
          };

          const game: Game = {
            id: gameId,
            host: playerId,
            players: new Map([[playerId, player]]),
            created: Date.now()
          };

          games.set(gameId, game);
          playerToGame.set(playerId, gameId);

          ws.send(JSON.stringify({
            type: 'game_created',
            gameId,
            playerId,
            message: 'Game created successfully'
          }));

          console.log(`[CREATE_GAME] Created game ${gameId} with host ${playerId}`);
          break;
        }

        case 'join_game': {
          const targetGameId = data.gameId;
          const game = games.get(targetGameId);

          if (!game) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Game not found'
            }));
            break;
          }

          if (game.players.size >= 4) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Game is full (max 4 players)'
            }));
            break;
          }

          playerId = generateId();
          gameId = targetGameId;

          const newPlayer: Player = {
            id: playerId,
            name: data.playerName || 'Player',
            position: { x: Math.random() * 10 - 5, y: 0, z: Math.random() * 10 - 5 },
            rotation: Math.random() * Math.PI * 2,
            ws
          };

          game.players.set(playerId, newPlayer);
          playerToGame.set(playerId, gameId);

          // Send current players to new player
          const existingPlayers = Array.from(game.players.values())
            .filter(p => p.id !== playerId)
            .map(p => ({
              id: p.id,
              name: p.name,
              position: p.position,
              rotation: p.rotation
            }));

          ws.send(JSON.stringify({
            type: 'game_joined',
            gameId,
            playerId,
            existingPlayers,
            message: 'Successfully joined game'
          }));

          // Notify others
          broadcast(gameId, {
            type: 'player_joined',
            playerId,
            playerName: newPlayer.name,
            position: newPlayer.position
          });

          console.log(`[JOIN_GAME] Player ${playerId} joined game ${gameId}`);
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

            broadcast(gameId, {
              type: 'player_moved',
              playerId,
              position: data.position,
              rotation: data.rotation
            }, playerId);
          }
          break;
        }

        case 'action': {
          if (!gameId || !playerId) break;

          broadcast(gameId, {
            type: 'player_action',
            playerId,
            action: data.action,
            data: data.data
          });
          break;
        }

        case 'get_stats': {
          if (!gameId) break;
          const stats = getGameStats(gameId);
          ws.send(JSON.stringify({
            type: 'stats',
            data: stats
          }));
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
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
      console.log(`[DISCONNECT] Game ${gameId} deleted (no players left)`);
    } else {
      broadcast(gameId, {
        type: 'player_left',
        playerId,
        message: `Player left`
      });
      console.log(`[DISCONNECT] Player ${playerId} left game ${gameId}`);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// REST API endpoints
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    games: games.size,
    wsClients: wss.clients.size
  });
});

app.get('/api/games', (req: Request, res: Response) => {
  const gamesList = Array.from(games.values()).map(game => ({
    gameId: game.id,
    playerCount: game.players.size,
    maxPlayers: 4,
    created: game.created
  }));

  res.json({
    success: true,
    games: gamesList,
    totalGames: gamesList.length
  });
});

app.get('/api/game/:gameId', (req: Request, res: Response) => {
  const game = games.get(req.params.gameId);

  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }

  const stats = getGameStats(req.params.gameId);
  res.json({
    success: true,
    data: stats
  });
});

// Serve game files
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   PolyTrack Multiplayer Server        ║
║   Server running on port ${PORT}       ║
║   WebSocket ready for connections     ║
╚═══════════════════════════════════════╝
  `);
});

export { app, server, wss };
