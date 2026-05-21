# Auto-Update — Design Spec

**Data:** 2026-05-21
**Versione target:** CallAlert v1.9.0+
**Autore:** e.godi

---

## Obiettivo

Permettere al maintainer di rilasciare aggiornamenti dell'app con un semplice `git push --tags`. Le istanze installate sui PC dell'ufficio (Mac e Windows) scaricano l'aggiornamento in background e mostrano una voce nel menu tray per riavviare e installare. Nessun intervento manuale sui PC client.

---

## Architettura

```
[Developer] → git tag v1.9.0 + git push
     ↓
[GitHub Actions] → build Mac (x64/arm64) + Windows (x64)
     ↓
[GitHub Releases] → binari + latest.yml / latest-mac.yml
     ↑
[CallAlert app] → controlla all'avvio → scarica in background → notifica tray
```

---

## Componenti

### 1. Dipendenza: `electron-updater`

- Aggiunta come `dependencies` (non `devDependencies`) — serve nel processo principale in produzione.
- Versione: `^6.x` (compatibile con electron-builder 24+).

### 2. Configurazione `package.json` — sezione `build.publish`

```json
"publish": {
  "provider": "github",
  "owner": "egodi99",
  "repo": "call-alert"
}
```

Dice a `electron-builder` dove caricare i binari e dove l'app deve cercare gli aggiornamenti.

### 3. Logica auto-update in `src/main.js`

**Inizializzazione** (chiamata in `app.whenReady()`):
- Imposta `autoUpdater.autoDownload = true` — scarica automaticamente senza chiedere.
- Imposta `autoUpdater.autoInstallOnAppQuit = false` — non installare in modo invisibile alla chiusura; l'utente deve confermare esplicitamente dal tray.
- Registra i listener per gli eventi dell'updater.
- Avvia `autoUpdater.checkForUpdates()` con un delay di 3 secondi dopo il boot.

**Stato interno:**
```js
let updateReady = false;
```

**Event handlers:**

| Evento | Comportamento |
|--------|---------------|
| `update-available` | Log silenzioso, nessuna UI |
| `download-progress` | Log silenzioso |
| `update-downloaded` | Imposta `updateReady = true`, chiama `updateTray()` |
| `update-not-available` | Nessuna azione |
| `error` | Log silenzioso (`console.error`) |

**Modifica a `updateTray()`:**
Aggiunge una voce nel context menu quando `updateReady === true`:

```
⬆️ Aggiornamento pronto — Riavvia
```

Al click: `autoUpdater.quitAndInstall()`.

La voce è inserita prima del separatore finale (sopra "Esci") ed è visibile solo se `updateReady === true`.

### 4. GitHub Actions Workflow

**File:** `.github/workflows/release.yml`

**Trigger:** push di tag che corrispondono a `v*.*.*`

**Jobs:**

| Job | Runner | Output |
|-----|--------|--------|
| `build-mac` | `macos-latest` | `CallAlert-x.y.z.dmg`, `CallAlert-x.y.z-arm64.dmg`, `latest-mac.yml` |
| `build-win` | `windows-latest` | `CallAlert-Setup-x.y.z.exe`, `latest.yml` |

**Steps per ogni job:**
1. `actions/checkout@v4`
2. `actions/setup-node@v4` con Node 20
3. `npm ci`
4. `npx electron-builder --publish always` con la flag della piattaforma (`--mac` / `--win`)

**Autenticazione:** usa `secrets.GITHUB_TOKEN` (built-in, nessuna configurazione manuale richiesta).

**Permessi workflow:** `contents: write` — necessario per creare la Release e caricare gli asset.

---

## Flusso di rilascio

```bash
# 1. Modifica version in package.json (es. "1.8.0" → "1.9.0")
# 2. Commit, tag, push
git add package.json
git commit -m "bump version to 1.9.0"
git tag v1.9.0
git push && git push --tags
```

GitHub Actions parte automaticamente. Dopo ~5-10 minuti la Release è pubblicata con i binari per entrambe le piattaforme. Le app installate rilevano la nuova versione entro pochi minuti (al prossimo check automatico all'avvio).

---

## Comportamento UX

- **Nessun popup, nessuna interruzione** durante l'uso normale.
- Il download avviene completamente in background.
- Solo a download completato compare la voce tray `⬆️ Aggiornamento pronto — Riavvia`.
- L'utente può ignorarla e installarla quando vuole.
- Su Windows: l'installer NSIS sovrascrive la versione esistente.
- Su Mac: il DMG viene applicato tramite il meccanismo Squirrel di Electron.

---

## File modificati / creati

| File | Modifica |
|------|----------|
| `package.json` | Aggiunta `electron-updater` in `dependencies`, aggiunta sezione `build.publish` |
| `src/main.js` | Import `autoUpdater`, init con listeners, flag `updateReady`, voce tray |
| `.github/workflows/release.yml` | Nuovo file — workflow CI/CD |

---

## Vincoli e limitazioni note

### Mac — Code Signing

`electron-updater` su Mac usa Squirrel.Mac, che richiede che l'app sia **code-signed** con un certificato Apple Developer (~$99/anno). Senza firma:

- `autoUpdater.checkForUpdates()` emette un errore silenzioso.
- L'auto-update in background **non funziona su Mac**.

**Comportamento di fallback per Mac non firmato:** quando `autoUpdater` emette `error`, l'app fa un check manuale della versione tramite l'API pubblica di GitHub Releases (`/releases/latest`). Se trova una versione più recente, mostra nel tray la voce `⬆️ Nuova versione disponibile` che apre il browser sulla pagina della Release. L'utente scarica e installa manualmente il DMG.

**Su Windows** l'auto-update funziona senza code signing.

---

## Non incluso in questo scope

- Changelog automatico nelle Release notes (possibile estensione futura).
- Notifica agli utenti via UDP quando una nuova versione è disponibile (possibile estensione futura).
- Rollback automatico in caso di errore post-update.
