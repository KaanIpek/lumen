/*
 * LUMEN — desktop shell (Electron)
 * -------------------------------------------------------------
 * Loads the same `index.html` the web build serves. There is no separate
 * desktop version of the game and there must never be one: a fork would drift,
 * and the whole point is that a fix in the corridor is a fix everywhere.
 *
 * What this file adds is the things a browser tab cannot do — a real window, a
 * real fullscreen, a real quit, and the Steamworks bridge.
 *
 * Steam integration is OPTIONAL and lazily loaded. `steamworks.js` is a native
 * module; if it isn't installed (or the Steam client isn't running) the game
 * starts anyway with `LUMEN_STEAM.ready === false`, and `js/steam.js` no-ops.
 * A missing overlay must never be the reason someone can't play.
 */
'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Set in steam_appid.txt next to this file. 480 is Steam's public test app —
// fine for local development, and MUST be replaced before shipping.
const APP_ID = readAppId();

function readAppId() {
  try {
    const p = path.join(__dirname, 'steam_appid.txt');
    if (fs.existsSync(p)) return parseInt(fs.readFileSync(p, 'utf8').trim(), 10) || 480;
  } catch (e) { /* fall through */ }
  return 480;
}

// ---- Steamworks ------------------------------------------------------------
let steam = null;
function initSteam() {
  try {
    // eslint-disable-next-line global-require
    const steamworks = require('steamworks.js');
    steam = steamworks.init(APP_ID);
    return true;
  } catch (e) {
    console.log('[LUMEN] Steam unavailable (' + e.message + ') — running standalone.');
    steam = null;
    return false;
  }
}

// Every call the renderer can make, listed explicitly. Nothing else crosses.
function wireBridge() {
  ipcMain.handle('steam:ready', () => !!steam);
  ipcMain.handle('steam:name', () => (steam ? steam.localplayer.getName() : ''));
  ipcMain.handle('steam:unlock', (_e, id) => {
    if (!steam) return false;
    try { steam.achievement.activate(String(id)); return true; } catch (err) { return false; }
  });
  ipcMain.handle('steam:score', (_e, score, board) => {
    if (!steam) return false;
    // Boards are created in the Steamworks partner site; findOrCreate keeps the
    // desktop build working before they exist.
    try {
      const name = board === 'daily' ? 'DAILY' : 'ALLTIME';
      steam.leaderboard
        .findOrCreate(name, steam.leaderboard.LeaderboardSortMethod.Descending,
          steam.leaderboard.LeaderboardDisplayType.Numeric)
        .then((lb) => steam.leaderboard.uploadScore(lb, score, steam.leaderboard.LeaderboardUploadScoreMethod.KeepBest))
        .catch(() => {});
      return true;
    } catch (err) { return false; }
  });
  // Steam Cloud stores the same transfer string the player can copy by hand.
  ipcMain.handle('steam:cloudWrite', (_e, data) => {
    if (!steam) return false;
    try { return !!steam.cloud.writeFile('lumen.save', String(data)); } catch (err) { return false; }
  });
  ipcMain.handle('steam:cloudRead', () => {
    if (!steam) return null;
    try { return steam.cloud.fileExists('lumen.save') ? steam.cloud.readFile('lumen.save') : null; }
    catch (err) { return null; }
  });
}

// ---- window ----------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#05060f',
    show: false,
    autoHideMenuBar: true,
    title: 'LUMEN',
    icon: path.join(__dirname, '..', 'assets', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,          // preload needs ipcRenderer
      backgroundThrottling: false,
    },
  });

  // Show only once painted, so nobody sees a white rectangle before the corridor.
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // The game has its own fullscreen button; keep F11 working as players expect.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
  });

  // Any link the game offers (the privacy policy) opens in the real browser
  // rather than replacing the game with a web page it cannot come back from.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });

  return win;
}

// One instance only: two copies fighting over the same Steam session and the
// same save file is a good way to lose progress.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    initSteam();
    wireBridge();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { try { if (steam) steam.callback.runCallbacks(); } catch (e) {} });
}
