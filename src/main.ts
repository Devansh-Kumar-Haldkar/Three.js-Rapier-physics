import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { physics } from './physics';
import { FPSController } from './fps-controller';
import { DummyManager } from './target-dummy';
import { NetworkManager } from './network/network-manager';
import { LobbyManager } from './lobby';
import { GameModeManager } from './gamemodes/game-mode-manager';
import { BotManager } from './ai/bot-manager';
import { LobbyFiller } from './ai/lobby-filler';
import { WorldLootManager } from './world-loot/loot-manager';
import { MapManager } from './maps/map-manager';
import { scoreManager } from './scoring/score-manager';

class Game {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private clock!: THREE.Clock;
  private controller!: FPSController;
  private dummyManager!: DummyManager;
  private botManager!: BotManager;
  private lootManager!: WorldLootManager;
  private mapManager!: MapManager;
  private lobbyFiller!: LobbyFiller;
  private networkManager!: NetworkManager;
  private lobbyManager!: LobbyManager;
  private gameModeManager!: GameModeManager;

  async start(): Promise<void> {
    // 1. Initialize Three.js Engine & Post-Processing Pipeline
    this.initThree();
    this.initPostProcessing();

    // 2. Initialize Rapier Physics
    await physics.init();

    // 3. Initialize Target Dummies System
    this.dummyManager = new DummyManager(this.scene, this.camera);
    this.dummyManager.spawnDummies();

    // 4. Initialize Network Manager (Prediction & PeerJS WebRTC P2P Data Channels)
    this.networkManager = new NetworkManager(this.scene);

    // 5. Initialize Player Controller
    this.controller = new FPSController(this.camera, this.renderer.domElement, this.scene, {
      walkSpeed: 8.5,
      sprintSpeed: 15.0,
      jumpForce: 11.5,
      acceleration: 48.0,
      friction: 11.0,
      airAcceleration: 14.0,
      mouseSensitivity: 0.0022,
    });

    // 6. Initialize Yuka AI Bot Simulation & NavMesh
    this.botManager = new BotManager(this.scene, this.controller, this.controller.weapon.fx);

    // 7. Initialize World Loot Manager (Health Packs, Ammo Crates, World Weapons with 45s Respawns)
    this.lootManager = new WorldLootManager(this.scene, this.controller, this.botManager);

    // 8. Initialize Map Manager (Desert Outpost, Overgrown Jungle, Neon City with dynamic NavMesh)
    this.mapManager = new MapManager(this.scene, this.controller, this.botManager, this.lootManager, 'desert');

    // Link Target Dummies, AI Bots, and Network Manager to Controller & Weapon
    this.controller.weapon.dummyManager = this.dummyManager;
    this.controller.weapon.botManager = this.botManager;
    this.controller.weapon.networkManager = this.networkManager;
    this.controller.networkManager = this.networkManager;
    this.networkManager.setController(this.controller);

    // Link Score Manager
    scoreManager.networkManager = this.networkManager;
    scoreManager.registerEntity(this.controller);

    // 9. Initialize Game Mode Manager (TDM, Clash Squad, Battle Royale)
    this.gameModeManager = new GameModeManager();
    this.gameModeManager.init({
      scene: this.scene,
      controller: this.controller,
      networkManager: this.networkManager,
    }, 'tdm');
    this.networkManager.gameModeManager = this.gameModeManager;
    scoreManager.gameModeManager = this.gameModeManager;

    // 10. Initialize LobbyFiller Controller (Roster slot calculations & bot allocation)
    this.lobbyFiller = new LobbyFiller(this.networkManager, this.gameModeManager, this.botManager);
    this.lobbyFiller.fillLobby('tdm', true);

    // 11. Initialize Lobby Manager (Mode Selector, Map Selector, PeerJS 1v1 Hosting, Room Code, Auto-Join Check, Practice Toggle)
    this.lobbyManager = new LobbyManager(
      this.networkManager,
      this.controller,
      this.gameModeManager,
      this.lobbyFiller,
      this.mapManager
    );

    // 12. Setup UI and Blocker triggers
    this.initUI();

    // 13. Start Main Animation Loop
    this.clock = new THREE.Clock();
    this.animate();
  }

  private initThree(): void {
    const container = document.getElementById('canvas-container')!;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.scene.add(this.camera);

    // Renderer with PCFSoftShadowMap & ToneMapping
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    container.appendChild(this.renderer.domElement);

    // Window resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private initPostProcessing(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create EffectComposer
    this.composer = new EffectComposer(this.renderer);

    // 1. Scene Render Pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // 2. SSAO Pass (Screen Space Ambient Occlusion for realistic contact shadows)
    const ssaoPass = new SSAOPass(this.scene, this.camera, width, height);
    ssaoPass.kernelRadius = 14;
    ssaoPass.minDistance = 0.005;
    ssaoPass.maxDistance = 0.08;
    this.composer.addPass(ssaoPass);

    // 3. Unreal Bloom Pass (Sci-Fi Glow for neon lines, lasers, muzzle flash, jump pads)
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.68, // Bloom strength
      0.4,  // Bloom radius
      0.82  // Bloom threshold (Emissive elements glow)
    );
    this.composer.addPass(bloomPass);

    // 4. Output Pass (Applies ToneMapping and correct Color Space)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  private initUI(): void {
    const playButton = document.getElementById('play-button');
    if (playButton) {
      playButton.addEventListener('click', () => {
        this.controller.lock();
      });
    }

    const blocker = document.getElementById('blocker');
    if (blocker) {
      blocker.addEventListener('click', (e) => {
        if (e.target === blocker) {
          this.controller.lock();
        }
      });
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.08);

    // Step Rapier Physics
    physics.step(delta);

    // Update Player Movement & Raycast Grounding
    this.controller.update(delta);

    // Update AI Bots (Yuka Steering + FSM Simulation + Visual Sync)
    this.botManager.update(delta);

    // Update Target Dummies & Floating Damage Text
    this.dummyManager.update(delta);

    // Update Active Game Mode (TDM, Clash Squad, Battle Royale)
    this.gameModeManager.update(delta);

    // Update Active Environment Map (Rain particles, lighting)
    this.mapManager.update(delta);

    // Update World Loot & Resupply Crates
    this.lootManager.update(delta);

    // Update Remote Peer Interpolation
    this.networkManager.update(delta);

    // Render Scene with Post-Processing Pipeline
    this.composer.render();
  };
}

// Start Game
const game = new Game();
game.start().catch((err) => {
  console.error('Failed to initialize game:', err);
});
