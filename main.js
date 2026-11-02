const { app, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function normalizeStage(stage, fallbackId = 'mod-void') {
  if (!stage || typeof stage !== 'object') return null;

  const normalized = {
    id: stage.id || fallbackId,
    name: stage.name || 'MOD STAGE',
    boss: stage.boss || 'UNKNOWN BOSS',
    weapon: stage.weapon || 'buster',
    wcol: stage.wcol || '#67f7ff',
    sky: Array.isArray(stage.sky) && stage.sky.length >= 3 ? stage.sky : ['#050814', '#0d1738', '#1d2d67'],
    plat: stage.plat || '#1a2347',
    platEdge: stage.platEdge || '#67f7ff',
    amb: stage.amb || 'glitch',
    song: stage.song || 'world',
    ...stage
  };

  if (!Array.isArray(normalized.sky) || normalized.sky.length < 3) {
    normalized.sky = ['#050814', '#0d1738', '#1d2d67'];
  }

  return normalized;
}

function loadMods() {
  const modsDir = path.join(__dirname, 'mods');
  const manifestPath = path.join(modsDir, 'manifest.json');

  if (!fs.existsSync(modsDir) || !fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = Array.isArray(manifest.mods) ? manifest.mods : [];
    const mods = [];

    for (const rel of entries) {
      if (typeof rel !== 'string') continue;

      const filePath = path.resolve(modsDir, rel);
      if (!fs.existsSync(filePath)) continue;

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const mod = JSON.parse(raw);
        if (mod && typeof mod === 'object') mods.push(mod);
      } catch (error) {
        console.warn(`Failed to parse mod: ${rel}`, error);
      }
    }

    return mods;
  } catch (error) {
    console.warn('Failed to load mods manifest:', error);
    return [];
  }
}

function patchGameRuntime(mainWindow) {
  const mods = loadMods();

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (() => {
        const waitForGame = () => {
          if (!window.G || !window.fireWeapon || !window.cycleWeapon || !window.shots || !window.tone) {
            setTimeout(waitForGame, 200);
            return;
          }

          const mods = ${JSON.stringify(mods)};
          const customStages = [];
          const customWeapons = {};

          for (const mod of mods || []) {
            if (mod && mod.type === 'level' && mod.stage) {
              const stage = typeof window.normalizeStage === 'function'
                ? window.normalizeStage(mod.stage, mod.stage && mod.stage.id ? mod.stage.id : 'mod-void')
                : normalizeStage(mod.stage, mod.stage && mod.stage.id ? mod.stage.id : 'mod-void');
              if (stage) customStages.push(stage);
            }

            if (mod && mod.type === 'gun' && Array.isArray(mod.guns)) {
              for (const gun of mod.guns) {
                if (gun && gun.id) {
                  customWeapons[gun.id] = {
                    ...gun,
                    color: gun.color || '#67f7ff',
                    damage: Number(gun.damage) || 6,
                    fireRate: Number(gun.fireRate) || 4,
                    projectile: gun.projectile || 'plasma',
                    burst: Number(gun.burst) || 3,
                    description: gun.description || 'Custom gun'
                  };
                }
              }
            }
          }

          if (!window.__axiomModPatched) {
            window.__axiomModPatched = true;

            if (!window.G) window.G = {};
            window.G.beaten = window.G.beaten || {};
            window.G.wEnergy = window.G.wEnergy || {};
            window.G.corruption = window.G.corruption || 0;
            window.G.maxCorruption = window.G.maxCorruption || 100;
            window.G.combo = window.G.combo || 0;
            window.G.comboTimer = window.G.comboTimer || 0;
            window.G.axiomRank = window.G.axiomRank || 'C';
            window.G.memoryLogs = window.G.memoryLogs || [];
            window.G.challengeSeeded = window.G.challengeSeeded || {};

            if (customStages.length) {
              window.STAGES = Array.isArray(window.STAGES) ? window.STAGES : [];
              for (const stage of customStages) {
                if (!window.STAGES.some(s => s.id === stage.id)) {
                  window.STAGES.push(stage);
                }
                window.G.beaten[stage.id] = true;
              }
            }

            for (const gunId of Object.keys(customWeapons)) {
              window.G.wEnergy[gunId] = 28;
            }

            if (!window.G.weapon && customStages.length) {
              const firstWeapon = customStages[0].weapon;
              if (firstWeapon && customWeapons[firstWeapon]) {
                window.G.weapon = firstWeapon;
              }
            }

            const originalFireWeapon = window.fireWeapon;
            const originalCycleWeapon = window.cycleWeapon;

            const getAxiomRank = (score) => {
              if (score >= 1200) return 'AXIOM';
              if (score >= 800) return 'S';
              if (score >= 500) return 'A';
              if (score >= 250) return 'B';
              return 'C';
            };

            const addCombo = (points, source = 'kill') => {
              if (!window.G) return;
              window.G.combo = (window.G.combo || 0) + points;
              window.G.comboTimer = 90;
              const rank = getAxiomRank(window.G.combo);
              if (rank !== window.G.axiomRank) {
                window.G.axiomRank = rank;
                if (window.toast) window.toast('AXIOM RANK — ' + rank);
              }
              if (source === 'dash') {
                window.G.corruption = Math.min(window.G.maxCorruption, (window.G.corruption || 0) + 3);
              }
            };

            const addCorruption = (amount) => {
              if (!window.G) return;
              window.G.corruption = Math.min(window.G.maxCorruption || 100, Math.max(0, (window.G.corruption || 0) + amount));
              if (window.G.corruption >= (window.G.maxCorruption || 100)) {
                window.G.glitchTimer = 180;
                if (window.toast) window.toast('WORLD CORRUPTION CRITICAL');
              }
            };

            const applyCorruptionEffects = () => {
              if (!window.G || !window.player || !window.G.corruption) return;
              const intensity = window.G.corruption / (window.G.maxCorruption || 100);
              if (Math.random() < 0.018 + intensity * 0.04) {
                if (window.parts) {
                  for (const p of window.parts) {
                    if (p && p.life) p.life = Math.max(0, p.life - 1);
                  }
                }
              }
              if (intensity > 0.5) {
                window.player.inv = Math.max(window.player.inv || 0, 4);
                if (window.player.hp > 1 && Math.random() < 0.02) {
                  window.player.hp = Math.max(1, window.player.hp - 1);
                }
              }
              if ((window.G.glitchTimer || 0) > 0) {
                window.G.glitchTimer -= 1;
                if ((window.G.glitchTimer % 12) === 0 && window.parts) {
                  for (const p of window.parts) {
                    if (p && p.col) p.col = (p.col === '#fff') ? '#ff2e88' : '#fff';
                  }
                }
              }
            };

            const memoryTexts = {
              origin: 'AXIOM was assembled from stolen memory and dead pilot cores.',
              protocol: 'The Protocol catalogues the world, then rewrites it into a mirror.',
              corruption: 'The corruption is memory refusing to be erased.',
              mirror: 'The mirror does not control the bosses. It reveals what they already lost.'
            };

            const unlockMemoryLog = (key) => {
              if (!window.G) return;
              if (!window.G.memoryLogs) window.G.memoryLogs = [];
              if (window.G.memoryLogs.includes(key)) return;
              window.G.memoryLogs.push(key);
              if (window.toast) window.toast('MEMORY FRAGMENT — ' + String(key).toUpperCase());
              if (memoryTexts[key]) {
                console.log('[AXIOM]', memoryTexts[key]);
              }
            };

            const maybeSeedStageFeatures = () => {
              try {
                const stageKey = window.G && window.G.stage ? String(window.G.stage) : 'global';
                if (!window.G.challengeSeeded[stageKey]) {
                  window.G.challengeSeeded[stageKey] = true;
                  const currentLevel = window.curLevel || window.level || null;
                  if (currentLevel && Array.isArray(currentLevel.items)) {
                    currentLevel.items.push({
                      x: (currentLevel.w || 960) * 0.5 - 60,
                      y: 160,
                      w: 18,
                      h: 18,
                      type: 'memory',
                      label: 'MEMORY',
                      value: 'origin',
                      glow: true
                    });
                    currentLevel.items.push({
                      x: (currentLevel.w || 960) * 0.5 + 60,
                      y: 170,
                      w: 18,
                      h: 18,
                      type: 'challenge',
                      label: 'NODE',
                      value: 'survive-30',
                      glow: true
                    });
                  }
                }
              } catch (error) {
                console.warn('[AXIOM] seed stage failed', error);
              }
            };

            const patchEnemyVariant = () => {
              if (!window.Enemy || window.Enemy.__axiomPatched) return;
              const proto = window.Enemy.prototype;
              const originalHurt = proto.hurt;

              proto.hurt = function (d, source) {
                let damage = Number(d) || 1;
                if (this.variant === 'shield') damage *= 0.45;
                if (this.variant === 'dash') {
                  this.vx *= 1.5;
                }
                if (this.variant === 'glitch' && Math.random() < 0.05) {
                  this.x = Math.max(0, Math.min((window.curLevel && window.curLevel.w) || 960, this.x + (Math.random() < 0.5 ? -32 : 32)));
                }
                if (this.variant === 'mimic' && window.player) {
                  this.x += (window.player.x - this.x) * 0.02;
                  this.y += (window.player.y - this.y) * 0.02;
                }

                const result = originalHurt ? originalHurt.call(this, damage, source) : null;
                if (this.dead) {
                  addCombo(35, 'kill');
                  if (Math.random() < 0.22) addCorruption(8);
                  if (Math.random() < 0.15) unlockMemoryLog('origin');
                }
                return result;
              };

              window.Enemy.__axiomPatched = true;
            };

            const patchPlayer = () => {
              if (!window.Player || window.Player.__axiomPatched) return;
              const originalHurt = window.Player.prototype.hurt;

              window.Player.prototype.hurt = function (d) {
                let damage = Number(d) || 1;
                if (window.G && (window.G.corruption || 0) > 35 && Math.random() < 0.05) {
                  damage += 1;
                }
                const result = originalHurt ? originalHurt.call(this, damage) : null;
                if (window.G && window.G.corruption && this.hp && this.hp > 0) {
                  this.hp = Math.max(1, this.hp - Math.max(0, Math.floor((window.G.corruption || 0) / 50)));
                }
                return result;
              };

              window.Player.__axiomPatched = true;
            };

            patchEnemyVariant();
            patchPlayer();

            let lastRank = window.G.axiomRank || 'C';

            setInterval(() => {
              try {
                if (!window.G) return;
                if (window.G.corruption > 0) applyCorruptionEffects();
                if ((window.G.comboTimer || 0) > 0) {
                  window.G.comboTimer -= 1;
                } else {
                  window.G.combo = Math.max(0, (window.G.combo || 0) - 2);
                }

                const nextRank = getAxiomRank(window.G.combo || 0);
                if (nextRank !== lastRank) {
                  lastRank = nextRank;
                  window.G.axiomRank = nextRank;
                  if (window.toast) window.toast('AXIOM RANK — ' + nextRank);
                }

                maybeSeedStageFeatures();
              } catch (error) {
                console.warn('[AXIOM] runtime tick failed', error);
              }
            }, 140);

            window.fireWeapon = function (p) {
              const result = originalFireWeapon.call(this, p);
              if (window.G && window.G.weapon && window.G.weapon !== 'buster' && (window.G.corruption || 0) > 15) {
                const bonus = Math.min(5, Math.floor((window.G.corruption || 0) / 20));
                if (window.shots && Array.isArray(window.shots)) {
                  for (const shot of window.shots) {
                    if (shot && shot.dmg && shot.type) {
                      shot.dmg += bonus * 0.18;
                    }
                  }
                }
              }
              return result;
            };

            window.cycleWeapon = function () {
              const result = originalCycleWeapon.call(this);
              if (window.G && window.G.weapon) {
                window.G.axiomRank = getAxiomRank(window.G.combo || 0);
              }
              return result;
            };

            if (window.toast) window.toast('AXIOM PROTOCOL — CORRUPTION SYSTEM ONLINE');
          }
        };

        waitForGame();
      })();
    `);
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#070b1a',
    autoHideMenuBar: true,
    title: 'Axiom Protocol',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'Axiom Protocol.html'));
  patchGameRuntime(mainWindow);
  mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
