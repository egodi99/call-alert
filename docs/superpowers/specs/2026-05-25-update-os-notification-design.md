# Design: Notifica OS per Aggiornamento Disponibile

**Data:** 2026-05-25  
**Stato:** Approvato

## Obiettivo

Rendere più visibile la presenza di un aggiornamento disponibile usando una notifica OS nativa (macOS Notification Center / Windows Action Center), al posto della sola voce nel menu tray che è troppo discreta.

---

## Comportamento atteso

- La notifica OS compare **una sola volta per sessione**, nel momento in cui l'app rileva un aggiornamento.
- Due scenari distinti:
  - **Windows (auto-update)**: `electron-updater` scarica l'aggiornamento in background → notifica "Call Alert aggiornato" → click → `autoUpdater.quitAndInstall()`
  - **Mac (fallback manuale)**: `checkVersionFallback()` trova una versione più recente su GitHub → notifica "Nuova versione disponibile" → click → `shell.openExternal(RELEASES_URL)`
- La voce nel tray rimane invariata come secondo punto di accesso.

---

## Architettura

Singola funzione `showUpdateNotification(type)` in `src/main.js`, chiamata nei due punti in cui `updateState` viene impostato. Usa l'API nativa `Notification` di Electron (già disponibile, nessuna dipendenza aggiuntiva).

### Funzione

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

### Punti di chiamata

**`autoUpdater.on('update-downloaded')`:**
```js
autoUpdater.on('update-downloaded', () => {
  updateState = 'auto';
  updateTray();
  showUpdateNotification('auto');
});
```

**`checkVersionFallback()`, dopo `updateState = 'manual'`:**
```js
if (latestTag && isNewerVersion(latestTag, currentVersion)) {
  updateState = 'manual';
  updateTray();
  showUpdateNotification('manual');
}
```

---

## Casi limite

| Caso | Comportamento |
|------|---------------|
| `Notification.isSupported()` restituisce `false` | La funzione esce silenziosamente, nessun crash |
| Click su "installa" (`auto`) mentre è in call | `quitAndInstall()` forza uscita — comportamento già atteso, coerente con il tasto tray |
| Notifica mostrata più volte | Impossibile: `update-downloaded` e `checkVersionFallback` sono mutualmente esclusivi e ciascuno si attiva al massimo una volta per sessione |
| `RELEASES_URL` non definita | È già una costante in `main.js` — nessuna duplicazione necessaria |

---

## File modificati

| File | Modifica |
|------|----------|
| `src/main.js` | Aggiunta `Notification` all'import, aggiunta `showUpdateNotification(type)`, due call nei listener esistenti |
