export interface PlayerState {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: number;
}

export interface GameState {
  gameId: string;
  playerId: string;
  players: Map<string, PlayerState>;
}

export type MessageHandler = (data: any) => void;

export class MultiplayerManager {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private gameState: GameState | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Create a new multiplayer game
   */
  async createGame(playerName: string): Promise<{ gameId: string; playerId: string }> {
    return new Promise((resolve, reject) => {
      this.connect(
        () => {
          this.once('game_created', (data) => {
            this.gameState = {
              gameId: data.gameId,
              playerId: data.playerId,
              players: new Map()
            };
            this.startHeartbeat();
            resolve({ gameId: data.gameId, playerId: data.playerId });
          });

          this.once('error', (data) => {
            reject(new Error(data.message));
          });

          this.send({
            type: 'create_game',
            playerName
          });
        },
        reject
      );
    });
  }

  /**
   * Join an existing multiplayer game
   */
  async joinGame(gameId: string, playerName: string): Promise<{ gameId: string; playerId: string; existingPlayers: PlayerState[] }> {
    return new Promise((resolve, reject) => {
      this.connect(
        () => {
          this.once('game_joined', (data) => {
            this.gameState = {
              gameId: data.gameId,
              playerId: data.playerId,
              players: new Map()
            };

            // Add existing players
            data.existingPlayers?.forEach((player: PlayerState) => {
              this.gameState!.players.set(player.id, player);
            });

            this.startHeartbeat();
            resolve({
              gameId: data.gameId,
              playerId: data.playerId,
              existingPlayers: data.existingPlayers || []
            });
          });

          this.once('error', (data) => {
            reject(new Error(data.message));
          });

          this.send({
            type: 'join_game',
            gameId,
            playerName
          });
        },
        reject
      );
    });
  }

  /**
   * Update player position
   */
  updatePosition(position: { x: number; y: number; z: number }, rotation: number): void {
    this.send({
      type: 'move',
      position,
      rotation
    });
  }

  /**
   * Send a player action (e.g., attack, jump, interact)
   */
  sendAction(action: string, data?: any): void {
    this.send({
      type: 'action',
      action,
      data: data || {}
    });
  }

  /**
   * Get current game state
   */
  getGameState(): GameState | null {
    return this.gameState;
  }

  /**
   * Get all remote players
   */
  getRemotePlayers(): Map<string, PlayerState> {
    return this.gameState?.players || new Map();
  }

  /**
   * Register handler for message type
   */
  on(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  /**
   * Register one-time handler for message type
   */
  once(type: string, handler: MessageHandler): void {
    const wrappedHandler = (data: any) => {
      this.off(type, wrappedHandler);
      handler(data);
    };
    this.on(type, wrappedHandler);
  }

  /**
   * Unregister handler
   */
  off(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.gameState = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection status
   */
  getStatus(): string {
    if (!this.ws) return 'disconnected';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'unknown';
    }
  }

  // Private methods

  private connect(onSuccess: () => void, onError: (error: Error) => void): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      onSuccess();
      return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        onSuccess();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      this.ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event);
        onError(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        this.handleDisconnect();
      };
    } catch (error) {
      onError(error as Error);
    }
  }

  private handleMessage(data: any): void {
    // Update game state for certain message types
    if (data.type === 'player_joined' && this.gameState) {
      this.gameState.players.set(data.playerId, {
        id: data.playerId,
        name: data.playerName,
        position: data.position || { x: 0, y: 0, z: 0 },
        rotation: 0
      });
    }

    if (data.type === 'player_moved' && this.gameState) {
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.position = data.position;
        player.rotation = data.rotation;
      }
    }

    if (data.type === 'player_left' && this.gameState) {
      this.gameState.players.delete(data.playerId);
    }

    // Emit handlers
    const handlers = this.messageHandlers.get(data.type);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => {
        if (this.gameState) {
          this.connect(
            () => console.log('[WebSocket] Reconnected'),
            (error) => console.error('[WebSocket] Reconnection failed:', error)
          );
        }
      }, this.reconnectDelay);
    }
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Not connected, message queued:', data);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }
}
