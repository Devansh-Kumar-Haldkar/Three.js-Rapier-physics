export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerInput {
  seq: number;
  dt: number;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  yaw: number;
  pitch: number;
  shoot: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isSprinting: boolean;
  isShooting: boolean;
  health: number;
  seq: number;
  timestamp: number;
}

export interface WorldSnapshot {
  t: number;
  players: PlayerState[];
}

export type TransformPacket = {
  type: 'transform';
  pos: [number, number, number];
  rotY: number;
  pitch: number;
  isShooting: boolean;
  time?: number;
};

export type DamagePacket = {
  type: 'damage';
  amount: number;
  hitLocation: 'head' | 'torso' | 'limb';
};

export type KillPacket = {
  type: 'kill';
  isHeadshot?: boolean;
};

export type RespawnPacket = {
  type: 'respawn';
  hostScore: number;
  guestScore: number;
  round: number;
};

export type ModeSyncPacket = {
  type: 'MODE_SYNC';
  mode: 'tdm' | 'clash' | 'br';
};

export type RoomConfigSyncPacket = {
  type: 'ROOM_CONFIG_SYNC';
  mode: 'tdm' | 'clash' | 'br';
  mapId: 'desert' | 'jungle' | 'neon';
  hostScore?: number;
  guestScore?: number;
  round?: number;
};

export type NetworkPacket =
  | TransformPacket
  | DamagePacket
  | KillPacket
  | RespawnPacket
  | ModeSyncPacket
  | RoomConfigSyncPacket
  | {
      type: 'STATE';
      id: string;
      state: PlayerState;
    }
  | {
      type: 'SHOOT';
      id: string;
      origin: Vec3;
      dir: Vec3;
    }
  | {
      type: 'DAMAGE';
      targetId: string;
      attackerId: string;
      attackerName: string;
      amount: number;
      hitboxType: 'head' | 'torso' | 'limb';
      hitPoint: Vec3;
      dir: Vec3;
    }
  | {
      type: 'ROUND_START';
      round: number;
      hostSpawn: { pos: Vec3; yaw: number };
      guestSpawn: { pos: Vec3; yaw: number };
      timestamp: number;
    }
  | {
      type: 'PLAYER_KILLED';
      killerId: string;
      killerName: string;
      victimId: string;
      victimName: string;
      weapon: string;
      isHeadshot: boolean;
    }
  | {
      type: 'PING';
      clientTime: number;
    }
  | {
      type: 'PONG';
      clientTime: number;
      serverTime: number;
    };
