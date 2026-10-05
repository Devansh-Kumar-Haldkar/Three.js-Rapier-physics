import * as THREE from 'three';
import Peer, { DataConnection } from 'peerjs';
import { Vec3, NetworkPacket, TransformPacket, DamagePacket, KillPacket, RespawnPacket, ModeSyncPacket } from './types';
import { SnapshotInterpolator } from './snapshot-interpolator';
import { FPSController } from '../fps-controller';
import { FXManager, sounds } from '../weapon-system';
import { RAPIER, physics } from '../physics';
import type { GameModeManager } from '../gamemodes/game-mode-manager';

/**
 * Hardened Public STUN / TURN IceServers Configuration
 * Includes Google STUN (stun.l.google.com:19302), Cloudflare STUN, and Metered OpenRelay STUN & TURN
 * to guarantee WebRTC NAT traversal across strict firewalls and mobile 4G/5G connections.
 */
export const PEER_CONNECTION_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:openrelay.metered.ca:80' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelay',
        credential: 'openrelay',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelay',
        credential: 'openrelay',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelay',
        credential: 'openrelay',
      },
    ],
    iceCandidatePoolSize: 10,
  },
};

export class RemotePeer {
  public id: string;
  public name: string;
  public group: THREE.Group;

  // Snapshot Interpolation Engine (45ms Buffer + Cubic Hermite Spline)
  public interpolator = new SnapshotInterpolator();

  // Current Transform State
  public currentPos = new THREE.Vector3();
  public currentQuaternion = new THREE.Quaternion();
  public currentPitch = 0;
  public isShooting = false;
  private wasShooting = false;
  private hasReceivedFirstTransform = false;

  public health = 100;
  public isDead = false;

  // 3D Model Meshes
  public headMesh!: THREE.Mesh;
  public torsoMesh!: THREE.Mesh;
  public leftLegMesh!: THREE.Mesh;
  public rightLegMesh!: THREE.Mesh;
  public hitMeshes: THREE.Mesh[] = [];

  private nameplateSprite!: THREE.Sprite;
  private weaponMesh!: THREE.Mesh;
  private muzzleFlashSprite!: THREE.Sprite;

  // Rapier Colliders for Head, Torso, and Limbs
  public headCollider!: RAPIER.Collider;
  public torsoCollider!: RAPIER.Collider;
  public limbCollider!: RAPIER.Collider;
  public headBody!: RAPIER.RigidBody;
  public torsoBody!: RAPIER.RigidBody;
  public limbBody!: RAPIER.RigidBody;

  constructor(id: string, name: string, scene: THREE.Scene) {
    this.id = id;
    this.name = name;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.buildPeerModel();
    this.createNameplate();
    this.initHitboxPhysics();
  }

  private buildPeerModel(): void {
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Red Opponent Team
      roughness: 0.35,
      metalness: 0.8,
    });

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.7,
      metalness: 0.2,
    });

    const visorMat = new THREE.MeshBasicMaterial({ color: 0xff0055 }); // Red glowing cyber visor

    // 1. Torso
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.65, 0.3);
    this.torsoMesh = new THREE.Mesh(torsoGeo, armorMat);
    this.torsoMesh.position.set(0, 0.95, 0);
    this.torsoMesh.castShadow = true;
    this.torsoMesh.userData = { hitboxType: 'torso', peer: this };
    this.group.add(this.torsoMesh);
    this.hitMeshes.push(this.torsoMesh);

    // 2. Head
    const headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
    this.headMesh = new THREE.Mesh(headGeo, armorMat);
    this.headMesh.position.set(0, 1.48, 0);
    this.headMesh.castShadow = true;
    this.headMesh.userData = { hitboxType: 'head', peer: this };
    this.group.add(this.headMesh);
    this.hitMeshes.push(this.headMesh);

    // Visor
    const visorGeo = new THREE.BoxGeometry(0.22, 0.08, 0.05);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.5, 0.15);
    this.group.add(visor);

    // 3. Legs
    const legGeo = new THREE.BoxGeometry(0.18, 0.65, 0.18);
    this.leftLegMesh = new THREE.Mesh(legGeo, bodyMat);
    this.leftLegMesh.position.set(-0.14, 0.32, 0);
    this.leftLegMesh.userData = { hitboxType: 'limb', peer: this };
    this.group.add(this.leftLegMesh);
    this.hitMeshes.push(this.leftLegMesh);

    const rightLeg = new THREE.Mesh(legGeo, bodyMat);
    rightLeg.position.set(0.14, 0.32, 0);
    rightLeg.userData = { hitboxType: 'limb', peer: this };
    this.group.add(rightLeg);
    this.hitMeshes.push(rightLeg);

    // 4. Weapon model
    const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.45);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 });
    this.weaponMesh = new THREE.Mesh(gunGeo, gunMat);
    this.weaponMesh.position.set(0.25, 0.95, 0.35);
    this.group.add(this.weaponMesh);

    // Muzzle flash sprite for remote firing
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,0,85,0.9)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();

    const flashTex = new THREE.CanvasTexture(canvas);
    const flashMat = new THREE.SpriteMaterial({
      map: flashTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.scale.set(0, 0, 0);
    this.muzzleFlashSprite.position.set(0.25, 0.95, 0.6);
    this.group.add(this.muzzleFlashSprite);
  }

  private createNameplate(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.roundRect(8, 8, 240, 48, 8);
    ctx.fill();
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.scale.set(1.4, 0.35, 1);
    this.nameplateSprite.position.set(0, 1.85, 0);
    this.group.add(this.nameplateSprite);
  }

  private initHitboxPhysics(): void {
    // Kinematic hitboxes for Rapier raycast registration
    const headBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.48, 0);
    this.headBody = physics.world.createRigidBody(headBodyDesc);
    const headColliderDesc = RAPIER.ColliderDesc.cuboid(0.18, 0.18, 0.18);
    this.headCollider = physics.world.createCollider(headColliderDesc, this.headBody);

    const torsoBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.95, 0);
    this.torsoBody = physics.world.createRigidBody(torsoBodyDesc);
    const torsoColliderDesc = RAPIER.ColliderDesc.cuboid(0.28, 0.35, 0.18);
    this.torsoCollider = physics.world.createCollider(torsoColliderDesc, this.torsoBody);

    const limbBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.32, 0);
    this.limbBody = physics.world.createRigidBody(limbBodyDesc);
    const limbColliderDesc = RAPIER.ColliderDesc.cuboid(0.24, 0.35, 0.18);
    this.limbCollider = physics.world.createCollider(limbColliderDesc, this.limbBody);
  }

  // Receive compact 30ms transform packet into snapshot interpolation buffer
  public onTransformReceived(packet: TransformPacket): void {
    if (this.isDead) return;

    const timestamp = packet.time || performance.now();

    // Push into 45ms snapshot buffer for Cubic Hermite Spline calculation
    this.interpolator.pushSnapshot({
      time: timestamp,
      pos: [packet.pos[0], packet.pos[1], packet.pos[2]],
      rotY: packet.rotY,
      pitch: packet.pitch,
      isShooting: packet.isShooting,
    });

    if (!this.hasReceivedFirstTransform) {
      // First packet: snap immediately to spawn coordinates
      this.currentPos.set(packet.pos[0], packet.pos[1], packet.pos[2]);
      this.group.position.copy(this.currentPos);

      const targetEuler = new THREE.Euler(0, packet.rotY, 0, 'YXZ');
      this.currentQuaternion.setFromEuler(targetEuler);
      this.group.quaternion.copy(this.currentQuaternion);

      this.currentPitch = packet.pitch;
      this.weaponMesh.rotation.x = this.currentPitch;
      this.isShooting = packet.isShooting;
      this.hasReceivedFirstTransform = true;
    }
  }

  public triggerDeath(): void {
    this.isDead = true;
    this.isShooting = false;
  }

  public triggerRespawn(): void {
    this.isDead = false;
    this.health = 100;
    this.group.rotation.set(0, 0, 0);
    this.interpolator.clear();
  }

  // Snapshot Interpolation (45ms buffer + Cubic Hermite Spline) in Render Loop
  public update(delta: number, fx: FXManager): void {
    if (this.isDead) {
      // Ragdoll collapse / tip over effect on death
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 2.2, delta * 9.0);
      this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, 0.15, delta * 9.0);
      return;
    }

    if (!this.hasReceivedFirstTransform) return;

    // 1. Sample Cubic Hermite Spline at currentTime - 45ms
    const sample = this.interpolator.sample(performance.now());
    if (sample) {
      this.currentPos.copy(sample.pos);
      this.group.position.copy(sample.pos);

      this.currentQuaternion.copy(sample.quaternion);
      this.group.quaternion.copy(sample.quaternion);

      this.currentPitch = sample.pitch;
      this.weaponMesh.rotation.x = sample.pitch;

      this.isShooting = sample.isShooting;
    }

    // 2. Remote Shooting Visual FX
    if (this.isShooting && !this.wasShooting) {
      this.triggerShootEffect(fx);
    }
    this.wasShooting = this.isShooting;

    // 3. Synchronize Kinematic Rapier Hitboxes to smoothly interpolated position
    this.headBody.setNextKinematicTranslation({
      x: this.group.position.x,
      y: this.group.position.y + 1.48,
      z: this.group.position.z,
    });
    this.torsoBody.setNextKinematicTranslation({
      x: this.group.position.x,
      y: this.group.position.y + 0.95,
      z: this.group.position.z,
    });
    this.limbBody.setNextKinematicTranslation({
      x: this.group.position.x,
      y: this.group.position.y + 0.32,
      z: this.group.position.z,
    });

    // 4. Decay muzzle flash
    if (this.muzzleFlashSprite.scale.x > 0.01) {
      this.muzzleFlashSprite.scale.lerp(new THREE.Vector3(0, 0, 0), 0.25);
    }
  }

  public triggerShootEffect(fx: FXManager): void {
    this.muzzleFlashSprite.scale.set(0.5, 0.5, 1);

    const muzzlePos = new THREE.Vector3();
    this.weaponMesh.getWorldPosition(muzzlePos);
    muzzlePos.y += 0.05;

    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.currentPitch, 0, 0));
    dir.applyQuaternion(this.group.quaternion);

    const endPos = muzzlePos.clone().addScaledVector(dir, 50.0);
    fx.addTracer(muzzlePos, endPos);
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    if (this.headCollider) physics.world.removeCollider(this.headCollider, false);
    if (this.torsoCollider) physics.world.removeCollider(this.torsoCollider, false);
    if (this.limbCollider) physics.world.removeCollider(this.limbCollider, false);
    if (this.headBody) physics.world.removeRigidBody(this.headBody);
    if (this.torsoBody) physics.world.removeRigidBody(this.torsoBody);
    if (this.limbBody) physics.world.removeRigidBody(this.limbBody);
  }
}

// ==================== NETWORK MANAGER ====================

export class NetworkManager {
  public peer: Peer | null = null;
  public connection: DataConnection | null = null;

  public isHost = false;
  public isConnected = false;
  public roomCode = 'GLOBAL';
  public selfId: string | null = null;
  public opponentId: string | null = null;
  public playerName = 'HOST-BLUE';
  public opponentName = 'GUEST-RED';

  // 1v1 Combat & Scoreboard State
  public localHealth = 100;
  public isDead = false;
  public hostScore = 0;
  public guestScore = 0;
  public targetKills = 5;
  public currentRound = 1;
  private isRespawning = false;
  private respawnTimerInterval: number | null = null;

  // Exposed Public Callbacks
  public onConnected?: (peerId: string) => void;
  public onDisconnected?: () => void;
  public onPacketReceived?: (packet: NetworkPacket) => void;
  public onConnectingProgress?: (status: string) => void;
  public onConnectingError?: (error: string) => void;

  // Active Game Mode & Map Manager References
  public gameModeManager?: GameModeManager;
  public mapManager?: any;
  private joinTimeout: number | null = null;

  // Remote Peer System
  public peers: Map<string, RemotePeer> = new Map();
  private scene: THREE.Scene;
  private controller!: FPSController;

  // 30ms (approx. 33Hz) Transform Sync Timer
  private transformTimer = 0;
  private readonly TRANSFORM_INTERVAL = 0.030; // 30ms

  // Diagnostics & Timing
  public ping = 0;
  private lastPingSent = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public setController(controller: FPSController): void {
    this.controller = controller;
  }

  private formatPeerId(roomCode: string): string {
    return `fps1v1-${roomCode.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
  }

  // ==================== HOSTING ====================
  public host(roomCode: string): void {
    this.cleanup();
    this.isHost = true;
    this.playerName = 'HOST-BLUE';
    this.opponentName = 'GUEST-RED';
    this.roomCode = roomCode.toUpperCase().trim();
    const peerId = this.formatPeerId(this.roomCode);

    console.log(`[NETWORK] Initializing Host Peer with ID: ${peerId}`);
    this.updateHUDStatus(false, 'INITIALIZING HOST...');
    this.onConnectingProgress?.('Initializing WebRTC Host & Gathering STUN/TURN ICE Candidates...');

    try {
      this.peer = new Peer(peerId, PEER_CONNECTION_CONFIG);

      this.peer.on('open', (id) => {
        this.selfId = id;
        console.log(`[NETWORK] Host Peer is ready. ID: ${id}. Waiting for opponent...`);
        this.updateHUDStatus(false, 'WAITING FOR OPPONENT...');
        this.updateHUDDiagnostics();
        this.updateScoreboardHUD();
        this.onConnectingProgress?.('Host Arena Ready. Awaiting Peer DataChannel connection...');
      });

      this.peer.on('connection', (conn) => {
        console.log(`[NETWORK] Host received incoming connection from: ${conn.peer}`);
        this.onConnectingProgress?.(`Inbound connection detected from ${conn.peer}. Negotiating WebRTC...`);
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('[NETWORK] Peer host error:', err);
        this.updateHUDStatus(false, 'HOST ERROR');
        this.onConnectingError?.(`Host Error: ${err.message || err.type}`);
      });
    } catch (err: any) {
      console.error('[NETWORK] Failed to create Host Peer:', err);
      this.onConnectingError?.(`Failed to create Host: ${err?.message || err}`);
    }
  }

  // ==================== JOINING ====================
  public join(targetRoomCode: string): void {
    this.cleanup();
    this.isHost = false;
    this.playerName = 'GUEST-RED';
    this.opponentName = 'HOST-BLUE';
    this.roomCode = targetRoomCode.toUpperCase().trim();
    const targetPeerId = this.formatPeerId(this.roomCode);

    console.log(`[NETWORK] Initializing Joiner Peer to connect to: ${targetPeerId}`);
    this.updateHUDStatus(false, 'INITIALIZING JOINER...');
    this.onConnectingProgress?.(`Joining Room [${this.roomCode}]... Querying STUN/TURN ICE Candidates...`);

    // 10-Second Connection Timeout failsafe
    this.joinTimeout = window.setTimeout(() => {
      if (!this.isConnected) {
        console.warn(`[NETWORK] Connection to room ${this.roomCode} timed out after 10s.`);
        this.updateHUDStatus(false, 'ROOM NOT FOUND');
        this.onConnectingError?.(`Room [${this.roomCode}] not found or host is offline.`);
      }
    }, 10000);

    try {
      this.peer = new Peer(PEER_CONNECTION_CONFIG);

      this.peer.on('open', (id) => {
        this.selfId = id;
        console.log(`[NETWORK] Joiner Peer opened. ID: ${id}. Connecting to host: ${targetPeerId}`);
        this.updateHUDStatus(false, 'CONNECTING TO HOST...');
        this.onConnectingProgress?.(`Joining Room [${targetRoomCode}]... Connecting to Peer via WebRTC DataChannel...`);

        const conn = this.peer!.connect(targetPeerId, {
          reliable: true,
        });

        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('[NETWORK] Peer join error:', err);
        if (this.joinTimeout) {
          clearTimeout(this.joinTimeout);
          this.joinTimeout = null;
        }
        this.updateHUDStatus(false, 'JOIN ERROR');
        this.onConnectingError?.(`Room not found or host disconnected (${err?.message || err?.type || 'Error'}).`);
      });
    } catch (err: any) {
      console.error('[NETWORK] Failed to create Joiner Peer:', err);
      if (this.joinTimeout) {
        clearTimeout(this.joinTimeout);
        this.joinTimeout = null;
      }
      this.onConnectingError?.(`Failed to initialize WebRTC Peer: ${err?.message || err}`);
    }
  }

  // ==================== CONNECTION HANDLING ====================
  private setupConnection(conn: DataConnection): void {
    this.connection = conn;

    conn.on('open', () => {
      if (this.joinTimeout) {
        clearTimeout(this.joinTimeout);
        this.joinTimeout = null;
      }

      this.isConnected = true;
      this.opponentId = conn.peer;
      console.log(`[NETWORK] P2P WebRTC DataChannel OPEN with peer: ${conn.peer}`);
      this.onConnectingProgress?.('WebRTC DataChannel OPEN! Handshake complete.');

      // Create Remote Peer Entity
      if (!this.peers.has(conn.peer)) {
        const remotePeer = new RemotePeer(conn.peer, this.opponentName, this.scene);
        this.peers.set(conn.peer, remotePeer);
      }

      this.updateHUDStatus(true, 'OPPONENT CONNECTED [P2P WebRTC]');
      this.updateHUDDiagnostics();
      this.updateScoreboardHUD();
      this.startPingLoop();

      // Automatically sync the current game mode & map from host to the joining peer
      if (this.isHost) {
        const currentMode = this.gameModeManager?.activeMode?.id || 'tdm';
        const currentMap = this.mapManager?.activeMapId || 'desert';
        console.log(`[NETWORK] Host broadcasting ROOM_CONFIG_SYNC (Mode=${currentMode}, Map=${currentMap})`);
        
        this.sendPacket({
          type: 'ROOM_CONFIG_SYNC',
          mode: currentMode,
          mapId: currentMap,
          hostScore: this.hostScore,
          guestScore: this.guestScore,
          round: this.currentRound,
        });

        this.startRound(1);
      }

      // Trigger user-defined callback
      if (this.onConnected) {
        this.onConnected(conn.peer);
      }
    });

    conn.on('data', (data: unknown) => {
      const packet = data as NetworkPacket;
      if (this.onPacketReceived) {
        this.onPacketReceived(packet);
      }
      this.handlePacket(packet);
    });

    conn.on('close', () => {
      console.log('[NETWORK] P2P WebRTC connection closed.');
      this.isConnected = false;
      this.updateHUDStatus(false, 'OPPONENT DISCONNECTED');
      this.cleanupPeers();
      if (this.onDisconnected) {
        this.onDisconnected();
      }
    });

    conn.on('error', (err) => {
      console.error('[NETWORK] P2P DataChannel error:', err);
    });
  }

  // ==================== PACKET TRANSMISSION ====================
  public sendPacket(packet: NetworkPacket): void {
    if (this.connection && this.connection.open) {
      this.connection.send(packet);
    }
  }

  // ==================== PACKET DISPATCHER ====================
  private handlePacket(packet: NetworkPacket): void {
    switch (packet.type) {
      case 'ROOM_CONFIG_SYNC': {
        console.log(`[NETWORK] Received ROOM_CONFIG_SYNC from Host: Mode=${packet.mode}, Map=${packet.mapId}`);
        if (packet.mode && this.gameModeManager) {
          this.gameModeManager.setMode(packet.mode, false);
        }
        if (packet.mapId && this.mapManager) {
          this.mapManager.loadMap(packet.mapId);
        }
        if (packet.hostScore !== undefined) this.hostScore = packet.hostScore;
        if (packet.guestScore !== undefined) this.guestScore = packet.guestScore;
        if (packet.round !== undefined) this.currentRound = packet.round;
        this.updateScoreboardHUD();
        break;
      }

      case 'MODE_SYNC': {
        this.gameModeManager?.setMode(packet.mode, false);
        break;
      }

      case 'transform': {
        for (const peer of this.peers.values()) {
          peer.onTransformReceived(packet);
        }
        break;
      }

      case 'damage': {
        this.handleIncomingDamage(packet);
        break;
      }

      case 'kill': {
        this.handleKillReceived(packet);
        break;
      }

      case 'respawn': {
        this.hostScore = packet.hostScore;
        this.guestScore = packet.guestScore;
        this.currentRound = packet.round;
        this.updateScoreboardHUD();
        break;
      }

      case 'SHOOT': {
        const peer = this.peers.get(packet.id);
        if (peer && this.controller) {
          peer.triggerShootEffect(this.controller.weapon.fx);
        }
        break;
      }

      case 'ROUND_START': {
        this.currentRound = packet.round;
        const spawn = this.isHost ? packet.hostSpawn : packet.guestSpawn;
        this.resetPlayerToSpawn(spawn.pos, spawn.yaw);
        this.showRoundBanner(`ROUND ${this.currentRound} — FIGHT!`);
        break;
      }

      case 'PLAYER_KILLED': {
        this.addKillFeed(packet.killerName, packet.victimName, packet.weapon, packet.isHeadshot);
        break;
      }

      case 'PING': {
        this.sendPacket({
          type: 'PONG',
          clientTime: packet.clientTime,
          serverTime: performance.now(),
        });
        break;
      }

      case 'PONG': {
        this.ping = Math.round(performance.now() - packet.clientTime);
        this.updateHUDDiagnostics();
        break;
      }
    }
  }

  // ==================== 1v1 DAMAGE & HP LOGIC ====================

  // When local player fires and hits opponent, send exact { type: 'damage', amount, hitLocation } packet
  public notifyDamageDealt(hitLocation: 'head' | 'torso' | 'limb', amount: number, _hitPoint: THREE.Vector3, _dir: THREE.Vector3): void {
    if (!this.isConnected) return;

    this.sendPacket({
      type: 'damage',
      amount,
      hitLocation,
    });
  }

  // Apply damage directly to local player (from Bots or GameMode storm)
  public applyDirectDamage(amount: number, hitLocation: 'head' | 'torso' | 'limb' = 'torso', sourceName = 'BOT'): void {
    if (this.isDead) return;

    this.localHealth = Math.max(0, this.localHealth - amount);
    this.updateHealthHUD();
    this.flashDamageScreen();

    if (this.localHealth <= 0 && !this.isDead) {
      this.isDead = true;
      this.controller.triggerDeath();

      // Send kill packet to opponent if connected
      this.sendPacket({
        type: 'kill',
        isHeadshot: hitLocation === 'head',
      });

      this.addKillFeed(sourceName, this.playerName, 'AR-X PULSE', hitLocation === 'head');
      this.gameModeManager?.onPlayerKill(sourceName, this.playerName, hitLocation === 'head', false);
      this.gameModeManager?.onLocalPlayerDeath();

      this.start3SecondRespawnCountdown('ELIMINATED');
    }
  }

  // Each player manages their own HP (100)
  private handleIncomingDamage(packet: DamagePacket): void {
    if (this.isDead) return;

    this.localHealth = Math.max(0, this.localHealth - packet.amount);
    this.updateHealthHUD();
    this.flashDamageScreen();

    // If HP hits 0, trigger death animation/ragdoll effect, send { type: 'kill' } packet
    if (this.localHealth <= 0 && !this.isDead) {
      this.isDead = true;
      this.controller.triggerDeath();

      // Send kill packet to opponent
      this.sendPacket({
        type: 'kill',
        isHeadshot: packet.hitLocation === 'head',
      });

      // Update opponent's score locally
      if (this.isHost) {
        this.guestScore++;
      } else {
        this.hostScore++;
      }
      this.updateScoreboardHUD();

      // Add killfeed entry
      this.addKillFeed(this.opponentName, this.playerName, 'AR-X PULSE', packet.hitLocation === 'head');

      // Notify active GameMode
      this.gameModeManager?.onPlayerKill(this.opponentName, this.playerName, packet.hitLocation === 'head', false);
      this.gameModeManager?.onLocalPlayerDeath();

      // Start 3-second countdown to respawn
      this.start3SecondRespawnCountdown('ELIMINATED');
    }
  }

  // Opponent sends kill packet when they are eliminated by local player
  private handleKillReceived(packet: KillPacket): void {
    // Local player scored a kill!
    if (this.isHost) {
      this.hostScore++;
    } else {
      this.guestScore++;
    }
    this.updateScoreboardHUD();

    // Trigger opponent's ragdoll/death animation effect
    for (const peer of this.peers.values()) {
      peer.triggerDeath();
      this.gameModeManager?.onRemotePeerDeath(peer.id);
    }

    // Play kill confirmation audio
    if (packet.isHeadshot) {
      sounds.playHeadshotTick();
    } else {
      sounds.playHitmarkerTick();
    }

    // Add killfeed entry
    this.addKillFeed(this.playerName, this.opponentName, 'AR-X PULSE', !!packet.isHeadshot);

    // Notify active GameMode
    this.gameModeManager?.onPlayerKill(this.playerName, this.opponentName, !!packet.isHeadshot, true);

    // Start 3-second countdown for next round
    this.start3SecondRespawnCountdown('ENEMY ELIMINATED');
  }

  // ==================== 3-SECOND RESPAWN & SCORING ====================

  private start3SecondRespawnCountdown(statusText: string): void {
    if (this.isRespawning) return;
    this.isRespawning = true;

    if (this.respawnTimerInterval) {
      clearInterval(this.respawnTimerInterval);
    }

    const overlay = document.getElementById('respawn-overlay');
    const statusElem = document.getElementById('respawn-status');
    const timerElem = document.getElementById('respawn-timer');

    if (overlay && statusElem && timerElem) {
      statusElem.textContent = statusText;
      overlay.classList.remove('hidden');
    }

    let timeLeft = 3;
    if (timerElem) timerElem.textContent = `RESPAWNING IN ${timeLeft}...`;

    this.respawnTimerInterval = window.setInterval(() => {
      timeLeft--;
      if (timerElem) {
        timerElem.textContent = timeLeft > 0 ? `RESPAWNING IN ${timeLeft}...` : 'RESPAWNING NOW!';
      }

      if (timeLeft <= 0) {
        if (this.respawnTimerInterval) clearInterval(this.respawnTimerInterval);
        this.isRespawning = false;
        if (overlay) overlay.classList.add('hidden');

        // Check Match Win Condition (First to 5 Kills)
        if (this.hostScore >= this.targetKills || this.guestScore >= this.targetKills) {
          const didLocalWin = (this.isHost && this.hostScore >= this.targetKills) || (!this.isHost && this.guestScore >= this.targetKills);
          this.showRoundBanner(didLocalWin ? '🏆 VICTORY! FIRST TO 5 KILLS REACHED' : '💀 DEFEAT! OPPONENT WON MATCH');
          
          setTimeout(() => {
            this.hostScore = 0;
            this.guestScore = 0;
            this.startRound(1);
          }, 4500);
          return;
        }

        // Advance to next round & respawn both players
        this.startRound(this.currentRound + 1);
      }
    }, 1000);
  }

  public startRound(roundNum = 1): void {
    this.currentRound = roundNum;
    this.localHealth = 100;
    this.isDead = false;

    const hostSpawn = { pos: { x: 0, y: 1.5, z: -32 }, yaw: 0 };
    const guestSpawn = { pos: { x: 0, y: 1.5, z: 32 }, yaw: Math.PI };

    // Respawn local player
    const mySpawn = this.isHost ? hostSpawn : guestSpawn;
    this.resetPlayerToSpawn(mySpawn.pos, mySpawn.yaw);

    // Reset controller & remote peers
    if (this.controller) {
      this.controller.triggerRespawn();
    }
    for (const peer of this.peers.values()) {
      peer.triggerRespawn();
    }

    // Broadcast ROUND_START & respawn score sync
    this.sendPacket({
      type: 'ROUND_START',
      round: roundNum,
      hostSpawn,
      guestSpawn,
      timestamp: performance.now(),
    });

    this.sendPacket({
      type: 'respawn',
      hostScore: this.hostScore,
      guestScore: this.guestScore,
      round: roundNum,
    });

    this.updateHealthHUD();
    this.updateScoreboardHUD();
    this.showRoundBanner(`ROUND ${this.currentRound} — FIGHT!`);
  }

  public resetPlayerToSpawn(pos: Vec3, yaw: number): void {
    if (!this.controller || !this.controller.body) return;

    this.controller.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.controller.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.controller.setRotation(yaw, 0);
    this.localHealth = 100;
    this.isDead = false;
    this.updateHealthHUD();
  }

  // 30ms Compact Transform Packet Sender + Remote Render Loop Update
  public update(delta: number): void {
    // 1. Send Compact Transform Packet every 30ms (~33Hz)
    this.transformTimer += delta;
    if (this.transformTimer >= this.TRANSFORM_INTERVAL) {
      this.transformTimer = 0;
      this.sendTransformPacket();
    }

    // 2. Render Loop Linear Interpolation (lerp) & Quaternion Slerp on remote peers
    for (const peer of this.peers.values()) {
      peer.update(delta, this.controller.weapon.fx);
    }
  }

  private sendTransformPacket(): void {
    if (!this.isConnected || !this.connection?.open || !this.controller?.body) return;

    const trans = this.controller.body.translation();
    const packet: TransformPacket = {
      type: 'transform',
      pos: [trans.x, trans.y, trans.z],
      rotY: this.controller.yaw,
      pitch: this.controller.pitch,
      isShooting: this.controller.weapon.isTriggerDown && !this.isDead,
      time: performance.now(),
    };

    this.sendPacket(packet);
  }

  public notifyShoot(origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.isConnected || !this.selfId || this.isDead) return;
    this.sendPacket({
      type: 'SHOOT',
      id: this.selfId,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
    });
  }

  // Check if ray hits any remote peer collider
  public getPeerHitboxInfo(colliderHandle: number): { peer: RemotePeer; hitboxType: 'head' | 'torso' | 'limb'; multiplier: number } | null {
    for (const peer of this.peers.values()) {
      if (peer.isDead) continue;
      if (peer.headCollider?.handle === colliderHandle) {
        return { peer, hitboxType: 'head', multiplier: 1.0 };
      }
      if (peer.torsoCollider?.handle === colliderHandle) {
        return { peer, hitboxType: 'torso', multiplier: 1.0 };
      }
      if (peer.limbCollider?.handle === colliderHandle) {
        return { peer, hitboxType: 'limb', multiplier: 1.0 };
      }
    }
    return null;
  }

  // Three.js Raycaster check against remote peer meshes
  public checkMeshIntersection(raycaster: THREE.Raycaster): { peer: RemotePeer; hitboxType: 'head' | 'torso' | 'limb'; point: THREE.Vector3 } | null {
    for (const peer of this.peers.values()) {
      if (peer.isDead) continue;
      const intersects = raycaster.intersectObjects(peer.hitMeshes, false);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const hitboxType = (hit.object.userData?.hitboxType as 'head' | 'torso' | 'limb') || 'torso';
        return { peer, hitboxType, point: hit.point };
      }
    }
    return null;
  }

  private startPingLoop(): void {
    setInterval(() => {
      if (this.isConnected && this.connection?.open) {
        this.lastPingSent = performance.now();
        this.sendPacket({
          type: 'PING',
          clientTime: this.lastPingSent,
        });
      }
    }, 2000);
  }

  public cleanup(): void {
    this.cleanupPeers();
    if (this.respawnTimerInterval) {
      clearInterval(this.respawnTimerInterval);
      this.respawnTimerInterval = null;
    }
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.isConnected = false;
  }

  private cleanupPeers(): void {
    for (const peer of this.peers.values()) {
      peer.destroy(this.scene);
    }
    this.peers.clear();
  }

  private updateHUDStatus(online: boolean, statusText?: string): void {
    const badge = document.getElementById('net-badge');
    if (badge) {
      if (online) {
        badge.textContent = statusText || 'P2P ONLINE';
        badge.className = 'stat-value badge-grounded';
      } else {
        badge.textContent = statusText || 'DISCONNECTED';
        badge.className = 'stat-value badge-airborne';
      }
    }
  }

  private updateHUDDiagnostics(): void {
    const pingElem = document.getElementById('stat-ping');
    const peersElem = document.getElementById('stat-peers');
    const roomElem = document.getElementById('stat-room');
    if (pingElem) pingElem.textContent = `${this.ping} ms`;
    if (peersElem) peersElem.textContent = `${this.peers.size}`;
    if (roomElem) roomElem.textContent = this.roomCode;
  }

  public updateScoreboardHUD(): void {
    const blueVal = document.getElementById('score-blue-val');
    const redVal = document.getElementById('score-red-val');
    const roundVal = document.getElementById('score-round-val');

    if (blueVal) blueVal.textContent = `${this.hostScore}`;
    if (redVal) redVal.textContent = `${this.guestScore}`;
    if (roundVal) roundVal.textContent = `ROUND ${this.currentRound}`;
  }

  private updateHealthHUD(): void {
    const healthElem = document.getElementById('stat-health');
    const healthBar = document.getElementById('health-bar-fill');
    if (healthElem) healthElem.textContent = `${Math.round(this.localHealth)}`;
    if (healthBar) healthBar.style.width = `${Math.max(0, this.localHealth)}%`;
  }

  private flashDamageScreen(): void {
    const flash = document.getElementById('damage-flash');
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 250);
    }
  }

  public showRoundBanner(text: string): void {
    const banner = document.getElementById('round-banner');
    if (banner) {
      banner.textContent = text;
      banner.classList.add('visible');
      setTimeout(() => banner.classList.remove('visible'), 3000);
    }
  }

  public addKillFeed(killer: string, victim: string, weapon: string, isHeadshot: boolean): void {
    const feed = document.getElementById('killfeed');
    if (!feed) return;

    const row = document.createElement('div');
    row.className = `killfeed-item ${isHeadshot ? 'headshot' : ''}`;
    row.innerHTML = `
      <span class="kf-killer">${killer}</span>
      <span class="kf-weapon">[${weapon}]</span>
      ${isHeadshot ? '<span class="kf-headshot">🎯 CRIT</span>' : ''}
      <span class="kf-victim">${victim}</span>
    `;

    feed.appendChild(row);
    setTimeout(() => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      setTimeout(() => row.remove(), 400);
    }, 4500);
  }
}
