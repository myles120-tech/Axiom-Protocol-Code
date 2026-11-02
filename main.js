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
              const stage = normalizeStage ? normalizeStage(mod.stage, mod.stage && mod.stage.id ? mod.stage.id : 'mod-void') : mod.stage;
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

            window.G = window.G || {};
            window.G.beaten = window.G.beaten || {};
            window.G.wEnergy = window.G.wEnergy || {};

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

            window.fireWeapon = function (p) {
              const weaponId = window.G && window.G.weapon ? window.G.weapon : null;
              if (!weaponId || !customWeapons[weaponId]) {
                return originalFireWeapon.call(this, p);
              }

              const gun = customWeapons[weaponId];
              const dir = p.face;
              const x = p.x + (dir > 0 ? p.w : -6);
              const y = p.y + 12;

              if ((window.G.wEnergy[weaponId] || 0) <= 0) {
                if (window.SFX && window.SFX.blip) window.SFX.blip();
                return;
              }

              window.G.wEnergy[weaponId] = Math.max(0, (window.G.wEnergy[weaponId] || 0) - 2);

              const count = Math.max(1, Number(gun.burst) || 3);
              const spread = [];
              for (let i = 0; i < count; i++) {
                spread.push((i - (count - 1) / 2) * 1.2);
              }

              for (const v of spread) {
                window.shots.push({
                  x: x + (dir > 0 ? 0 : -10),
                  y: y - 2 + v * 2,
                  vx: dir * (gun.projectile === 'plasma' ? 15 : 12),
                  vy: v * (gun.projectile === 'plasma' ? 1.6 : 1.2),
                  w: 18,
                  h: 9,
                  dmg: Number(gun.damage) || 6,
                  col: gun.color || '#67f7ff',
                  type: weaponId,
                  life: 70,
                  trail: true
                });
              }

              if (window.tone) window.tone(900, .08, 'square', .08, -500);
              return;
            };

            window.cycleWeapon = function () {
              const wl = window.tap ? window.tap('WL') : false;
              const wr = window.tap ? window.tap('WR') : false;

              if (!wl && !wr) return originalCycleWeapon.call(this);

              const owned = [
                'buster',
                ...(window.STAGES ? window.STAGES.filter(s => window.G.beaten && window.G.beaten[s.id]).map(s => s.id) : []),
                ...Object.keys(customWeapons)
              ];

              let i = owned.indexOf(window.G.weapon);
              if (i < 0) i = 0;

              i = (i + (wl ? -1 : 1) + owned.length) % owned.length;
              window.G.weapon = owned[i];

              if (window.SFX && window.SFX.blip) window.SFX.blip();
            };

            if (window.toast) window.toast('MOD LOADED — CUSTOM LOADOUT READY');
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
