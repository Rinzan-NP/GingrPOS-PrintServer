/**
 * GingrPOS Print Server — Electron Main Process
 *
 * Runs as a silent system-tray app.
 * Embeds the Express HTTP server (server.js) on port 3000.
 * GingrPOS web calls http://localhost:3000 — no browser Allow prompts.
 */

'use strict';

const {
    app,
    Tray,
    Menu,
    nativeImage,
    BrowserWindow,
    ipcMain,
} = require('electron');
const path   = require('path');
const http   = require('http');
const os     = require('os');
const fs     = require('fs');

// ─── Prevent multiple instances ───────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    process.exit(0);
}

// ─── State ────────────────────────────────────────────────────────────────────
let tray       = null;
let mainWindow = null;
let httpServer = null;
const PORT     = 3000;

// ─── Logging: forward console to UI window if open ────────────────────────────
function sendLog(type, args) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        mainWindow.webContents.send('log', { type, msg });
    }
}
const _log   = console.log.bind(console);
const _error = console.error.bind(console);
const _warn  = console.warn.bind(console);
console.log   = (...a) => { _log(...a);   sendLog('info',  a); };
console.error = (...a) => { _error(...a); sendLog('error', a); };
console.warn  = (...a) => { _warn(...a);  sendLog('warn',  a); };

// ─── Start / Stop HTTP server ─────────────────────────────────────────────────
function startServer() {
    const expressApp = require('./server');
    httpServer = http.createServer(expressApp);
    httpServer.listen(PORT, '127.0.0.1', () => {
        console.log(`GingrPOS Print Server running at http://localhost:${PORT}`);
        updateTray();
    });
    httpServer.on('error', (err) => {
        console.error('Server error:', err.message);
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Is another instance running?`);
        }
        updateTray();
    });
}

function stopServer() {
    if (httpServer) {
        httpServer.close(() => console.log('Server stopped'));
        httpServer = null;
    }
}

function isServerRunning() {
    return httpServer !== null && httpServer.listening;
}

// ─── Tray Icon ────────────────────────────────────────────────────────────────
function createTrayIcon() {
    const iconPath = path.join(__dirname, 'icon.png');
    if (fs.existsSync(iconPath)) {
        return nativeImage.createFromPath(iconPath);
    }
    // Fallback: 16×16 green square
    const size = 16;
    const buf  = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        buf[i * 4]     = 22;   // R
        buf[i * 4 + 1] = 163;  // G
        buf[i * 4 + 2] = 74;   // B
        buf[i * 4 + 3] = 255;  // A
    }
    return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function updateTray() {
    if (!tray) return;
    const running = isServerRunning();
    const menu = Menu.buildFromTemplate([
        { label: '🖨️  GingrPOS Print Server', enabled: false },
        { type:  'separator' },
        { label: running ? `✅ Running — port ${PORT}` : '❌ Stopped', enabled: false },
        { label: `Platform: ${os.platform()}`,                          enabled: false },
        { type:  'separator' },
        { label: 'Status Window', click: () => showStatusWindow() },
        {
            label: running ? 'Restart Server' : 'Start Server',
            click: () => { stopServer(); startServer(); },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => { stopServer(); app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip(running ? `GingrPOS Print Server — port ${PORT}` : 'GingrPOS Print Server — stopped');
}

function createTray() {
    tray = new Tray(createTrayIcon());
    updateTray();
    tray.on('click', () => showStatusWindow());
}

// ─── Status Window ────────────────────────────────────────────────────────────
function showStatusWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 420,
        height: 560,
        title: 'GingrPOS Print Server',
        resizable: false,
        webPreferences: {
            nodeIntegration:  true,
            contextIsolation: false,
        },
    });

    const platform = os.platform();
    const running  = isServerRunning();

    const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GingrPOS Print Server</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #f1f5f9;
    padding: 24px;
    min-height: 100vh;
  }
  .header { text-align: center; margin-bottom: 24px; }
  .logo { font-size: 40px; margin-bottom: 8px; }
  h1 { font-size: 20px; font-weight: 700; color: #f8fafc; }
  .subtitle { font-size: 13px; color: #94a3b8; margin-top: 4px; }

  .card {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .status-row { display: flex; align-items: center; gap: 10px; }
  .dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: ${running ? '#16a34a' : '#64748b'};
    ${running ? 'animation: pulse 2s infinite;' : ''}
  }
  @keyframes pulse {
    0%,100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  .status-text { font-size: 15px; font-weight: 600; color: ${running ? '#4ade80' : '#94a3b8'}; }
  .meta { font-size: 13px; color: #64748b; margin-top: 8px; }
  .meta span { color: #cbd5e1; }

  .logs-title { font-size: 13px; color: #64748b; margin-bottom: 8px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; }
  #logs {
    background: #020617;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    height: 180px;
    overflow-y: auto;
    padding: 10px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    color: #94a3b8;
  }
  .log-info  { color: #94a3b8; }
  .log-error { color: #f87171; }
  .log-warn  { color: #fbbf24; }
  .log-entry { padding: 1px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
</style>
</head>
<body>
<div class="header">
  <div class="logo">🖨️</div>
  <h1>GingrPOS Print Server</h1>
  <div class="subtitle">Local thermal printer bridge</div>
</div>

<div class="card">
  <div class="status-row">
    <div class="dot"></div>
    <span class="status-text">${running ? 'Server Running' : 'Server Stopped'}</span>
  </div>
  <div class="meta">Port: <span>${PORT}</span> &nbsp;|&nbsp; Platform: <span>${platform}</span></div>
  <div class="meta" style="margin-top:6px">GingrPOS connects to: <span>http://localhost:${PORT}</span></div>
</div>

<div class="card">
  <div class="logs-title">📋 Live Logs</div>
  <div id="logs"></div>
</div>

<script>
const { ipcRenderer } = require('electron');
const logsEl = document.getElementById('logs');
function appendLog(type, msg) {
  const el = document.createElement('div');
  el.className = 'log-entry log-' + type;
  el.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  logsEl.appendChild(el);
  logsEl.scrollTop = logsEl.scrollHeight;
}
ipcRenderer.on('log', (_, data) => appendLog(data.type, data.msg));
</script>
</body>
</html>`;

    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.on('close',  (e) => { e.preventDefault(); mainWindow.hide(); });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    // Hide from macOS Dock
    if (process.platform === 'darwin') app.dock.hide();

    createTray();
    startServer();
});

app.on('window-all-closed', () => { /* keep running in tray */ });
app.on('before-quit',       () => stopServer());
app.on('second-instance',   () => showStatusWindow());
