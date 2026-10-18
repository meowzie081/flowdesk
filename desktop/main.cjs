'use strict';
const { app, BrowserWindow, Menu, shell, session, screen, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { applicationUrl, internalUrl, externalUrl, windowBounds } = require('./security.cjs');
const config = require('./app-config.json');
// Only development builds accept a runtime URL override. No Node bridge is exposed.
const base = applicationUrl(!app.isPackaged && process.env.FLOWDESK_DESKTOP_URL || config.appUrl, app.isPackaged);
let window = null;
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
const online = () => window && !window.isDestroyed() && internalUrl(window.webContents.getURL(), base);
const openBrowser = url => { const safe = externalUrl(url); if (safe)
    shell.openExternal(safe).catch(() => { }); };
function connect() { if (window && !window.isDestroyed())
    window.loadURL(base.href).catch(() => { }); }
function offline() { if (window && !window.isDestroyed())
    window.loadFile(path.join(__dirname, 'offline.html')).catch(() => { }); }
function createWindow() {
    let saved = {};
    try {
        saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    }
    catch { }
    window = new BrowserWindow({ ...windowBounds(saved, screen.getAllDisplays().map(d => d.workArea)), minWidth: 780, minHeight: 600, title: 'FlowDesk', icon: path.join(__dirname, 'icon.png'), show: false, backgroundColor: '#f5f7fa', webPreferences: { partition: 'persist:flowdesk', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: !app.isPackaged } });
    const contents = window.webContents;
    contents.setUserAgent(contents.getUserAgent() + ` FlowDeskDesktop/${app.getVersion()}`);
    window.once('ready-to-show', () => window?.show());
    contents.on('did-finish-load', () => window?.show());
    contents.on('page-title-updated', event => { event.preventDefault(); window?.setTitle('FlowDesk'); });
    contents.on('will-navigate', (event, url) => { if (!internalUrl(url, base)) {
        event.preventDefault();
        openBrowser(url);
    } });
    contents.on('will-redirect', (event, url) => { if (!internalUrl(url, base))
        event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => { if (internalUrl(url, base))
        contents.loadURL(url).catch(() => { });
    else
        openBrowser(url); return { action: 'deny' }; });
    contents.on('did-fail-load', (_event, code, _text, url, isMainFrame) => { if (isMainFrame && code !== -3 && internalUrl(url, base))
        offline(); });
    contents.on('render-process-gone', () => offline());
    window.on('close', () => { try {
        fs.writeFileSync(statePath(), JSON.stringify(window.getNormalBounds()), { mode: 0o600 });
    }
    catch { } });
    window.on('closed', () => { window = null; });
    connect();
}
function menu() {
    const appMenu = process.platform === 'darwin' ? [{ label: 'FlowDesk', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : [];
    Menu.setApplicationMenu(Menu.buildFromTemplate([...appMenu,
        { label: 'Файл', submenu: [{ label: 'Мои отделы', accelerator: 'CmdOrCtrl+Shift+H', click: connect }, { label: 'Переподключиться', accelerator: 'CmdOrCtrl+R', click: () => online() ? window.webContents.reload() : connect() }, { label: 'Открыть сайт в браузере', click: () => openBrowser(base.href) }, { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
        { label: 'Правка', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { label: 'Вид', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
        { label: 'Окно', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
        { label: 'Справка', submenu: [{ label: 'О FlowDesk', click: () => dialog.showMessageBox(window, { type: 'info', title: 'FlowDesk', message: `FlowDesk ${app.getVersion()}`, detail: 'Задачи и обсуждения команды. Данные загружаются с вашего сайта. Для работы нужен интернет.' }) }] }
    ]));
}
if (!app.requestSingleInstanceLock())
    app.quit();
else {
    app.on('second-instance', () => { if (window) {
        if (window.isMinimized())
            window.restore();
        window.show();
        window.focus();
    } });
    app.whenReady().then(() => {
        app.setAppUserModelId('app.flowdesk.desktop');
        const sess = session.fromPartition('persist:flowdesk');
        sess.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        sess.setPermissionCheckHandler(() => false);
        sess.on('will-download', (_event, item) => { item.setSaveDialogOptions({ title: 'Сохранить файл FlowDesk', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) }); });
        createWindow();
        menu();
        app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0)
            createWindow(); });
    });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin')
        app.quit(); });
}
