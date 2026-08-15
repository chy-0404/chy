'use strict';

const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ---- 可配置项（全部可用环境变量覆盖，便于部署调整） ----
const WEB_HOST = process.env.DSH_DESKTOP_HOST || '127.0.0.1';
const WEB_PORT = Number(process.env.DSH_DESKTOP_PORT || 3080);
const WEB_URL = process.env.DSH_DESKTOP_URL || `http://${WEB_HOST}:${WEB_PORT}`;
// 捆绑的 portable Node 与 dsh 运行时（随应用一起分发，位于 resources/runtime 下）
const NODE_EXE = process.env.DSH_DESKTOP_NODE || path.join(process.resourcesPath, 'runtime', 'node.exe');
const DSH_BIN = process.env.DSH_DESKTOP_BIN || path.join(process.resourcesPath, 'runtime', 'dsh', 'lib', 'bin.js');
const WORK_DIR = process.env.DSH_DESKTOP_CWD || os.homedir();

let mainWindow = null;
let tray = null;
let dshChild = null;
let isQuitting = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 探测本地 Web GUI 端口是否已监听。 */
function portOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ port: WEB_PORT, host: WEB_HOST });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen()) return true;
    await delay(500);
  }
  return false;
}

/** 用捆绑的 portable Node 拉起 `dsh web`；失败（无 node / 无 bin）返回 false。 */
function startWebServer() {
  if (!fs.existsSync(DSH_BIN) || !fs.existsSync(NODE_EXE)) return false;
  let child;
  try {
    child = spawn(NODE_EXE, [DSH_BIN, 'web', '--host', WEB_HOST, '--port', String(WEB_PORT)], {
      cwd: WORK_DIR,
      env: { ...process.env },
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    return false;
  }
  child.on('error', () => {
    dshChild = null;
  });
  child.on('exit', () => {
    dshChild = null;
  });
  dshChild = child;
  return true;
}

/** 确保 Web GUI 可用：已监听就直接用，否则拉起并等待就绪。 */
async function ensureWebServer() {
  if (await portOpen()) return true;
  if (!startWebServer()) return false;
  return await waitForPort(20000);
}

/** 显示并聚焦主窗口；若已被销毁则重建。 */
function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return;
  tray = new Tray(image);
  tray.setToolTip('DeepSeek Harness');
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示 DeepSeek Harness', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'DeepSeek Harness',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0e0f14',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 站内新窗口放行，外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(WEB_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 目标是 Web GUI 且加载失败（连接拒绝等）时，展示本地错误页
  mainWindow.webContents.on('did-fail-load', (_event, code, _desc, url) => {
    if (url.startsWith(WEB_URL) && code !== -3) {
      mainWindow.loadFile(path.join(__dirname, 'error.html')).catch(() => {});
    }
  });

  // 关闭窗口时最小化到托盘，而非退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(WEB_URL);
}

async function bootstrap() {
  await ensureWebServer();
  createWindow();
  createTray();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    bootstrap();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

app.on('quit', () => {
  if (dshChild) {
    try {
      dshChild.kill();
    } catch {
      // 子进程可能已退出，忽略
    }
    dshChild = null;
  }
});
