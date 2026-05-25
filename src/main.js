const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, Notification } = require('electron');
const dgram = require('dgram');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ── Config ────────────────────────────────────────────────────────────────────
const UDP_PORT = 47832;
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const GITHUB_RELEASES_API = 'https://api.github.com/repos/egodi99/call-alert/releases/latest';
const RELEASES_URL = 'https://github.com/egodi99/call-alert/releases/latest';

// ── State ─────────────────────────────────────────────────────────────────────
let tray = null;
let alertWindow = null;
let coffeeWindow = null;
let settingsWindow = null;
let udpSocket = null;
let activeCalls = {};
let knownPeers = {}; // { username: ip }
let myUsername = 'Utente';
let notificationVolume = 0.7;
let updateState = null; // null | 'auto' | 'manual'
let fallbackChecked = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      myUsername = data.username || 'Utente';
      notificationVolume = typeof data.notificationVolume === 'number' ? data.notificationVolume : 0.7;
    }
  } catch (e) {}
}

function saveSettings(username, volume) {
  myUsername = username;
  notificationVolume = volume;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ username, notificationVolume: volume }), 'utf8');
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number);
  const [lMaj, lMin, lPatch] = parse(latest);
  const [cMaj, cMin, cPatch] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

function checkVersionFallback() {
  if (fallbackChecked) return;
  fallbackChecked = true;
  const https = require('https');
  const req = https.get(
    GITHUB_RELEASES_API,
    { headers: { 'User-Agent': 'call-alert-updater' } },
    (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestTag = (release.tag_name || '').replace(/^v/, '');
          const currentVersion = app.getVersion();
          if (latestTag && isNewerVersion(latestTag, currentVersion)) {
            updateState = 'manual';
            updateTray();
            showUpdateNotification('manual');
          }
        } catch (e) {
          console.error('[updater] fallback parse error:', e.message);
        }
      });
    }
  );
  req.on('error', err => console.error('[updater] fallback request error:', err.message));
  req.end();
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', () => {
    updateState = 'auto';
    updateTray();
    showUpdateNotification('auto');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
    checkVersionFallback();
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 3000);
}

function showUpdateNotification(type) {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title: type === 'auto' ? '⬆️ Call Alert aggiornato' : '⬆️ Nuova versione disponibile',
    body: type === 'auto'
      ? 'Clicca per riavviare e installare l\'aggiornamento.'
      : 'Clicca per scaricare la nuova versione.'
  });

  n.on('click', () => {
    if (type === 'auto') {
      autoUpdater.quitAndInstall();
    } else {
      shell.openExternal(RELEASES_URL).catch(err =>
        console.error('[updater] open releases error:', err.message)
      );
    }
  });

  n.show();
}

// Calcola tutti gli indirizzi di broadcast della rete locale
// Es. 192.168.1.105 con mask 255.255.255.0 → 192.168.1.255
// Più affidabile di 255.255.255.255 che molti router/firewall bloccano
function getBroadcastAddresses() {
  const addrs = new Set();
  addrs.add('255.255.255.255'); // fallback globale
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      try {
        const ip = iface.address.split('.').map(Number);
        const mask = iface.netmask.split('.').map(Number);
        const broadcast = ip.map((octet, i) => (octet | (~mask[i] & 255)) >>> 0);
        addrs.add(broadcast.join('.'));
      } catch (e) {}
    }
  }
  return [...addrs];
}

// ── Tray Icon ─────────────────────────────────────────────────────────────────
function buildTrayIcon(active) {
  // Creiamo un PNG 22x22 tramite raw RGBA buffer - compatibile Mac e Windows
  const size = 22;
  const buf = Buffer.alloc(size * size * 4);
  const r = active ? 255 : 52;
  const g = active ? 59  : 199;
  const b = active ? 48  : 89;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;
      if (dist <= size / 2 - 1) {
        buf[idx]     = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255;
      } else {
        buf[idx + 3] = 0; // trasparente
      }
    }
  }

  const img = nativeImage.createFromBuffer(buf, { width: size, height: size });
  return img;
}

// ── UDP Networking ────────────────────────────────────────────────────────────
function setupUDP() {
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('error', (err) => console.error('UDP error:', err));

  udpSocket.on('message', (msg, rinfo) => {
    try {
      const packet = JSON.parse(msg.toString());
      console.log(`[ricevuto] tipo=${packet.type} da=${rinfo.address}:${rinfo.port}`);
      handlePacket(packet, rinfo.address);
    } catch (e) { console.error('[ricevuto] parse error:', e.message); }
  });

  // Bind su 0.0.0.0 per ricevere sia broadcast che unicast su tutte le interfacce
  udpSocket.bind({ port: UDP_PORT, address: '0.0.0.0', exclusive: false }, () => {
    try { udpSocket.setBroadcast(true); } catch(e) {}
    console.log(`UDP listening on 0.0.0.0:${UDP_PORT} | IP locale: ${getLocalIP()}`);
    console.log(`Broadcast targets: ${getBroadcastAddresses().join(', ')}`);
  });
}

// Invia a un indirizzo UDP
function sendTo(msg, addr) {
  udpSocket.send(msg, 0, msg.length, UDP_PORT, addr, (err) => {
    if (err) {
      console.error(`[sendTo] ERRORE verso ${addr}:`, err.message, '| code:', err.code);
    } else {
      console.log(`[sendTo] OK → ${addr}:${UDP_PORT}`);
    }
  });
}

function broadcast(packet) {
  const msg = Buffer.from(JSON.stringify(packet));
  const myIP = getLocalIP();
  const broadcastAddrs = getBroadcastAddresses();
  const peerIPs = Object.values(knownPeers).filter(ip => ip !== myIP);

  console.log(`[broadcast] tipo=${packet.type} | mio IP=${myIP}`);
  console.log(`[broadcast] subnet targets: ${broadcastAddrs.join(', ')}`);
  console.log(`[broadcast] peer unicast targets: ${peerIPs.join(', ') || 'nessuno'}`);

  // 1. Broadcast su tutti gli indirizzi di subnet
  broadcastAddrs.forEach(addr => sendTo(msg, addr));

  // 2. Unicast diretto agli IP dei peer noti
  peerIPs.forEach(ip => sendTo(msg, ip));

  handlePacket(packet, myIP);
}

function handlePacket(packet, fromIP) {
  if (packet.type === 'CALL_START') {
    if (packet.user && fromIP !== getLocalIP()) knownPeers[packet.user] = fromIP;
    activeCalls[packet.callId] = {
      user: packet.user,
      startTime: packet.startTime,
      fromIP
    };
    showAlert(true);
    updateTray();
  } else if (packet.type === 'CALL_END') {
    delete activeCalls[packet.callId];
    if (Object.keys(activeCalls).length === 0) {
      hideAlert();
    } else {
      refreshAlert();
    }
    updateTray();
  } else if (packet.type === 'PING') {
    // Registra il peer e rispondi con un PONG + stato call attive
    if (packet.user) knownPeers[packet.user] = fromIP;
    const pongMsg = Buffer.from(JSON.stringify({ type: 'PONG', user: myUsername, ip: getLocalIP() }));
    udpSocket.send(pongMsg, 0, pongMsg.length, UDP_PORT, fromIP);
    // Invia le call attive che possediamo
    Object.entries(activeCalls).forEach(([callId, info]) => {
      if (info.fromIP === getLocalIP()) {
        const pkt = { type: 'CALL_START', callId, user: info.user, startTime: info.startTime };
        const msg = Buffer.from(JSON.stringify(pkt));
        udpSocket.send(msg, 0, msg.length, UDP_PORT, fromIP);
      }
    });
  } else if (packet.type === 'PONG') {
    if (packet.user && fromIP) knownPeers[packet.user] = fromIP;
    console.log(`Peer scoperto: ${packet.user} @ ${fromIP}`);
  } else if (packet.type === 'COFFEE_START') {
    coffeeInvitedBy = packet.user || '';
    showCoffee(true);
    updateTray();
  } else if (packet.type === 'COFFEE_END') {
    coffeeRSVP = {};
    hideCoffee();
    updateTray();
  } else if (packet.type === 'COFFEE_RSVP') {
    coffeeRSVP[packet.user] = packet.answer;
    broadcastCoffeeState();
  } else if (packet.type === 'COFFEE_STATE') {
    coffeeRSVP = packet.rsvp || {};
    if (coffeeWindow) {
      coffeeWindow.webContents.send('update-coffee', {
        myUsername, forceShow: false,
        invitedBy: packet.invitedBy || coffeeInvitedBy,
        isOwner: coffeeStartedByMe,
        rsvp: coffeeRSVP,
        notificationVolume
      });
    }
  }
}

// ── Alert Window ──────────────────────────────────────────────────────────────
function showAlert(forceShow = false) {
  if (alertWindow) {
    refreshAlert(forceShow);
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  alertWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  alertWindow.setIgnoreMouseEvents(false);
  alertWindow.loadFile(path.join(__dirname, 'alert.html'));
  alertWindow.setVisibleOnAllWorkspaces(true);
  alertWindow.setAlwaysOnTop(true, 'screen-saver');

  alertWindow.webContents.on('did-finish-load', () => {
    refreshAlert(true);
  });

  alertWindow.on('closed', () => { alertWindow = null; });
}

function refreshAlert(forceShow = false) {
  if (!alertWindow) return;
  alertWindow.webContents.send('update-calls', {
    calls: activeCalls,
    myUsername,
    notificationVolume,
    forceShow
  });
}

function hideAlert() {
  if (alertWindow) {
    alertWindow.close();
    alertWindow = null;
  }
}

// ── Coffee Window ─────────────────────────────────────────────────────────────
function showCoffee(forceShow = false) {
  if (coffeeWindow) {
    coffeeWindow.webContents.send('update-coffee', {
      myUsername, forceShow, invitedBy: coffeeInvitedBy,
      isOwner: coffeeStartedByMe, rsvp: coffeeRSVP,
      notificationVolume
    });
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  coffeeWindow = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  coffeeWindow.loadFile(path.join(__dirname, 'coffee.html'));
  coffeeWindow.setVisibleOnAllWorkspaces(true);
  coffeeWindow.setAlwaysOnTop(true, 'screen-saver');
  coffeeWindow.webContents.on('did-finish-load', () => {
    coffeeWindow.webContents.send('update-coffee', {
      myUsername, forceShow: true, invitedBy: coffeeInvitedBy,
      isOwner: coffeeStartedByMe, rsvp: coffeeRSVP,
      notificationVolume
    });
  });
  coffeeWindow.on('closed', () => { coffeeWindow = null; });
}

function broadcastCoffeeState() {
  // Invia lo stato RSVP aggiornato a tutti tramite broadcast
  const msg = Buffer.from(JSON.stringify({
    type: 'COFFEE_STATE',
    rsvp: coffeeRSVP,
    invitedBy: coffeeInvitedBy
  }));
  getBroadcastAddresses().forEach(addr => {
    udpSocket.send(msg, 0, msg.length, UDP_PORT, addr);
  });
  Object.values(knownPeers).forEach(ip => {
    if (ip !== getLocalIP()) udpSocket.send(msg, 0, msg.length, UDP_PORT, ip);
  });
  // Aggiorna anche la nostra finestra locale
  if (coffeeWindow) {
    coffeeWindow.webContents.send('update-coffee', {
      myUsername, forceShow: false,
      invitedBy: coffeeInvitedBy,
      isOwner: coffeeStartedByMe,
      rsvp: coffeeRSVP,
      notificationVolume
    });
  }
}

function hideCoffee() {
  if (coffeeWindow) { coffeeWindow.close(); coffeeWindow = null; }
}

// ── Settings Window ───────────────────────────────────────────────────────────
function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 430,
    resizable: false,
    title: 'Call Alert – Impostazioni',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow.webContents.send('load-config', { username: myUsername, notificationVolume });
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── Tray Menu ─────────────────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;
  const callCount = Object.keys(activeCalls).length;
  const active = callCount > 0;
  const coffeeActive = !!coffeeWindow;

  tray.setImage(buildTrayIcon(active));
  tray.setToolTip(active
    ? `📵 ${callCount} call in corso`
    : 'Call Alert – Nessuna call attiva');

  const myActiveCalls = Object.entries(activeCalls)
    .filter(([, info]) => info.user === myUsername);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: active
        ? `📵 ${callCount} call in corso`
        : '✅ Nessuna call attiva',
      enabled: false
    },
    { type: 'separator' },
    {
      label: '📞 Sto entrando in call',
      click: () => startMyCall()
    },
    {
      label: '🔴 Mostra alert call',
      visible: active && !alertWindow,
      click: () => showAlert(true)
    },
    { type: 'separator' },
    {
      label: '☕ Pausa caffè!',
      click: () => startCoffee()
    },
    {
      label: '✅ Fine pausa caffè',
      enabled: coffeeActive,
      click: () => endCoffee()
    },
    {
      label: '✅ Termina la mia call',
      enabled: myActiveCalls.length > 0,
      click: () => endMyCall()
    },
    { type: 'separator' },
    { label: '⚙️ Impostazioni', click: openSettings },
    {
      label: 'Peer conosciuti:' + (Object.keys(knownPeers).length > 0 ? ` ${Object.keys(knownPeers).join(', ')}` : ' nessuno'),
      enabled: false
    },
    { type: 'separator' },
    {
      label: '⬆️ Aggiornamento pronto — Riavvia',
      visible: updateState === 'auto',
      click: () => autoUpdater.quitAndInstall()
    },
    {
      label: '⬆️ Nuova versione disponibile',
      visible: updateState === 'manual',
      click: () => shell.openExternal(RELEASES_URL).catch(err => console.error('[updater] open releases error:', err.message))
    },
    { type: 'separator' },
    {
      label: 'Versione: ' + app.getVersion(),
      enabled: false
    },
    { label: 'Esci', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Call Management ───────────────────────────────────────────────────────────
let myCallId = null;

function startMyCall() {
  myCallId = `${myUsername}-${Date.now()}`;
  broadcast({
    type: 'CALL_START',
    callId: myCallId,
    user: myUsername,
    startTime: Date.now()
  });
}

function endMyCall() {
  if (!myCallId) return;
  broadcast({ type: 'CALL_END', callId: myCallId });
  myCallId = null;
}

let coffeeStartedByMe = false;
let coffeeInvitedBy = '';
let coffeeRSVP = {}; // { username: 'yes'|'no' }

function startCoffee() {
  coffeeStartedByMe = true;
  coffeeInvitedBy = myUsername;
  coffeeRSVP = {};
  broadcast({ type: 'COFFEE_START', user: myUsername });
}

function endCoffee() {
  if (!coffeeStartedByMe) return;
  coffeeStartedByMe = false;
  coffeeInvitedBy = '';
  coffeeRSVP = {};
  broadcast({ type: 'COFFEE_END', user: myUsername });
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on('save-settings', (_, { username, notificationVolume: volume }) => {
  saveSettings(username, volume);
  updateTray();
});

ipcMain.on('start-call', () => startMyCall());
ipcMain.on('end-call', () => endMyCall());

ipcMain.on('dismiss-alert', () => {
  hideAlert();
});

ipcMain.on('dismiss-coffee', () => {
  hideCoffee();
});

ipcMain.on('end-coffee', () => {
  endCoffee();
});

ipcMain.on('coffee-rsvp', (_, answer) => {
  broadcast({ type: 'COFFEE_RSVP', user: myUsername, answer });
});

ipcMain.on('end-specific-call', (_, callId) => {
  if (callId === myCallId) endMyCall();
});

// ── App Bootstrap ─────────────────────────────────────────────────────────────
// Su Windows aggiunge automaticamente la regola firewall per UDP 47832
function ensureWindowsFirewallRule() {
  if (process.platform !== 'win32') return;
  const { exec } = require('child_process');
  const ruleName = 'CallAlert-UDP-47832';
  // Controlla se la regola esiste già
  exec(`netsh advfirewall firewall show rule name="${ruleName}"`, (err, stdout) => {
    if (stdout && stdout.includes(ruleName)) return; // già presente
    // Aggiunge regola in entrata e in uscita
    exec(`netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=UDP localport=${UDP_PORT}`);
    exec(`netsh advfirewall firewall add rule name="${ruleName}-out" dir=out action=allow protocol=UDP localport=${UDP_PORT}`);
    console.log('Regola firewall Windows aggiunta per UDP', UDP_PORT);
  });
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  ensureWindowsFirewallRule();

  loadConfig();

  if (!fs.existsSync(CONFIG_PATH)) {
    setTimeout(openSettings, 500);
  }

  tray = new Tray(buildTrayIcon(false));
  tray.setToolTip('Call Alert');

  // Su Mac bisogna chiamare popUpContextMenu() esplicitamente
  tray.on('click', () => {
    updateTray();
    tray.popUpContextMenu();
  });
  tray.on('right-click', () => {
    updateTray();
    tray.popUpContextMenu();
  });

  updateTray();
  setupUDP();

  setTimeout(() => {
    broadcast({ type: 'PING', user: myUsername });
  }, 1000);

  app.on('window-all-closed', (e) => e.preventDefault());
  setupAutoUpdater();
});

app.on('before-quit', () => {
  if (myCallId) endMyCall();
  if (coffeeStartedByMe) endCoffee();
});
