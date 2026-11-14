/* EASY-TUBER desktop app (Electron main process). */
const { app, BrowserWindow, Menu, session, shell, dialog, globalShortcut, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { start } = require('./server');
const vcam = require('./vcam');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const BG = '#000000';
let mainWindow = null;
let origin = '';
let srv = null;

/* Global hotkeys for switching avatars and playing actions. The editor sends its bindings through
   the local server; they work while another program (a game) has focus. The server plays an action
   on every page, or sends an avatar switch to the editor as a "hotkey" event.
   Returns which ones the system accepted. */
function setHotkeys(bindings) {
  globalShortcut.unregisterAll();
  return bindings.map(({ accelerator, action }) => {
    let ok = false;
    try { ok = globalShortcut.register(accelerator, () => srv && srv.trigger(action)); } catch (e) { ok = false; }
    return { accelerator, ok };
  });
}
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopCamera(); });

/* Virtual camera: a hidden copy of the stage page is drawn off screen, and its frames are sent
   to the OBS Virtual Camera driver (see vcam.js). The page is the same one OBS loads, so the
   mic, blinks and avatar switches reach it the same way. */
const CAM_W = 1920, CAM_H = 1080;
let camera = null;      // { out, win, timer, frame }
let cameraError = '';

function stopCamera() {
  if (!camera) return;
  const c = camera;
  camera = null;
  clearInterval(c.timer);
  try { c.out.close(); } catch (e) { /* already gone */ }
  if (c.win && !c.win.isDestroyed()) c.win.destroy();
}

async function startCamera() {
  if (camera) return;
  cameraError = '';
  // macOS asks before a program may touch cameras at all
  if (process.platform === 'darwin') { try { await systemPreferences.askForMediaAccess('camera'); } catch (e) { /* try anyway */ } }
  let out;
  try { out = await vcam.open(CAM_W, CAM_H); } catch (e) { cameraError = e.message; return; }
  if (camera) { out.close(); return; }   // started twice at once
  const win = new BrowserWindow({
    show: false, width: CAM_W, height: CAM_H, useContentSize: true, backgroundColor: '#000000',
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  const c = camera = { out, win, timer: null, frame: null };
  win.webContents.setFrameRate(vcam.FPS);
  win.webContents.on('paint', (_e, _dirty, image) => {
    const size = image.getSize();   // bigger than asked on a scaled display
    const img = size.width === CAM_W && size.height === CAM_H ? image : image.resize({ width: CAM_W, height: CAM_H });
    c.frame = img.toBitmap();
  });
  // a still picture paints nothing new, but the camera goes blank unless frames keep coming
  c.timer = setInterval(() => {
    if (!c.frame) return;
    try { c.out.send(c.frame); } catch (e) { cameraError = 'The virtual camera stopped: ' + e.message; stopCamera(); }
  }, 1000 / vcam.FPS);
  win.on('closed', () => { if (camera === c) { c.win = null; stopCamera(); } });
  win.loadURL(origin + '/?stage=1&cam=1');
}

// from the editor, through the local server: on = true / false, or nothing for the status only
async function setCamera(on) {
  if (on === true) await startCamera();
  else if (on === false) { stopCamera(); cameraError = ''; }
  return { on: !!camera, device: vcam.DEVICE_NAME, error: cameraError };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(boot).catch((e) => {
    dialog.showErrorBox('EASY-TUBER could not start', String(e && e.stack || e));
    app.quit();
  });
}

/* The avatar file lives in the user's app-data folder. On first run, pick up an avatar
   saved by the old browser version (saved/avatar.pngtuber.json next to the app). */
function avatarFile() {
  const file = path.join(app.getPath('userData'), 'avatar.easytuber.json');
  if (!fs.existsSync(file)) {
    const old = [ROOT, path.dirname(process.execPath), path.join(process.execPath, '..', '..'), path.join(process.execPath, '..', '..', '..')]
      .map((d) => path.join(d, 'saved', 'avatar.pngtuber.json'));
    for (const f of old) {
      try {
        if (fs.existsSync(f)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(f, file); break; }
      } catch (e) { /* ignore */ }
    }
  }
  return file;
}

async function boot() {
  // Windows: no menu bar. macOS needs an app menu, or Cmd+Q and copy/paste in text fields stop working.
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null);

  // the microphone (and clipboard for "Copy URL") are the only permissions the app needs
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (permission === 'media') return cb(!(details.mediaTypes || []).includes('video'));
    cb(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));

  // the user's own actions: one file per action, loaded by every page (see js/actions/README.md)
  const actionsDir = path.join(app.getPath('userData'), 'actions');
  try { fs.mkdirSync(actionsDir, { recursive: true }); } catch (e) { /* the folder is made when it's opened */ }
  const openFolder = async () => {
    try { fs.mkdirSync(actionsDir, { recursive: true }); } catch (e) { return 'Could not create the actions folder: ' + e.message; }
    return shell.openPath(actionsDir);   // '' when it opened, or the reason it didn't
  };

  srv = await start({ root: ROOT, saveFile: avatarFile(), onHotkeys: setHotkeys, onVcam: setCamera, actionsDir, onOpenFolder: openFolder });
  origin = `http://localhost:${srv.port}`;
  createMainWindow();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'EASY-TUBER', icon: ICON, backgroundColor: BG, show: false,
    // the intro video has sound, so let it start without a click
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(origin + '/');
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
}

// every window (editor, stage): keep navigation inside the app, open real links in the browser
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin + '/') && url.includes('stage=1')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960, height: 540, useContentSize: true, title: 'EASY-TUBER Stage', icon: ICON, backgroundColor: '#000000', autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin + '/')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (k === 'f12' || (input.control && input.shift && k === 'i')) { wc.toggleDevTools(); e.preventDefault(); }
    else if (k === 'f5' || (input.control && k === 'r')) { wc.reload(); e.preventDefault(); }
  });
  // "Save file" downloads: always ask where to save
  wc.session.on('will-download', (_ev, item) => {
    item.setSaveDialogOptions({ title: 'Save avatar', filters: [{ name: 'EASY-TUBER avatar', extensions: ['json'] }] });
  });
});

app.on('window-all-closed', () => app.quit());
