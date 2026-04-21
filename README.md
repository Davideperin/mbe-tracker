# MBE Tracker — Guida al Deploy

## Struttura del progetto

```
mbe-tracker/
├── public/              ← App web (HTML, CSS, JS)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── sw.js            ← Service Worker (PWA offline)
│   └── manifest.json    ← Config PWA (icona, nome app)
├── netlify/
│   └── functions/
│       └── mbe-proxy.js ← Proxy server → API MBE
├── netlify.toml         ← Config Netlify
└── .env.example         ← Template variabili d'ambiente
```

---

## Deploy su Netlify (5 minuti)

### Passo 1 — Crea account Netlify
Vai su https://netlify.com e registrati gratis (puoi usare Google).

### Passo 2 — Carica il progetto
1. Vai su https://app.netlify.com
2. Clicca **"Add new site" → "Deploy manually"**
3. **Trascina la cartella `mbe-tracker`** nella zona di upload
4. Attendi 30 secondi — Netlify ti darà un URL tipo `https://amazing-name-123.netlify.app`

### Passo 3 — Configura le credenziali MBE (IMPORTANTE)
Le credenziali NON vanno nel codice — si inseriscono come variabili d'ambiente sicure:

1. Nel pannello Netlify vai su **Site settings → Environment variables**
2. Clicca **"Add a variable"** e aggiungi:
   - Key: `MBE_USERNAME`  →  Value: il tuo username MBE
   - Key: `MBE_PASSPHRASE`  →  Value: la tua passphrase MBE
3. Clicca **Save**
4. Vai su **Deploys → Trigger deploy** per riavviare l'app con le nuove variabili

### Passo 4 — Testa l'app
Apri il tuo URL Netlify, premi il pulsante ↺ in alto a destra e le spedizioni MBE appariranno!

---

## Installare come app sul telefono (PWA)

### iPhone (Safari)
1. Apri l'URL dell'app in Safari
2. Tocca il pulsante **Condividi** (quadrato con freccia in su)
3. Scorri e tocca **"Aggiungi a schermata Home"**
4. Conferma — l'app apparirà sulla home come un'icona!

### Android (Chrome)
1. Apri l'URL in Chrome
2. Tocca i **tre puntini** in alto a destra
3. Tocca **"Aggiungi a schermata Home"** o **"Installa app"**

---

## Aggiornare le credenziali MBE

Quando rigeneri le credenziali nel portale MBE:
1. Vai su Netlify → Site settings → Environment variables
2. Modifica i valori di `MBE_USERNAME` e `MBE_PASSPHRASE`
3. Fai un nuovo deploy (Deploys → Trigger deploy)

---

## Aggiungere il login con password (opzionale, dopo)

Quando vuoi proteggere l'app con una password:
1. In Netlify vai su **Site settings → Access control → Password protection**
2. Attiva e imposta una password
3. Chiunque apra l'URL dovrà inserirla prima di vedere l'app

---

## Domande o problemi?
Contatta il tuo sviluppatore di fiducia 😊
