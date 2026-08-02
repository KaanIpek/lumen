/*
 * LUMEN — desktop preload
 * -------------------------------------------------------------
 * The only thing the page can see of Electron. `contextIsolation` is on and
 * `nodeIntegration` is off, so the game's JavaScript has no filesystem, no
 * process, no require — just the five calls listed here.
 *
 * `ready` is resolved eagerly and cached as a plain boolean because `js/steam.js`
 * is synchronous by design: the game must never await anything to draw a frame.
 * Writes are fire-and-forget for the same reason.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let ready = false;
let playerName = '';
let cloud = null;

// Resolve the interesting state once, before the game boots.
async function warm() {
  try {
    ready = await ipcRenderer.invoke('steam:ready');
    if (ready) {
      playerName = await ipcRenderer.invoke('steam:name');
      cloud = await ipcRenderer.invoke('steam:cloudRead');
    }
  } catch (e) { ready = false; }
  // Re-publish with the resolved values; the game reads these lazily.
  bridge.ready = ready;
  bridge.playerName = playerName;
  bridge._cloud = cloud;
}

const bridge = {
  ready: false,
  playerName: '',
  _cloud: null,
  platform: 'steam',
  unlock: (id) => { ipcRenderer.invoke('steam:unlock', id); return true; },
  submitScore: (score, board) => { ipcRenderer.invoke('steam:score', score, board); return true; },
  cloudWrite: (data) => { ipcRenderer.invoke('steam:cloudWrite', data); return true; },
  cloudRead: () => bridge._cloud,
};

contextBridge.exposeInMainWorld('LUMEN_STEAM', bridge);
warm();
