# Notification Volume Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un controllo volume (slider 0–100%) nella finestra Impostazioni che persiste in `config.json` e scala il gain del suono di notifica in `alert.html` e `coffee.html`.

**Architecture:** Il volume viene salvato come `notificationVolume` (float 0.0–1.0) in `config.json` accanto a `username`. `main.js` lo inietta nei payload IPC `update-calls` e `update-coffee` già esistenti; le finestre renderer lo leggono e lo passano a `playNotification(volume)`. Nessun nuovo canale IPC.

**Tech Stack:** Electron 28, Web Audio API (nativa nel renderer), Node.js `fs` per il config JSON.

---

## File modificati

| File | Modifiche |
|---|---|
| `src/main.js` | Variabile globale `notificationVolume`, `loadConfig`+`saveSettings`, altezza settings window, payload IPC |
| `src/settings.html` | Slider volume, label %, pulsante test, listener `load-config` aggiornato, `save-settings` |
| `src/alert.html` | `playNotification(volume)`, `currentVolume`, lettura da payload |
| `src/coffee.html` | `playNotification(volume)`, `currentVolume`, lettura da payload |

---

## Task 1: Aggiorna `main.js` — variabile globale, config, IPC

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Aggiungi la variabile globale `notificationVolume` in `main.js`**

In `src/main.js`, subito dopo la riga `let myUsername = 'Utente';` (riga 24), aggiungi:

```js
let notificationVolume = 0.7;
```

- [ ] **Step 2: Aggiorna `loadConfig` per leggere `notificationVolume`**

Sostituisci la funzione `loadConfig` esistente (righe 27–34):

```js
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      myUsername = data.username || 'Utente';
      notificationVolume = typeof data.notificationVolume === 'number' ? data.notificationVolume : 0.7;
    }
  } catch (e) {}
}
```

- [ ] **Step 3: Sostituisci `saveConfig` con `saveSettings`**

Sostituisci la funzione `saveConfig` esistente (righe 36–39):

```js
function saveSettings(username, volume) {
  myUsername = username;
  notificationVolume = volume;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ username, notificationVolume: volume }), 'utf8');
}
```

- [ ] **Step 4: Aggiorna la finestra settings — altezza e payload `load-config`**

In `openSettings` (riga 382), cambia `height: 320` in `height: 430`.

Poi, nella callback `did-finish-load` della settings window (riga 394), aggiorna il payload:

```js
settingsWindow.webContents.send('load-config', { username: myUsername, notificationVolume });
```

- [ ] **Step 5: Aggiungi `notificationVolume` al payload `update-calls`**

In `refreshAlert` (riga 306–312), aggiungi `notificationVolume` al payload:

```js
function refreshAlert(forceShow = false) {
  if (!alertWindow) return;
  alertWindow.webContents.send('update-calls', {
    calls: activeCalls,
    myUsername,
    notificationVolume,
    forceShow
  });
}
```

- [ ] **Step 6: Aggiungi `notificationVolume` ai payload `update-coffee`**

In `showCoffee` (riga 323–346), ci sono due `send('update-coffee', ...)`. Aggiorna entrambi aggiungendo `notificationVolume`:

Return anticipato (riga 324):
```js
coffeeWindow.webContents.send('update-coffee', {
  myUsername, forceShow, invitedBy: coffeeInvitedBy,
  isOwner: coffeeStartedByMe, rsvp: coffeeRSVP,
  notificationVolume
});
```

Nel `did-finish-load` (riga 344):
```js
coffeeWindow.webContents.send('update-coffee', {
  myUsername, forceShow: true, invitedBy: coffeeInvitedBy,
  isOwner: coffeeStartedByMe, rsvp: coffeeRSVP,
  notificationVolume
});
```

- [ ] **Step 7: Aggiungi `notificationVolume` in `broadcastCoffeeState`**

In `broadcastCoffeeState` (riga 363–371), aggiorna l'invio alla finestra locale:

```js
if (coffeeWindow) {
  coffeeWindow.webContents.send('update-coffee', {
    myUsername, forceShow: false,
    invitedBy: coffeeInvitedBy,
    isOwner: coffeeStartedByMe,
    rsvp: coffeeRSVP,
    notificationVolume
  });
}
```

- [ ] **Step 8: Aggiungi `notificationVolume` nel gestore `COFFEE_STATE` in `handlePacket`**

Nel ramo `} else if (packet.type === 'COFFEE_STATE') {` (riga 255–265):

```js
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
```

- [ ] **Step 9: Sostituisci il handler IPC `save-username` con `save-settings`**

Sostituisci (riga 505–508):

```js
ipcMain.on('save-settings', (_, { username, notificationVolume: volume }) => {
  saveSettings(username, volume);
  updateTray();
});
```

- [ ] **Step 10: Commit**

```bash
git add src/main.js
git commit -m "feat: add notificationVolume to config, IPC payloads, and settings window"
```

---

## Task 2: Aggiorna `settings.html` — slider, test, IPC

**Files:**
- Modify: `src/settings.html`

- [ ] **Step 1: Aggiungi gli stili CSS per lo slider**

Dentro il blocco `<style>`, subito prima della chiusura `</style>`, aggiungi:

```css
  input[type="range"] {
    -webkit-appearance: none;
    flex: 1;
    height: 4px;
    border-radius: 4px;
    background: rgba(255,255,255,0.15);
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ff3b30;
    cursor: pointer;
  }
  .volume-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }
  .volume-value {
    font-size: 15px;
    color: #fff;
    font-variant-numeric: tabular-nums;
    min-width: 38px;
    text-align: right;
  }
  .btn-test {
    padding: 7px 12px;
    font-size: 13px;
    white-space: nowrap;
  }
```

- [ ] **Step 2: Aggiungi la sezione volume nell'HTML**

Subito prima di `<div class="spacer"></div>`, aggiungi:

```html
  <div style="margin-top: 28px;">
    <label for="volume">Volume notifiche</label>
    <div class="volume-row">
      <input type="range" id="volume" min="0" max="100" step="1" />
      <span class="volume-value" id="volume-value">70%</span>
      <button class="btn btn-secondary btn-test" id="btn-test">🔔 Prova</button>
    </div>
  </div>
```

- [ ] **Step 3: Aggiorna il listener `load-config` nel blocco `<script>`**

Sostituisci il listener esistente:

```js
  ipcRenderer.on('load-config', (_, config) => {
    document.getElementById('username').value = config.username || '';
    const vol = typeof config.notificationVolume === 'number' ? config.notificationVolume : 0.7;
    const pct = Math.round(vol * 100);
    document.getElementById('volume').value = pct;
    document.getElementById('volume-value').textContent = pct + '%';
  });
```

- [ ] **Step 4: Aggiorna il listener del pulsante Salva**

Sostituisci il listener `btn-save` esistente:

```js
  document.getElementById('btn-save').addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    if (!username) { alert('Inserisci il tuo nome.'); return; }
    const notificationVolume = document.getElementById('volume').value / 100;
    ipcRenderer.send('save-settings', { username, notificationVolume });
    const s = document.getElementById('status');
    s.classList.add('show');
    setTimeout(() => { s.classList.remove('show'); window.close(); }, 1000);
  });
```

- [ ] **Step 5: Aggiungi i listener per slider e pulsante test**

Subito dopo il listener `btn-cancel`, aggiungi:

```js
  document.getElementById('volume').addEventListener('input', (e) => {
    document.getElementById('volume-value').textContent = e.target.value + '%';
  });

  document.getElementById('btn-test').addEventListener('click', () => {
    playNotificationTest(document.getElementById('volume').value / 100);
  });

  function playNotificationTest(volume) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      function playTone(freq, startAt, duration, gainPeak) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
        gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
        gain.gain.linearRampToValueAtTime(gainPeak * volume, ctx.currentTime + startAt + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
        osc.start(ctx.currentTime + startAt);
        osc.stop(ctx.currentTime + startAt + duration);
      }
      playTone(523, 0,    0.8, 0.18);
      playTone(659, 0.22, 0.9, 0.13);
      setTimeout(() => ctx.close(), 1500);
    } catch (e) {}
  }
```

- [ ] **Step 6: Verifica manuale — apri le impostazioni**

Avvia l'app:
```bash
npm start
```
Apri le impostazioni dal menu tray (⚙️ Impostazioni). Verifica:
- La finestra è più alta e lo slider è visibile
- Il valore percentuale si aggiorna trascinando lo slider
- Il pulsante "🔔 Prova" emette il suono (volume diverso a 10% vs 100%)
- Il pulsante Salva chiude la finestra senza errori

- [ ] **Step 7: Commit**

```bash
git add src/settings.html
git commit -m "feat: add volume slider and test button to settings UI"
```

---

## Task 3: Aggiorna `alert.html` — `playNotification(volume)`

**Files:**
- Modify: `src/alert.html`

- [ ] **Step 1: Aggiungi la variabile `currentVolume`**

Nel blocco `<script>` di `alert.html`, subito dopo `let knownCallIds = new Set();` (riga 211), aggiungi:

```js
let currentVolume = 0.7;
```

- [ ] **Step 2: Aggiorna `playNotification` per accettare il volume**

Sostituisci la funzione `playNotification` esistente (righe 214–247):

```js
function playNotification(volume) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function playTone(freq, startAt, duration, gainPeak) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(gainPeak * volume, ctx.currentTime + startAt + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    }

    playTone(523, 0,    0.8, 0.18);
    playTone(659, 0.22, 0.9, 0.13);

    setTimeout(() => ctx.close(), 1500);
  } catch (e) {
    console.log('Audio non disponibile:', e);
  }
}
```

- [ ] **Step 3: Aggiorna `renderCalls` per passare il volume**

In `renderCalls`, cambia la prima riga da:

```js
  if (isNew) playNotification();
```

a:

```js
  if (isNew) playNotification(currentVolume);
```

- [ ] **Step 4: Aggiorna il listener `update-calls` per leggere il volume**

Sostituisci il listener `update-calls` esistente (righe 310–323):

```js
ipcRenderer.on('update-calls', (_, data) => {
  myUsername = data.myUsername;
  if (typeof data.notificationVolume === 'number') currentVolume = data.notificationVolume;

  const incomingIds = Object.keys(data.calls);
  const hasNewCall = incomingIds.some(id => !knownCallIds.has(id));
  incomingIds.forEach(id => knownCallIds.add(id));
  for (const id of knownCallIds) {
    if (!data.calls[id]) knownCallIds.delete(id);
  }

  renderCalls(data.calls, hasNewCall);
});
```

- [ ] **Step 5: Commit**

```bash
git add src/alert.html
git commit -m "feat: make alert playNotification volume-aware"
```

---

## Task 4: Aggiorna `coffee.html` — `playNotification(volume)`

**Files:**
- Modify: `src/coffee.html`

- [ ] **Step 1: Aggiungi la variabile `currentVolume`**

Nel blocco `<script>` di `coffee.html`, subito dopo `let myAnswer = null;` (riga 241), aggiungi:

```js
let currentVolume = 0.7;
```

- [ ] **Step 2: Aggiorna `playNotification` per accettare il volume**

Sostituisci la funzione `playNotification` esistente (righe 243–263):

```js
function playNotification(volume) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    function playTone(freq, startAt, duration, gainPeak) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(gainPeak * volume, ctx.currentTime + startAt + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    }
    playTone(440, 0,    0.7, 0.12);
    playTone(554, 0.25, 0.7, 0.10);
    playTone(659, 0.50, 1.0, 0.08);
    setTimeout(() => ctx.close(), 2000);
  } catch(e) {}
}
```

- [ ] **Step 3: Aggiorna il listener `update-coffee` per leggere il volume e passarlo a `playNotification`**

Sostituisci il listener `update-coffee` esistente (righe 292–303):

```js
ipcRenderer.on('update-coffee', (_, data) => {
  myUsername = data.myUsername;
  if (typeof data.notificationVolume === 'number') currentVolume = data.notificationVolume;
  if (data.forceShow) {
    myAnswer = null;
    playNotification(currentVolume);
  }

  document.getElementById('banner-sub').textContent = `${data.invitedBy || '…'} ti aspetta al caffè`;
  document.getElementById('invited-by').textContent = `Proposta da ${data.invitedBy || '…'}`;

  renderRSVP(data.rsvp || {}, data.isOwner, data.invitedBy);
});
```

- [ ] **Step 4: Commit**

```bash
git add src/coffee.html
git commit -m "feat: make coffee playNotification volume-aware"
```

---

## Task 5: Verifica end-to-end

- [ ] **Step 1: Avvia l'app e apri le impostazioni**

```bash
npm start
```

Apri ⚙️ Impostazioni. Verifica che il volume salvato in precedenza sia precaricato nello slider (o 70% se config non aveva il campo).

- [ ] **Step 2: Imposta volume basso e salva**

Sposta lo slider a 10%, clicca "Salva".

- [ ] **Step 3: Simula una call**

Dal menu tray: "📞 Sto entrando in call". Verifica che il suono nell'alert window sia molto flebile.

- [ ] **Step 4: Torna alle impostazioni, imposta volume alto**

Apri impostazioni, sposta a 100%, clicca "Salva". Simula di nuovo una call. Verifica che il suono sia nettamente più forte.

- [ ] **Step 5: Verifica persistenza al riavvio**

Chiudi l'app (`Esci` dal tray), riavvia con `npm start`. Apri le impostazioni: lo slider deve mostrare il valore salvato.

- [ ] **Step 6: Verifica volume 0 = silenzio**

Imposta 0%, salva, simula una call: nessun suono udibile.
