// Spotless desktop: a thin native window around a self-hosted Spotless server. The server does all the
// work; this process only remembers which server to open, keeps the window where the user left it, and
// keeps the page from wandering off to other sites. Audio, media keys and the OS media overlay come from
// Chromium's Media Session support, which the web player already drives.

import { app, BrowserWindow, Menu, ipcMain, net, screen, session, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETUP_PAGE = path.join(HERE, 'setup.html');
const SETUP_URL = pathToFileURL(SETUP_PAGE).href;
const isMac = process.platform === 'darwin';

// Connect buttons for Spotify and Last.fm send the window through the provider's sign-in page and back
// to the server's callback; those pages have to load in-app so the callback arrives with this window's
// session cookie. Any other site opens in the default browser.
const SIGN_IN_HOSTS = [/^(?:.+\.)?spotify\.com$/, /^(?:www\.)?last\.fm$/];

// What the server's pages may ask for: the microphone (AI DJ voice requests), notifications,
// fullscreen and copying text. Everything else is refused.
const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);

// ---------------------------------------------------------------------------------------------------
// Settings: the server address and the last window position, in the per-user app data folder.

const configPath = () => path.join(app.getPath('userData'), 'desktop.json');
let config = {};

function loadConfig() {
  try {
    config = JSON.parse(readFileSync(configPath(), 'utf8')) ?? {};
  } catch {
    config = {};
  }
}

function saveConfig(patch) {
  config = { ...config, ...patch };
  try {
    writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('could not save settings:', err);
  }
}

/** "nas:4000" or "http://nas:4000/library" -> "http://nas:4000"; null when it is not an http(s) address. */
function normalizeServer(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Asks the server's public health probe whether a working Spotless answers at this address. */
async function checkServer(origin) {
  let res;
  try {
    res = await net.fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'it did not answer within 8 seconds' : err?.message || String(err);
    return { ok: false, error: `Could not reach ${origin}: ${reason}.` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON: some other web app lives at this address
  }
  if (body && typeof body.ok === 'boolean') {
    return body.ok
      ? { ok: true, version: body.version }
      : {
          ok: false,
          error: `The Spotless server at ${origin} is running but reported a problem (HTTP ${res.status}).`,
        };
  }
  return { ok: false, error: `${origin} answered, but it does not look like a Spotless server.` };
}

// ---------------------------------------------------------------------------------------------------
// "Scan network": look for Spotless on this computer and on every private subnet it is attached to.
// Each address in the /24 around each network adapter is asked for /api/health on the ports Spotless
// is usually published on. Node's http client is used rather than net.fetch, whose connection pool
// would queue hundreds of parallel probes behind a handful of sockets.

const SCAN_PORTS = [3000, 4000, 8080, 80];
// A LAN host answers (or refuses) in milliseconds; only empty addresses run into the timeout.
const SCAN_TIMEOUT_MS = 800;
const SCAN_CONCURRENCY = 384;
const SCAN_MAX_SUBNETS = 3;

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** "192.168.0.5" -> "192.168.0" for each private IPv4 network this computer is on. */
function localSubnets() {
  const subnets = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const { family, internal, address } of addresses ?? []) {
      if (internal || (family !== 'IPv4' && family !== 4) || !isPrivateIPv4(address)) continue;
      const prefix = address.split('.').slice(0, 3).join('.');
      if (!subnets.includes(prefix)) subnets.push(prefix);
    }
  }
  // Docker, WSL and Hyper-V adapters live in 172.16/12, and a server inside them is reachable on
  // 127.0.0.1 anyway. Home routers hand out 192.168.x or 10.x, so when one of those exists the
  // virtual adapters are skipped; 172.x is only scanned on networks that really use it.
  const lan = subnets.filter((p) => !p.startsWith('172.'));
  return (lan.length ? lan : subnets).slice(0, SCAN_MAX_SUBNETS);
}

/** Resolves the health body when a Spotless server answers at host:port, otherwise null. */
function probe(host, port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host,
        port,
        path: '/api/health',
        agent: false,
        timeout: SCAN_TIMEOUT_MS,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 4096) req.destroy();
        });
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            resolve(typeof body.ok === 'boolean' && 'scanning' in body ? body : null);
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function scanNetwork() {
  const hosts = ['127.0.0.1'];
  for (const prefix of localSubnets()) {
    for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`);
  }
  const queue = hosts.flatMap((host) => SCAN_PORTS.map((port) => ({ host, port })));
  const found = [];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const body = await probe(job.host, job.port);
      if (!body) continue;
      const url = new URL(`http://${job.host}:${job.port}`).origin;
      found.push({ url, version: body.version ?? null, ok: body.ok });
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  // The same server is often reachable as both 127.0.0.1 and its LAN address; list LAN addresses first
  // so the one other devices can also use is the obvious pick.
  return found.sort((x, y) => Number(x.url.includes('127.0.0.1')) - Number(y.url.includes('127.0.0.1')));
}

// ---------------------------------------------------------------------------------------------------
// Window

let win = null;

function isServerUrl(url) {
  try {
    return Boolean(config.serverUrl) && new URL(url).origin === config.serverUrl;
  } catch {
    return false;
  }
}

function isSetupPage(url) {
  return typeof url === 'string' && url.split(/[?#]/)[0] === SETUP_URL;
}

function mayLoadInWindow(url) {
  if (isSetupPage(url) || isServerUrl(url)) return true;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && SIGN_IN_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

function openExternal(url) {
  try {
    if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {
    // malformed URL: ignore
  }
}

/** Saved bounds, dropped when that spot is no longer on any connected screen (a monitor was unplugged). */
function savedBounds() {
  const b = config.bounds;
  if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return {};
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
  return visible ? b : { width: b.width, height: b.height };
}

function showSetup(params = {}) {
  const query = {};
  if (params.url) query.url = params.url;
  if (params.error) query.error = params.error;
  if (config.serverUrl) query.current = config.serverUrl;
  win.loadFile(SETUP_PAGE, { query });
}

function showServer() {
  win.loadURL(config.serverUrl);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    ...savedBounds(),
    minWidth: 360,
    minHeight: 480,
    title: 'Spotless',
    icon: path.join(HERE, 'icon.png'),
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Crossfade, gapless handoff and stall recovery run on timers; keep them on time while the
      // window is minimized or behind other windows.
      backgroundThrottling: false,
      // Resuming a saved queue after launch should not wait for a click.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  if (config.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.on('close', () => {
    saveConfig({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  });
  win.on('closed', () => {
    win = null;
  });

  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (mayLoadInWindow(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  // The server went away (wrong address, NAS asleep, offline): show the setup page with the reason
  // instead of Chromium's blank error page. Aborted loads (-3) are just a navigation being replaced.
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isServerUrl(url)) return;
    showSetup({ url: config.serverUrl, error: `Could not reach ${config.serverUrl} (${description}).` });
  });

  if (config.serverUrl) showServer();
  else showSetup();
}

// ---------------------------------------------------------------------------------------------------
// Setup page -> main process. Only the bundled setup page may change the server address.

function fromSetupPage(event) {
  return isSetupPage(event.senderFrame?.url);
}

ipcMain.handle('setup:connect', async (event, input) => {
  if (!fromSetupPage(event)) return { ok: false, error: 'Not allowed.' };
  const origin = normalizeServer(input);
  if (!origin) return { ok: false, error: 'Enter the address of your Spotless server, like http://192.168.1.10:3000' };
  const result = await checkServer(origin);
  if (!result.ok) return result;
  saveConfig({ serverUrl: origin });
  showServer();
  return { ok: true };
});

let scanning = null;
ipcMain.handle('setup:scan', (event) => {
  if (!fromSetupPage(event)) return [];
  // A second click while a scan runs joins it instead of doubling the traffic.
  scanning ??= scanNetwork().finally(() => {
    scanning = null;
  });
  return scanning;
});

ipcMain.handle('setup:cancel', (event) => {
  if (!fromSetupPage(event) || !config.serverUrl) return;
  showServer();
});

// ---------------------------------------------------------------------------------------------------
// Menu (hidden on Windows/Linux until Alt is pressed)

function buildMenu() {
  const go = (fn) => () => {
    const history = win?.webContents.navigationHistory;
    if (history) fn(history);
  };
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: isMac ? 'File' : 'Spotless',
      submenu: [
        { label: 'Change server…', click: () => win && showSetup({ url: config.serverUrl }) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Home', click: () => win && config.serverUrl && showServer() },
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: go((h) => h.canGoBack() && h.goBack()) },
        {
          label: 'Forward',
          accelerator: isMac ? 'Cmd+]' : 'Alt+Right',
          click: go((h) => h.canGoForward() && h.goForward()),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------------------------------
// App lifecycle

// One window: launching Spotless again brings the running one forward instead of starting a second
// player that would fight the first over the queue.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  if (process.platform === 'win32') app.setAppUserModelId('com.spotless.desktop');

  app.whenReady().then(() => {
    loadConfig();

    const allow = (url, permission) => isServerUrl(url) && ALLOWED_PERMISSIONS.has(permission);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(allow(details.requestingUrl, permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      return allow(requestingOrigin, permission);
    });

    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (!win) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
