# Three.js + Rapier 3D FPS Multiplayer Arena

A high-performance First-Person Shooter (FPS) player controller, modular weapon system, segmented target dummy combat arena, and **authoritative Node.js multiplayer server** with **1v1 Lobby Matchmaker** built with **Vite**, **TypeScript**, **Three.js**, **Rapier 3D Physics WebAssembly**, and **WebSockets**.

---

## 🎮 Features

### ⚔️ 1v1 Lobby Overlay & Matchmaking
- **Lobby Overlay ([`src/lobby.ts`](file:///d:/Online%20FPS%20Game/src/lobby.ts))**:
  - Clean tactical cyber UI rendered over the Three.js canvas before match start.
  - **Host 1v1 Match**:
    - Generates random 6-character room codes (e.g. `X8K2M9`).
    - Dynamically appends `?room=CODE` to the current browser URL.
    - **Copy Match Link Button**: One-click clipboard copy (`navigator.clipboard.writeText`) with animated visual confirmation.
    - **Enter Arena**: Immediate transition to gameplay while waiting for an opponent.
  - **Join Match**:
    - Input field to join existing rooms by entering an opponent's code.
  - **Auto-Join URL Parameter Check**:
    - When a player opens a shared match link (`http://localhost:3000/?room=ABC123`), the lobby overlay is **automatically skipped**, connecting directly to the specified room.
  - **In-Game Match HUD**:
    - Displays active room code (`ROOM: ABC123`) with an in-game 🔗 link copy button.

### 🌐 Authoritative Multiplayer Architecture
- **Node.js Game Server ([`server/server.ts`](file:///d:/Online%20FPS%20Game/server/server.ts))**:
  - Authoritative physics validation loop running at **60Hz**.
  - Partitioned room broadcasting at **20Hz** (`WorldSnapshot`).
  - Sequence-number input acknowledgment (`lastProcessedSeq`).
  - Real-time round-trip latency (RTT / Ping) diagnostics.
  - Remote shooting event replication.
- **Client-Side Prediction (60Hz)**:
  - Samples inputs (`W`, `A`, `S`, `D`, `Shift`, `Space`, `Yaw`, `Pitch`, `Trigger`) with an incrementing sequence number `seq`.
  - Predicts and executes physics movement locally for **zero input latency**.
  - Maintains an unacknowledged input history buffer.
- **Server Reconciliation**:
  - Client compares predicted state with 20Hz authoritative snapshots.
  - If discrepancy exceeds threshold ($>0.05\text{m}$), automatically snaps to server state and **replays** pending inputs.
- **Remote Peer Linear Interpolation (Lerp Buffer)**:
  - 100ms interpolation buffer smoothly rendering other connected players.
  - Linearly interpolates position ($\text{lerp}$) and spherical/Euler angle rotation without teleportation or jitter.
  - Replicates peer 3D operative models, name tags, weapons, and remote shooting VFX (tracers & muzzle flashes).

### 🌟 High-Fidelity Visual Pipeline & Atmosphere
- **EffectComposer Post-Processing**:
  - **UnrealBloomPass**: Dynamic HDR bloom on sci-fi neon edge strips, illuminated reflex sights, muzzle flashes, and glowing jump pads.
  - **SSAOPass (Screen Space Ambient Occlusion)**: High-precision contact ambient shadows in crevices, platform undersides, and obstacle corners.
  - **OutputPass**: ACES Filmic tone mapping (`exposure: 1.15`) with sRGB gamma correction.
- **Directional Sunlight & PCF Soft Shadows**:
  - `PCFSoftShadowMap` filtering with high-resolution $2048 \times 2048$ shadow mapping.
  - Optimized shadow camera frustum, bias (`-0.0003`), and normal bias (`0.02`) for shadow-acne-free rendering.
- **Atmospheric Sky Dome & Depth Fog**:
  - Custom gradient shader sky dome with 600-point starfield.
  - Harmonious exponential depth fog (`FogExp2: #091122`).

### 🎯 Segmented Target Dummies & Combat Feedback
- **Humanoid Android Training Dummies**:
  - Multi-collider segmented hitboxes:
    - **Head**: **2.5x Multiplier** (Critical Hit - `70 DMG`)
    - **Torso**: **1.0x Multiplier** (Standard - `28 DMG`)
    - **Limbs**: **0.7x Multiplier** (Reduced - `20 DMG`)
  - Overhead gradient health bars, hit flash effects, and auto-respawn system.
- **Combat Feedback**:
  - 3D floating damage numbers (`"CRIT 70"` vs standard).
  - Hitmarker crosshair ticks with synthesized audio crunch.
  - Live kill and damage notification feed.

---

## 🕹️ Controls

| Key | Action |
| :--- | :--- |
| <kbd>Left Click</kbd> | Fire Assault Rifle (Hold for Auto-Fire) |
| <kbd>R</kbd> | Reload Magazine (30 / 120 Ammo) |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Move forward / left / back / right |
| <kbd>Shift</kbd> | Sprint (15 m/s + Dynamic FOV) |
| <kbd>Space</kbd> | Jump (Buffered Raycast Check) |
| <kbd>Mouse</kbd> | Look / Aim (Pointer Lock) |
| <kbd>F</kbd> | Spawn dynamic physics crate in front of player |
| <kbd>T</kbd> | Reset player position to spawn |
| <kbd>H</kbd> | Toggle Controls HUD panel |
| <kbd>ESC</kbd> | Unlock mouse cursor / Open menu |

---

## 🚀 Running the Project

### 1. Start the Authoritative Game Server
```bash
npm run server
```
Runs on `ws://localhost:8080`.

### 2. Start the Client Dev Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

- Click **"HOST 1V1 MATCH"** to generate a private room code and copy the match link.
- Open the copied match link (`http://localhost:3000/?room=CODE`) in a second browser window or tab to automatically join the 1v1 arena!

### 3. Production Build
```bash
npm run build
npm run preview
```
