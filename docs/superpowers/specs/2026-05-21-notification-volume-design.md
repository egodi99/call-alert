# Design: Controllo Volume Notifiche

**Data:** 2026-05-21  
**Stato:** Approvato

## Obiettivo

Permettere all'utente di impostare il volume del suono di notifica direttamente dalla finestra Impostazioni dell'app, con un'anteprima immediata tramite pulsante "Prova suono".

---

## Config e persistenza

`config.json` (in `app.getPath('userData')`) viene esteso con il campo `notificationVolume`:

```json
{ "username": "Marco", "notificationVolume": 0.7 }
```

- Tipo: float, range `0.0`–`1.0`
- Default: `0.7` (usato se il campo è assente nel config esistente)
- Salvato atomicamente insieme a `username` in un'unica scrittura su disco

In `main.js`:
- Aggiunta variabile globale `let notificationVolume = 0.7`
- `loadConfig()` legge anche `notificationVolume`
- Il handler IPC `save-username` viene sostituito da `save-settings`, che accetta `{ username, notificationVolume }` e aggiorna entrambe le variabili globali e il file config

---

## Flusso IPC

Nessun canale IPC nuovo. `notificationVolume` viene aggiunto ai payload esistenti:

| Canale | Direzione | Aggiunta |
|---|---|---|
| `load-config` | main → settings | `notificationVolume` nel payload |
| `update-calls` | main → alert | `notificationVolume` nel payload |
| `update-coffee` | main → coffee | `notificationVolume` nel payload (per futuri suoni) |
| `save-settings` | settings → main | sostituisce `save-username`; payload: `{ username, notificationVolume }` |

Il volume è una preferenza locale: non viene mai incluso nei pacchetti UDP.

In `alert.html`:
- `playNotification(volume)` riceve il volume come parametro
- I valori `gainPeak` sono scalati proporzionalmente al volume ricevuto (es. `0.18 * volume` e `0.13 * volume`)
- Variabile locale `let currentVolume = 0.7` aggiornata a ogni `update-calls`

---

## UI — Finestra Impostazioni

**Dimensione finestra:** 420×430px (da 420×320px)

**Nuovi elementi aggiunti sotto il campo nome:**

1. **Label** "VOLUME NOTIFICHE" — stesso stile delle label esistenti (uppercase, grigio, 13px)
2. **Slider** `<input type="range" min="0" max="100" step="1">` — accent color `#ff3b30`
3. **Valore corrente** mostrato inline (es. "70%") — aggiornato in tempo reale al trascinamento
4. **Pulsante "🔔 Prova suono"** — esegue `playNotification()` localmente nella finestra settings con il valore corrente dello slider, senza richiedere il salvataggio

Mockup:
```
⚙️ Impostazioni
Configura il tuo profilo per Call Alert

IL TUO NOME
[ Marco                          ]
Questo nome verrà mostrato agli altri quando sei in call.

VOLUME NOTIFICHE
[━━━━━━━━━━━━━━━●──────] 70%   [🔔 Prova suono]

                         [Annulla]  [Salva]

✅ Salvato!
```

---

## Gestione compatibilità

- Config esistenti senza `notificationVolume` funzionano senza modifiche: il default `0.7` viene applicato in memoria al caricamento.
- L'handler `save-username` viene rimosso e sostituito da `save-settings`; poiché è usato solo internamente tra main e settings, non ci sono impatti su altri componenti.

---

## File modificati

- `src/main.js` — `loadConfig`, `saveConfig`→`saveSettings`, variabile globale, payload IPC, handler IPC
- `src/settings.html` — slider, label, pulsante test, altezza finestra, logica IPC
- `src/alert.html` — `playNotification(volume)`, variabile `currentVolume`, lettura da payload
- `src/coffee.html` — aggiunta `notificationVolume` al payload `update-coffee` (nessun suono ancora)
