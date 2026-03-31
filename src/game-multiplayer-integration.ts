import { MultiplayerManager, PlayerState } from './multiplayer';
import * as THREE from 'three';

export class GameMultiplayerManager {
  private multiplayerManager: MultiplayerManager | null = null;
  private scene: THREE.Scene;
  private remotePlayerModels: Map<string, THREE.Object3D> = new Map();
  private isMultiplayerActive = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Initialize multiplayer with your game server URL
   */
  async initMultiplayer(serverUrl: string): Promise<void> {
    this.multiplayerManager = new MultiplayerManager(serverUrl);

    // Listen for player joined
    this.multiplayerManager.on('player_joined', (data) => {
      console.log(`Player joined: ${data.playerName}`);
      this.createRemotePlayerModel(data.playerId, data.playerName, data.position);
    });

    // Listen for player movements
    this.multiplayerManager.on('player_moved', (data) => {
      this.updateRemotePlayerPosition(data.playerId, data.position, data.rotation);
    });

    // Listen for player actions
    this.multiplayerManager.on('player_action', (data) => {
      this.handleRemotePlayerAction(data.playerId, data.action, data.data);
    });

    // Listen for player left
    this.multiplayerManager.on('player_left', (data) => {
      console.log(`Player left: ${data.playerId}`);
      this.removeRemotePlayerModel(data.playerId);
    });

    // Listen for errors
    this.multiplayerManager.on('error', (data) => {
      console.error(`[Multiplayer Error] ${data.message}`);
    });
  }

  /**
   * Create a new game
   */
  async createGame(playerName: string): Promise<string> {
    if (!this.multiplayerManager) throw new Error('Multiplayer not initialized');

    const { gameId } = await this.multiplayerManager.createGame(playerName);
    this.isMultiplayerActive = true;
    console.log(`Game created: ${gameId}`);
    return gameId;
  }

  /**
   * Join an existing game
   */
  async joinGame(gameId: string, playerName: string): Promise<void> {
    if (!this.multiplayerManager) throw new Error('Multiplayer not initialized');

    const result = await this.multiplayerManager.joinGame(gameId, playerName);
    this.isMultiplayerActive = true;

    // Add existing players
    result.existingPlayers.forEach((player) => {
      this.createRemotePlayerModel(player.id, player.name, player.position);
    });

    console.log(`Joined game: ${gameId}`);
  }

  /**
   * Update local player position to other players
   */
  updateLocalPlayerPosition(position: { x: number; y: number; z: number }, rotation: number): void {
    if (!this.isMultiplayerActive || !this.multiplayerManager) return;
    this.multiplayerManager.updatePosition(position, rotation);
  }

  /**
   * Send action to other players (e.g., shoot, jump)
   */
  sendPlayerAction(action: string, data?: any): void {
    if (!this.isMultiplayerActive || !this.multiplayerManager) return;
    this.multiplayerManager.sendAction(action, data);
  }

  /**
   * Disconnect from multiplayer
   */
  disconnect(): void {
    if (this.multiplayerManager) {
      this.multiplayerManager.disconnect();
    }
    this.isMultiplayerActive = false;
    this.remotePlayerModels.forEach((model) => this.scene.remove(model));
    this.remotePlayerModels.clear();
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): string {
    return this.multiplayerManager?.getStatus() || 'disconnected';
  }

  /**
   * Get current game state
   */
  getGameState() {
    return this.multiplayerManager?.getGameState();
  }

  // Private methods

  private createRemotePlayerModel(playerId: string, playerName: string, position: { x: number; y: number; z: number }): void {
    if (this.remotePlayerModels.has(playerId)) {
      return; // Model already exists
    }

    // Create a simple cube as player model
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshPhongMaterial({ color: Math.random() * 0xffffff });
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(position.x, position.y, position.z);
    mesh.userData = { playerId, playerName };

    // Add name label
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'white';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(playerName, 128, 64);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const labelGeometry = new THREE.PlaneGeometry(2, 1);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
    labelMesh.position.y = 1.5;
    mesh.add(labelMesh);

    this.scene.add(mesh);
    this.remotePlayerModels.set(playerId, mesh);
  }

  private updateRemotePlayerPosition(playerId: string, position: { x: number; y: number; z: number }, rotation: number): void {
    const model = this.remotePlayerModels.get(playerId);
    if (model) {
      model.position.set(position.x, position.y, position.z);
      model.rotation.y = rotation;
    }
  }

  private removeRemotePlayerModel(playerId: string): void {
    const model = this.remotePlayerModels.get(playerId);
    if (model) {
      this.scene.remove(model);
      this.remotePlayerModels.delete(playerId);
    }
  }

  private handleRemotePlayerAction(playerId: string, action: string, data: any): void {
    const model = this.remotePlayerModels.get(playerId);
    if (!model) return;

    // Handle different action types
    switch (action) {
      case 'jump':
        this.animatePlayerJump(model);
        break;
      case 'fire':
        this.showPlayerFireEffect(model, data);
        break;
      // Add more actions as needed
    }
  }

  private animatePlayerJump(model: THREE.Object3D): void {
    const originalY = model.position.y;
    const duration = 600;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / duration;

      if (progress < 1) {
        // Parabolic motion
        model.position.y = originalY + Math.sin(progress * Math.PI) * 2;
        requestAnimationFrame(animate);
      } else {
        model.position.y = originalY;
      }
    };

    animate();
  }

  private showPlayerFireEffect(model: THREE.Object3D, data: any): void {
    // Create a visual effect at player position
    const sparks = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([model.position]),
      new THREE.PointsMaterial({ color: 0xffff00, size: 0.5 })
    );

    this.scene.add(sparks);

    setTimeout(() => {
      this.scene.remove(sparks);
    }, 500);
  }

  isMultiplayerEnabled(): boolean {
    return this.isMultiplayerActive;
  }
}
