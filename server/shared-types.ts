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

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  name: string;
  roomId: string;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isSprinting: boolean;
  isShooting: boolean;
  health: number;
  lastProcessedSeq: number;
}

export interface WorldSnapshot {
  t: number;
  players: PlayerState[];
}

export type NetworkMessage =
  | { type: 'JOIN'; name: string; roomId: string }
  | { type: 'INIT'; selfId: string; roomId: string; serverTime: number }
  | { type: 'INPUT'; input: PlayerInput }
  | { type: 'SNAPSHOT'; snapshot: WorldSnapshot }
  | { type: 'PING'; clientTime: number }
  | { type: 'PONG'; clientTime: number; serverTime: number }
  | { type: 'PLAYER_JOINED'; id: string; name: string }
  | { type: 'PLAYER_LEFT'; id: string }
  | { type: 'REMOTE_SHOOT'; id: string; origin: Vec3; dir: Vec3 };
