import { NetworkManager } from './network/network-manager';
import { FPSController } from './fps-controller';
import { GameModeManager } from './gamemodes/game-mode-manager';
import { GameModeType } from './gamemodes/types';
import { LobbyFiller } from './ai/lobby-filler';
import { MapManager } from './maps/map-manager';
import { MapId } from './maps/types';
import { gameState } from './game-state';

export class LobbyManager {
  private networkManager: NetworkManager;
  private controller: FPSController;
  public gameModeManager?: GameModeManager;
  public lobbyFiller?: LobbyFiller;
  public mapManager?: MapManager;
  public activeRoomCode: string | null = null;
  public isOfflinePractice = true;

  constructor(
    networkManager: NetworkManager,
    controller: FPSController,
    gameModeManager?: GameModeManager,
    lobbyFiller?: LobbyFiller,
    mapManager?: MapManager
  ) {
    this.networkManager = networkManager;
    this.controller = controller;
    this.gameModeManager = gameModeManager;
    this.lobbyFiller = lobbyFiller;
    this.mapManager = mapManager;

    // Link mapManager to networkManager for map syncing
    this.networkManager.mapManager = mapManager;
    gameState.controller = controller;
    gameState.mapManager = mapManager;

    this.initLobbyEvents();
    this.initModeSelectorEvents();
    this.initMapSelectorEvents();
    this.initPracticeControls();
    this.initNetworkCallbacks();
    this.checkAutoJoinURL();
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private initModeSelectorEvents(): void {
    const modeCards = document.querySelectorAll('.mode-card[data-mode]');
    modeCards.forEach((card) => {
      card.addEventListener('click', () => {
        const modeId = card.getAttribute('data-mode') as GameModeType;
        if (modeId && this.gameModeManager) {
          this.gameModeManager.setMode(modeId, true);
          this.updatePracticeDescription(modeId);
        }
      });
    });
  }

  private initMapSelectorEvents(): void {
    const mapCards = document.querySelectorAll('.map-card');
    mapCards.forEach((card) => {
      card.addEventListener('click', () => {
        const mapId = card.getAttribute('data-map') as MapId;
        if (mapId && this.mapManager) {
          this.mapManager.loadMap(mapId);
        }
      });
    });
  }

  private updatePracticeDescription(modeId: GameModeType): void {
    const desc = document.getElementById('practice-desc');
    if (!desc) return;
    if (modeId === 'tdm') {
      desc.textContent = 'Instantly starts 4v4 Team Deathmatch populated with 3 Blue Bots & 4 Red Bots (8 players total) to 50 kills.';
    } else if (modeId === 'clash') {
      desc.textContent = 'Instantly starts 4v4 Clash Squad populated with 3 Blue Bots & 4 Red Bots (First to 4 Rounds, 15s freeze).';
    } else {
      desc.textContent = 'Instantly starts Battle Royale populated with 9 solo AI operatives in a shrinking storm zone.';
    }
  }

  private initPracticeControls(): void {
    const practiceToggle = document.getElementById('toggle-practice-mode') as HTMLInputElement | null;
    const toggleLabel = document.getElementById('toggle-label-text');
    const startPracticeBtn = document.getElementById('btn-start-practice');

    if (practiceToggle) {
      practiceToggle.addEventListener('change', () => {
        this.isOfflinePractice = practiceToggle.checked;
        if (this.lobbyFiller) {
          this.lobbyFiller.isOfflinePractice = this.isOfflinePractice;
        }
        if (toggleLabel) {
          toggleLabel.textContent = this.isOfflinePractice ? 'Offline Practice: ON' : 'Offline Practice: OFF';
          toggleLabel.style.color = this.isOfflinePractice ? '#f59e0b' : '#94a3b8';
        }
      });
    }

    if (startPracticeBtn) {
      startPracticeBtn.addEventListener('click', () => {
        const currentMode = this.gameModeManager?.activeMode?.id || 'tdm';
        console.log(`[LOBBY] Starting Offline Practice match in mode: ${currentMode}`);

        // 1. Auto-fill entire match slots with tactical bots
        this.lobbyFiller?.fillLobby(currentMode, true);

        // 2. Hide Lobby UI
        this.hideLobby();

        // 3. Trigger 3-second countdown & match startup sequence with invulnerability shield
        gameState.startMatchSequence(() => {
          this.gameModeManager?.activeMode?.start();
        });
      });
    }
  }

  private initNetworkCallbacks(): void {
    // Progress messages during ICE gathering and WebRTC DataChannel handshake
    this.networkManager.onConnectingProgress = (status: string) => {
      this.updateConnectingStatus(status);
    };

    this.networkManager.onConnectingError = (error: string) => {
      this.showConnectingError(error);
    };

    // Once both players connect, fill open slots with bots, hide overlays, and start match sequence!
    this.networkManager.onConnected = (peerId: string) => {
      console.log(`[LOBBY] Match connection established with opponent: ${peerId}`);
      
      const currentMode = this.gameModeManager?.activeMode?.id || 'tdm';
      
      // Auto-fill remaining open slots with bots assigned to corresponding teams
      this.lobbyFiller?.fillLobby(currentMode, false);

      this.hideConnectingOverlay();
      this.hideLobby();
      
      // Start 3-second countdown and match sequence
      gameState.startMatchSequence(() => {
        const modeTitle = this.gameModeManager?.activeMode?.title || '1V1 COMBAT';
        this.networkManager.showRoundBanner(`⚔️ OPPONENT CONNECTED — ${modeTitle} START!`);
        this.gameModeManager?.activeMode?.start();
      });
    };

    this.networkManager.onDisconnected = () => {
      console.log('[LOBBY] Opponent disconnected.');
      this.networkManager.showRoundBanner('⚠️ OPPONENT DISCONNECTED');
    };
  }

  private initLobbyEvents(): void {
    const hostBtn = document.getElementById('btn-host-match');
    const hostCard = document.getElementById('host-details-card');
    const displayRoomCode = document.getElementById('display-room-code');
    const copyLinkBtn = document.getElementById('btn-copy-link');
    const enterHostBtn = document.getElementById('btn-enter-hosted');
    const copyFeedback = document.getElementById('copy-feedback');

    const joinBtn = document.getElementById('btn-join-match');
    const joinInput = document.getElementById('input-join-code') as HTMLInputElement | null;
    const joinError = document.getElementById('join-error');

    const copyHudBtn = document.getElementById('btn-hud-copy-room');
    const cancelConnectingBtn = document.getElementById('btn-cancel-connecting');

    // 1. Host 1v1 Match Click
    if (hostBtn) {
      hostBtn.addEventListener('click', () => {
        const roomCode = this.generateRoomCode();
        this.activeRoomCode = roomCode;

        // Update URL query parameter
        this.updateURLWithRoom(roomCode);

        // Display Room Code & show Copy Link card
        if (displayRoomCode) displayRoomCode.textContent = roomCode;
        if (hostCard) hostCard.classList.remove('hidden');
        hostBtn.classList.add('hidden');

        // Initialize PeerJS Host
        this.networkManager.host(roomCode);
      });
    }

    // 2. Copy Match Link Click
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', async () => {
        if (!this.activeRoomCode) return;
        const matchUrl = `${window.location.origin}${window.location.pathname}?room=${this.activeRoomCode}`;
        try {
          await navigator.clipboard.writeText(matchUrl);
          if (copyFeedback) {
            copyFeedback.classList.add('visible');
            setTimeout(() => copyFeedback.classList.remove('visible'), 2500);
          }
        } catch (err) {
          console.error('Clipboard copy failed:', err);
        }
      });
    }

    // 3. Enter Arena from Host view (Single-player practice while waiting)
    if (enterHostBtn) {
      enterHostBtn.addEventListener('click', () => {
        this.hideLobby();
        this.controller.lock();
      });
    }

    // 4. Join Match Click
    if (joinBtn && joinInput) {
      const handleJoin = () => {
        const code = joinInput.value.toUpperCase().trim();
        if (code.length < 3) {
          if (joinError) {
            joinError.textContent = 'Please enter a valid room code (min 3 chars).';
            joinError.classList.remove('hidden');
          }
          return;
        }

        this.activeRoomCode = code;
        this.updateURLWithRoom(code);

        // Show Connecting Overlay
        this.showConnectingOverlay(code);

        // Initialize PeerJS Joiner & connect to Host
        this.networkManager.join(code);
      };

      joinBtn.addEventListener('click', handleJoin);
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleJoin();
      });
    }

    // 5. In-HUD Copy Room Link button
    if (copyHudBtn) {
      copyHudBtn.addEventListener('click', async () => {
        const room = this.networkManager.roomCode || this.activeRoomCode || 'GLOBAL';
        const matchUrl = `${window.location.origin}${window.location.pathname}?room=${room}`;
        try {
          await navigator.clipboard.writeText(matchUrl);
          copyHudBtn.textContent = '✓';
          setTimeout(() => (copyHudBtn.textContent = '🔗'), 1500);
        } catch (err) {
          console.error('Copy failed:', err);
        }
      });
    }

    // 6. Cancel / Return to Menu Button
    if (cancelConnectingBtn) {
      cancelConnectingBtn.addEventListener('click', () => {
        this.networkManager.cleanup();
        this.activeRoomCode = null;
        // Reset URL without query param
        window.history.pushState({}, '', window.location.pathname);
        this.hideConnectingOverlay();
        this.showLobby();
        gameState.setMenu();
      });
    }
  }

  // Auto-join check on page load: if URL has ?room=CODE, show 'Connecting to Host...' loading screen & connect
  private checkAutoJoinURL(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');

    if (roomParam && roomParam.trim().length > 0) {
      const code = roomParam.toUpperCase().trim();
      this.activeRoomCode = code;
      console.log(`[LOBBY] Auto-joining room from URL parameter: ?room=${code}`);

      // Show dedicated 'Connecting to Host...' loading screen
      this.showConnectingOverlay(code);

      // Auto-connect to specified host room code via PeerJS
      this.networkManager.join(code);
    }
  }

  public showConnectingOverlay(roomCode: string): void {
    const overlay = document.getElementById('connecting-overlay');
    const codeElem = document.getElementById('connecting-room-code');
    const statusElem = document.getElementById('connecting-status-text');
    const titleElem = document.getElementById('connecting-title');
    const cancelBtn = document.getElementById('btn-cancel-connecting');

    if (codeElem) codeElem.textContent = roomCode;
    if (titleElem) titleElem.textContent = `JOINING ROOM [${roomCode}]...`;
    if (statusElem) {
      statusElem.textContent = `Joining Room [${roomCode}]... Connecting to Peer (STUN/TURN WebRTC)...`;
      statusElem.style.color = '#00f0ff';
    }
    if (cancelBtn) {
      cancelBtn.innerHTML = '<span>CANCEL & RETURN TO LOBBY</span>';
    }

    if (overlay) {
      overlay.classList.remove('hidden');
    }
    this.hideLobby();
    gameState.setWaitingLobby();
  }

  public hideConnectingOverlay(): void {
    const overlay = document.getElementById('connecting-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  public updateConnectingStatus(status: string): void {
    const statusElem = document.getElementById('connecting-status-text');
    if (statusElem) {
      statusElem.textContent = status;
      statusElem.style.color = '#00f0ff';
    }
  }

  public showConnectingError(error: string): void {
    const statusElem = document.getElementById('connecting-status-text');
    const titleElem = document.getElementById('connecting-title');
    const cancelBtn = document.getElementById('btn-cancel-connecting');

    if (titleElem) titleElem.textContent = 'ROOM NOT FOUND / OFFLINE';
    if (statusElem) {
      statusElem.textContent = `❌ ${error || 'Room not found or host disconnected.'}`;
      statusElem.style.color = '#ef4444';
    }
    if (cancelBtn) {
      cancelBtn.innerHTML = '<span>← RETURN TO MENU</span>';
    }
  }

  private updateURLWithRoom(roomCode: string): void {
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(roomCode)}`;
    window.history.pushState({ room: roomCode }, '', newUrl);
  }

  public hideLobby(): void {
    const lobby = document.getElementById('lobby-overlay');
    if (lobby) {
      lobby.classList.add('hidden');
    }
  }

  public showLobby(): void {
    const lobby = document.getElementById('lobby-overlay');
    if (lobby) {
      lobby.classList.remove('hidden');
    }
    gameState.setMenu();
  }
}
