# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere auto-update a CallAlert: push di un tag Git triggera GitHub Actions che builda per Mac e Windows e pubblica su GitHub Releases; le app installate rilevano la nuova versione e mostrano una voce nel tray per installarla.

**Architecture:** `electron-updater` gestisce download e install automatici su Windows; su Mac (senza code signing) un fallback via GitHub REST API mostra la versione disponibile e apre il browser alla pagina Release. GitHub Actions builda su `macos-latest` e `windows-latest` quando si fa push di un tag `v*.*.*`.

**Tech Stack:** Electron 28, electron-builder 24, electron-updater ^6, GitHub Actions, GitHub Releases API.

---

## File Map

| File | Tipo | Responsabilità |
|------|------|----------------|
| `package.json` | Modifica | Aggiunge `electron-updater` in `dependencies`; aggiunge `build.publish` e target `zip` per Mac |
| `src/main.js` | Modifica | Import `autoUpdater` + `shell`; variabili di stato; `setupAutoUpdater()`; `checkVersionFallback()`; `isNewerVersion()`; aggiornamento `updateTray()` |
| `.github/workflows/release.yml` | Crea | Workflow CI/CD per build + publish su tag push |

---

## Task 1: Aggiorna `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Aggiungi `electron-updater` alle dipendenze**

Apri `package.json`. Aggiungi la sezione `dependencies` (non `devDependencies` — serve in produzione):

```json
"dependencies": {
  "electron-updater": "^6.3.0"
},
```

- [ ] **Step 2: Aggiungi `build.publish` e target `zip` per Mac**

Nella sezione `"build"` di `package.json`, aggiungi la chiave `publish` e aggiungi `zip` ai target Mac (necessario per il meccanismo di update di Squirrel.Mac):

```json
"publish": {
  "provider": "github",
  "owner": "egodi99",
  "repo": "call-alert"
},
```

E modifica la sezione `mac.target` così:

```json
"mac": {
  "category": "public.app-category.productivity",
  "target": [
    { "target": "dmg", "arch": ["x64", "arm64"] },
    { "target": "zip", "arch": ["x64", "arm64"] }
  ],
  "icon": null
},
```

Il `package.json` risultante nella sezione `build` sarà:

```json
"build": {
  "appId": "com.devlogica.callalert",
  "productName": "CallAlert",
  "publish": {
    "provider": "github",
    "owner": "egodi99",
    "repo": "call-alert"
  },
  "directories": {
    "output": "dist"
  },
  "files": [
    "src/**/*",
    "package.json"
  ],
  "mac": {
    "category": "public.app-category.productivity",
    "target": [
      { "target": "dmg", "arch": ["x64", "arm64"] },
      { "target": "zip", "arch": ["x64", "arm64"] }
    ],
    "icon": null
  },
  "win": {
    "target": [
      { "target": "nsis", "arch": ["x64"] }
    ],
    "icon": null
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "allowElevation": true,
    "installerLanguages": ["it", "en"],
    "language": "1040",
    "deleteAppDataOnUninstall": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Call Alert"
  }
},
```

- [ ] **Step 3: Installa la nuova dipendenza**

```bash
npm install
```

Expected output: `added N packages` senza errori.

- [ ] **Step 4: Verifica che l'app si avvii ancora correttamente**

```bash
npm start
```

Expected: l'icona tray appare, nessun errore in console. Chiudi l'app (tray → Esci).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add electron-updater dependency and GitHub publish config"
```

---

## Task 2: Logica auto-update in `src/main.js`

**Files:**
- Modify: `src/main.js`

### Step 1: Import `autoUpdater` e `shell`

- [ ] In cima al file, subito dopo la riga `const { app, BrowserWindow, ... } = require('electron');`, modifica l'import aggiungendo `shell`:

```js
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
```

- [ ] Subito dopo le righe `require` di Node.js (`dgram`, `os`, `path`, `fs`), aggiungi:

```js
const { autoUpdater } = require('electron-updater');
```

### Step 2: Aggiungi variabili di stato per l'updater

- [ ] Nella sezione `// ── State ─` (dove sono definiti `tray`, `alertWindow`, ecc.), aggiungi in fondo:

```js
let updateState = null; // null | 'auto' | 'manual'
let fallbackChecked = false;
```

### Step 3: Aggiungi le costanti GitHub

- [ ] Dopo la riga `const CONFIG_PATH = ...` nella sezione `// ── Config ─`, aggiungi:

```js
const GITHUB_RELEASES_API = 'https://api.github.com/repos/egodi99/call-alert/releases/latest';
const RELEASES_URL = 'https://github.com/egodi99/call-alert/releases/latest';
```

### Step 4: Aggiungi la funzione `isNewerVersion`

- [ ] Nella sezione `// ── Helpers ─`, dopo la funzione `getLocalIP`, aggiungi:

```js
function isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number);
  const [lMaj, lMin, lPatch] = parse(latest);
  const [cMaj, cMin, cPatch] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}
```

### Step 5: Aggiungi la funzione `checkVersionFallback`

- [ ] Sempre nella sezione `// ── Helpers ─`, dopo `isNewerVersion`, aggiungi:

```js
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
```

### Step 6: Aggiungi la funzione `setupAutoUpdater`

- [ ] Dopo `checkVersionFallback`, aggiungi:

```js
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', () => {
    updateState = 'auto';
    updateTray();
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
    checkVersionFallback();
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[updater] checkForUpdates failed:', err.message);
      checkVersionFallback();
    });
  }, 3000);
}
```

### Step 7: Chiama `setupAutoUpdater()` in `app.whenReady()`

- [ ] In fondo al blocco `app.whenReady().then(() => { ... })`, aggiungi `setupAutoUpdater()` come **ultima istruzione** prima della parentesi graffa di chiusura `});`:

Trova questa riga alla fine del blocco:

```js
  app.on('window-all-closed', (e) => e.preventDefault());
});
```

Sostituiscila con:

```js
  app.on('window-all-closed', (e) => e.preventDefault());
  setupAutoUpdater();
});
```

- [ ] **Verifica avvio**

```bash
npm start
```

Expected: l'app si avvia normalmente. In console dopo ~3 secondi vedremo `[updater] checkForUpdates failed: ...` oppure `[updater] fallback ...` (normale in dev perché non siamo una build firmata). Nessun crash.

- [ ] **Commit**

```bash
git add src/main.js
git commit -m "feat: add auto-updater logic with GitHub API fallback for unsigned Mac"
```

---

## Task 3: Aggiorna `updateTray()` con la voce di aggiornamento

**Files:**
- Modify: `src/main.js` — funzione `updateTray()`

La funzione `updateTray()` costruisce il `contextMenu`. Devi aggiungere le voci condizionali per l'update subito prima del separatore finale (quello prima di "Esci").

- [ ] **Step 1: Individua la sezione finale del template**

Trova queste righe in `updateTray()`:

```js
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() }
```

- [ ] **Step 2: Sostituisci con la versione aggiornata**

```js
    { type: 'separator' },
    {
      label: '⬆️ Aggiornamento pronto — Riavvia',
      visible: updateState === 'auto',
      click: () => autoUpdater.quitAndInstall()
    },
    {
      label: '⬆️ Nuova versione disponibile',
      visible: updateState === 'manual',
      click: () => shell.openExternal(RELEASES_URL)
    },
    { label: 'Esci', click: () => app.quit() }
```

- [ ] **Step 3: Verifica avvio**

```bash
npm start
```

Expected: app si avvia, menu tray funziona normalmente. Le voci update NON appaiono (perché `updateState` è `null` in dev). Verifica aprendo il menu tray che le voci "Aggiornamento" siano invisibili.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: add update notification items to tray menu"
```

---

## Task 4: Crea GitHub Actions workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Crea la directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Crea il file `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Build and publish Mac
        run: npx electron-builder --mac --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Build and publish Windows
        run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: Verifica sintassi YAML**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml', 'utf8')); console.log('YAML OK')" 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"
```

Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow for Mac and Windows"
```

---

## Task 5: Primo rilascio — bump versione e push tag

- [ ] **Step 1: Modifica la versione in `package.json`**

Cambia `"version": "1.8.0"` in `"version": "1.9.0"`.

- [ ] **Step 2: Commit, tag e push**

```bash
git add package.json
git commit -m "bump version to 1.9.0"
git tag v1.9.0
git push && git push --tags
```

- [ ] **Step 3: Verifica che GitHub Actions parta**

Vai su `https://github.com/egodi99/call-alert/actions`. Dovresti vedere il workflow "Release" avviato. I due job (`build-mac` e `build-win`) girano in parallelo e impiegano ~5-10 minuti.

- [ ] **Step 4: Verifica la GitHub Release**

Quando il workflow è verde, vai su `https://github.com/egodi99/call-alert/releases`. Dovresti trovare la release `v1.9.0` con questi asset:
- `CallAlert-1.9.0.dmg`
- `CallAlert-1.9.0-arm64.dmg`
- `CallAlert-1.9.0-mac.zip`
- `CallAlert-1.9.0-arm64-mac.zip`
- `latest-mac.yml`
- `CallAlert-Setup-1.9.0.exe`
- `latest.yml`

Se mancano file, controlla i log del workflow su GitHub Actions.

- [ ] **Step 5: Test fallback su Mac (se non hai code signing)**

Installa il DMG prodotto (`CallAlert-1.9.0.dmg`) su un Mac. Poi crea una release `v1.10.0` con lo stesso processo. Dopo ~5 minuti, la versione installata `1.9.0` dovrebbe mostrare nel tray `⬆️ Nuova versione disponibile`.

---

## Note post-implementazione

**Per i rilasci futuri:**
```bash
# Alza version in package.json, poi:
git add package.json
git commit -m "bump version to X.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

**Se vuoi l'auto-update completo su Mac** (senza aprire il browser): serve un Apple Developer certificate (~$99/anno) per code signing. Una volta che hai il certificato, configura `CSC_LINK` e `CSC_KEY_PASSWORD` come secrets su GitHub e aggiungi `"hardenedRuntime": true` alla sezione `mac` in `package.json`.
