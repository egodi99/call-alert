# 📵 Call Alert

App desktop per segnalare le call in ufficio. Quando qualcuno entra in call, **tutti i PC** mostrano un alert rosso a schermo così da stare in silenzio.

---

## ✅ Requisiti

- **Node.js** versione 18 o superiore → https://nodejs.org
- Tutti i PC devono essere sulla **stessa rete LAN/Wi-Fi**

---

## 🚀 Installazione e avvio (sviluppo)

```bash
# 1. Entra nella cartella
cd call-alert

# 2. Installa le dipendenze
npm install

# 3. Avvia l'app
npm start
```

Al primo avvio si aprirà la finestra **Impostazioni** dove inserisci il tuo nome (es. "Marco").

---

## 📦 Build finale (file da distribuire)

### Windows (.exe installabile)
```bash
npm run build:win
```
Il file `.exe` verrà creato in `dist/`

### macOS (.dmg)
```bash
npm run build:mac
```
Il file `.dmg` verrà creato in `dist/`

> ⚠️ La build per Mac va eseguita su un Mac. La build per Windows va eseguita su Windows (o con Wine su Linux).

---

## 🖥️ Come si usa

1. **Ogni persona** in ufficio installa l'app sul proprio PC
2. Al primo avvio, ognuno imposta il **proprio nome** nelle impostazioni
3. L'app gira silenziosa nel **system tray** (barra in basso su Windows, menu bar su Mac)
4. Quando entri in call: **click destro sull'icona → "Sto entrando in call"**
5. Tutti i colleghi vedono immediatamente l'**alert rosso** a schermo
6. Quando la call finisce: **click destro → "Termina la mia call"** oppure clicca il bottone "✅ Termina" nell'alert

### Più call simultanee
Se più persone sono in call contemporaneamente, l'alert mostra **tutte le call attive** con nome e timer. Ogni persona può terminare solo la propria.

---

## 🔧 Come funziona (tecnico)

- Usa **UDP broadcast** sulla LAN (porta 47832) — nessun server esterno, tutto locale
- I messaggi vengono inviati in broadcast a tutta la rete locale
- Quando un nuovo PC si avvia, invia un PING e riceve lo stato corrente
- I dati di configurazione (nome utente) vengono salvati localmente in:
  - Windows: `%APPDATA%/call-alert/config.json`
  - Mac: `~/Library/Application Support/call-alert/config.json`

---

## 🛠️ Risoluzione problemi

**L'alert non compare sugli altri PC**
→ Controlla che tutti siano sulla stessa rete (stesso router/switch)
→ Disabilita temporaneamente il firewall per testare
→ Su Windows: permetti all'app di comunicare in rete privata

**L'icona non compare nel tray**
→ Su Windows potresti dover cliccare la freccia "^" nella barra delle applicazioni per vedere le icone nascoste
