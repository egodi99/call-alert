# OS Update Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a native OS notification (macOS / Windows) when a new app version is detected, replacing the silent tray-only indicator.

**Architecture:** Add `showUpdateNotification(type)` to `src/main.js` using Electron's built-in `Notification` API. Call it in the two existing update detection points: `autoUpdater.on('update-downloaded')` (Windows auto-update) and `checkVersionFallback()` (Mac manual fallback). No new files, no new dependencies.

**Tech Stack:** Electron 28, `Notification` API (built-in), `autoUpdater` (electron-updater v6), `shell.openExternal`

---

### Task 1: Add OS update notification to `src/main.js`

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Add `Notification` to the Electron import (line 1)**

Replace:
```js
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
```
With:
```js
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, Notification } = require('electron');
```

- [ ] **Step 2: Add `showUpdateNotification(type)` after `setupAutoUpdater`**

Insert after the closing `}` of `setupAutoUpdater` (after line 109), before `getBroadcastAddresses`:

```js
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
```

- [ ] **Step 3: Call `showUpdateNotification('auto')` in `update-downloaded` handler**

Replace:
```js
  autoUpdater.on('update-downloaded', () => {
    updateState = 'auto';
    updateTray();
  });
```
With:
```js
  autoUpdater.on('update-downloaded', () => {
    updateState = 'auto';
    updateTray();
    showUpdateNotification('auto');
  });
```

- [ ] **Step 4: Call `showUpdateNotification('manual')` in `checkVersionFallback()`**

Replace:
```js
          if (latestTag && isNewerVersion(latestTag, currentVersion)) {
            updateState = 'manual';
            updateTray();
          }
```
With:
```js
          if (latestTag && isNewerVersion(latestTag, currentVersion)) {
            updateState = 'manual';
            updateTray();
            showUpdateNotification('manual');
          }
```

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: show OS notification when update is available"
```
