const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function patchGameRuntime(mainWindow) {
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (() => {
        const waitForGame = () => {
          if (!window.G || !window.fireWeapon || !window.cycleWeapon || !window.shots || !window.tone) {
            setTimeout(waitForGame, 200);
            return;
          }

          if (window.__axiomModPatched) return;
          window.__axiomModPatched = true;

          window.G.wEnergy = window.G.wEnergy || {};
          window.G.wEnergy['nova-rifle'] = 28;

          if (window.STAGES && !window.STAGES.some(s => s.id === 'mod-void')) {
            window.STAGES.push({
              id: 'mod-void',
              name: 'MOD VOID',
              boss: 'NOVA RIFT',
              weapon: 'nova-rifle',
              wcol: '#67f7ff',
              sky: ['#050814', '#0d1738', '#1d2d67'],
              plat: '#1a2347',
              platEdge: '#67f7ff',
              amb: 'glitch',
              song: 'world'
            });
          }

          window.G.beaten = window.G.beaten || {};
          window.G.beaten['mod-void'] = true;
          window.G.weapon = 'nova-rifle';

          const originalFireWeapon = window.fireWeapon;
          const originalCycleWeapon = window.cycleWeapon;

          window.fireWeapon = function (p) {
            if ((window.G && window.G.weapon) === 'nova-rifle') {
              const dir = p.face;
              const x = p.x + (dir > 0 ? p.w : -6);
              const y = p.y + 12;

              if ((window.G.wEnergy['nova-rifle'] || 0) <= 0) {
                if (window.SFX && window.SFX.blip) window.SFX.blip();
                return;
              }

              window.G.wEnergy['nova-rifle'] = Math.max(0, (window.G.wEnergy['nova-rifle'] || 0) - 2);
              const spread = [-1.3, 0, 1.3];

              for (const v of spread) {
                window.shots.push({
                  x: x + (dir > 0 ? 0 : -10),
                  y: y - 2 + v * 2,
                  vx: dir * 15,
                  vy: v * 1.4,
                  w: 18,
                  h: 9,
                  dmg: 6,
                  col: '#67f7ff',
                  type: 'nova-rifle',
                  life: 70,
                  trail: true
                });
              }

              if (window.tone) window.tone(900, .08, 'square', .08, -500);
              return;
            }

            return originalFireWeapon.call(this, p);
          };

          window.cycleWeapon = function () {
            const wl = window.tap ? window.tap('WL') : false;
            const wr = window.tap ? window.tap('WR') : false;

            if (!wl && !wr) return originalCycleWeapon.call(this);

            const owned = ['buster', ...(window.STAGES ? window.STAGES.filter(s => window.G.beaten[s.id]).map(s => s.id) : []), 'nova-rifle'];
            let i = owned.indexOf(window.G.weapon);
            if (i < 0) i = 0;

            i = (i + (wl ? -1 : 1) + owned.length) % owned.length;
            window.G.weapon = owned[i];

            if (window.SFX && window.SFX.blip) window.SFX.blip();
          };

          if (window.toast) window.toast('MOD LOADED — NOVA RIFLE READY');
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
