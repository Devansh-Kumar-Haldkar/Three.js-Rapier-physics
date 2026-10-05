import { WebSocketServer, WebSocket } from 'ws';
import { PlayerInput, PlayerState, Vec3, NetworkMessage, WorldSnapshot } from './shared-types';

interface ConnectedPlayer {
  id: string;
  name: string;
  roomId: string;
  ws: WebSocket;
  state: PlayerState;
  inputQueue: PlayerInput[];
  lastInputTime: number;
}

class GameServer {
  private wss: WebSocketServer;
  private players: Map<string, ConnectedPlayer> = new Map();
  private nextPlayerId = 1;
  private readonly TICK_RATE = 60; // 60Hz internal physics validation
  private readonly SNAPSHOT_RATE = 20; // 20Hz broadcast rate to clients

  // Movement Constants (matching client parameters)
  private readonly WALK_SPEED = 8.5;
  private readonly SPRINT_SPEED = 15.0;
  private readonly JUMP_FORCE = 11.5;
  private readonly ACCELERATION = 48.0;
  private readonly FRICTION = 11.0;
  private readonly AIR_ACCELERATION = 14.0;
  private readonly GRAVITY = -24.0;

  constructor(port = 8080) {
    this.wss = new WebSocketServer({ port });
    console.log(`[FPS SERVER] Authoritative Room-Based Game Server running on ws://localhost:${port}`);

    this.setupWebSocket();
    this.startSimulationLoop();
    this.startBroadcastLoop();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const id = `player_${this.nextPlayerId++}`;
      const name = `OPERATIVE-${id.slice(-2).padStart(2, '0')}`;
      const defaultRoom = 'GLOBAL';

      const initialPos: Vec3 = {
        x: (Math.random() - 0.5) * 16,
        y: 1.0,
        z: (Math.random() - 0.5) * 16 + 6,
      };

      const player: ConnectedPlayer = {
        id,
        name,
        roomId: defaultRoom,
        ws,
        state: {
          id,
          name,
          roomId: defaultRoom,
          pos: initialPos,
          vel: { x: 0, y: 0, z: 0 },
          yaw: 0,
          pitch: 0,
          isGrounded: true,
          isSprinting: false,
          isShooting: false,
          health: 100,
          lastProcessedSeq: 0,
        },
        inputQueue: [],
        lastInputTime: performance.now(),
      };

      this.players.set(id, player);
      console.log(`[FPS SERVER] Client connected: ${name} (${id})`);

      // Send INIT packet to the joining player
      this.send(ws, {
        type: 'INIT',
        selfId: id,
        roomId: defaultRoom,
        serverTime: performance.now(),
      });

      // Handle incoming messages
      ws.on('message', (data: string) => {
        try {
          const msg = JSON.parse(data.toString()) as NetworkMessage;
          this.handleMessage(player, msg);
        } catch (err) {
          console.error('[FPS SERVER] Failed to parse message:', err);
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        const oldRoom = player.roomId;
        this.players.delete(id);
        console.log(`[FPS SERVER] Client disconnected: ${name} (${id}) from Room: ${oldRoom}`);
        this.broadcastToRoom(oldRoom, {
          type: 'PLAYER_LEFT',
          id,
        });
      });

      ws.on('error', (err) => {
        console.error(`[FPS SERVER] Socket error for ${id}:`, err);
      });
    });
  }

  private handleMessage(player: ConnectedPlayer, msg: NetworkMessage): void {
    switch (msg.type) {
      case 'JOIN': {
        const prevRoom = player.roomId;
        const newRoom = (msg.roomId || 'GLOBAL').toUpperCase().trim();
        player.name = msg.name || player.name;
        player.state.name = player.name;

        // If switching rooms, notify old room
        if (prevRoom !== newRoom) {
          this.broadcastToRoomExcept(prevRoom, player.id, {
            type: 'PLAYER_LEFT',
            id: player.id,
          });
        }

        player.roomId = newRoom;
        player.state.roomId = newRoom;
        console.log(`[FPS SERVER] Player ${player.name} (${player.id}) joined Room: ${newRoom}`);

        // Broadcast PLAYER_JOINED to players in the new room
        this.broadcastToRoomExcept(newRoom, player.id, {
          type: 'PLAYER_JOINED',
          id: player.id,
          name: player.name,
        });
        break;
      }

      case 'INPUT':
        player.inputQueue.push(msg.input);
        player.lastInputTime = performance.now();
        break;

      case 'PING':
        this.send(player.ws, {
          type: 'PONG',
          clientTime: msg.clientTime,
          serverTime: performance.now(),
        });
        break;

      case 'REMOTE_SHOOT':
        // Relay shooting event to peers in the same room
        this.broadcastToRoomExcept(player.roomId, player.id, {
          type: 'REMOTE_SHOOT',
          id: player.id,
          origin: msg.origin,
          dir: msg.dir,
        });
        break;
    }
  }

  // Authoritative 60Hz Physics & Input Validation Loop
  private startSimulationLoop(): void {
    const tickInterval = 1000 / this.TICK_RATE;
    let lastTime = performance.now();

    setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      for (const player of this.players.values()) {
        while (player.inputQueue.length > 0) {
          const input = player.inputQueue.shift()!;
          this.processPlayerInput(player, input);
        }
      }
    }, tickInterval);
  }

  private processPlayerInput(player: ConnectedPlayer, input: PlayerInput): void {
    const state = player.state;
    const dt = Math.min(input.dt, 0.05);

    state.yaw = input.yaw;
    state.pitch = input.pitch;
    state.isSprinting = input.sprint;
    state.isShooting = input.shoot;

    const isGrounded = state.pos.y <= 1.001;
    state.isGrounded = isGrounded;

    const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const moveZ = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);

    let wishX = 0;
    let wishZ = 0;

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      const normX = moveX / len;
      const normZ = -moveZ / len;

      const sinYaw = Math.sin(state.yaw);
      const cosYaw = Math.cos(state.yaw);
      wishX = normX * cosYaw + normZ * sinYaw;
      wishZ = -normX * sinYaw + normZ * cosYaw;
    }

    const maxSpeed = state.isSprinting ? this.SPRINT_SPEED : this.WALK_SPEED;

    if (isGrounded) {
      if (wishX === 0 && wishZ === 0) {
        const drop = this.FRICTION * dt;
        state.vel.x *= Math.max(0, 1.0 - drop);
        state.vel.z *= Math.max(0, 1.0 - drop);
      } else {
        const targetVx = wishX * maxSpeed;
        const targetVz = wishZ * maxSpeed;
        const accelRate = this.ACCELERATION * dt;
        state.vel.x += (targetVx - state.vel.x) * Math.min(1.0, accelRate);
        state.vel.z += (targetVz - state.vel.z) * Math.min(1.0, accelRate);
      }

      if (input.jump) {
        state.vel.y = this.JUMP_FORCE;
        state.isGrounded = false;
      } else {
        state.vel.y = 0;
      }
    } else {
      if (wishX !== 0 || wishZ !== 0) {
        state.vel.x += wishX * this.AIR_ACCELERATION * dt;
        state.vel.z += wishZ * this.AIR_ACCELERATION * dt;

        const horizSpeed = Math.hypot(state.vel.x, state.vel.z);
        if (horizSpeed > maxSpeed) {
          state.vel.x = (state.vel.x / horizSpeed) * maxSpeed;
          state.vel.z = (state.vel.z / horizSpeed) * maxSpeed;
        }
      }
      state.vel.y += this.GRAVITY * dt;
    }

    state.pos.x += state.vel.x * dt;
    state.pos.y += state.vel.y * dt;
    state.pos.z += state.vel.z * dt;

    if (state.pos.y < 1.0) {
      state.pos.y = 1.0;
      state.vel.y = 0;
      state.isGrounded = true;
    }

    state.pos.x = Math.max(-58, Math.min(58, state.pos.x));
    state.pos.z = Math.max(-58, Math.min(58, state.pos.z));
    state.lastProcessedSeq = input.seq;
  }

  // Broadcast 20Hz World Snapshots Partitioned per Room
  private startBroadcastLoop(): void {
    const snapshotInterval = 1000 / this.SNAPSHOT_RATE;

    setInterval(() => {
      if (this.players.size === 0) return;

      // Group players by room
      const rooms = new Map<string, ConnectedPlayer[]>();
      for (const player of this.players.values()) {
        const list = rooms.get(player.roomId) || [];
        list.push(player);
        rooms.set(player.roomId, list);
      }

      const now = performance.now();

      for (const [roomId, roomPlayers] of rooms.entries()) {
        const snapshot: WorldSnapshot = {
          t: now,
          players: roomPlayers.map((p) => ({ ...p.state })),
        };

        const payload = JSON.stringify({
          type: 'SNAPSHOT',
          snapshot,
        });

        for (const p of roomPlayers) {
          if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(payload);
          }
        }
      }
    }, snapshotInterval);
  }

  private send(ws: WebSocket, msg: NetworkMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastToRoom(roomId: string, msg: NetworkMessage): void {
    const payload = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.roomId === roomId && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(payload);
      }
    }
  }

  private broadcastToRoomExcept(roomId: string, excludeId: string, msg: NetworkMessage): void {
    const payload = JSON.stringify(msg);
    for (const [id, player] of this.players.entries()) {
      if (id !== excludeId && player.roomId === roomId && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(payload);
      }
    }
  }
}

// Start Server
new GameServer(8080);
