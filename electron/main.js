/* EASY-TUBER desktop app (Electron main process). */
const { app, BrowserWindow, Menu, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { start } = require('./server');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const BG = '#000000';
let mainWindow = null;
let origin = '';

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

  const srv = await start({ root: ROOT, saveFile: avatarFile() });
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
          width: 640, height: 720, title: 'EASY-TUBER Stage', icon: ICON, backgroundColor: '#000000', autoHideMenuBar: true,
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
