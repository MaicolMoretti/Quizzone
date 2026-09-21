# Quizzone

Quiz multiplayer dal vivo: Next.js per l’interfaccia, Supabase per account e database,
un server Node.js + Socket.IO per la partita e Redis per lo stato realtime.

## Configurazione locale

Richiede Node.js 22+, un progetto Supabase e Redis (oppure memoria temporanea per sviluppo).

```sh
npm ci
npm --prefix socket-server ci
cp .env.example .env.local
cp socket-server/.env.example socket-server/.env
```

Compilare i due file con i propri valori. Nel frontend servono solo URL Supabase,
chiave pubblica e `NEXT_PUBLIC_GAME_SERVER_URL`. La chiave `service_role` va
**esclusivamente** in `socket-server/.env`.

Nel SQL Editor di Supabase applicare, nell’ordine:

1. `database/schema.sql` **solo per un database nuovo**;
2. `database/game-engine.sql`;
3. `database/editor.sql`.

Le ultime due migrazioni sono riapplicabili. `editor.sql` abilita le policy per
collaboratori, domande e risposte e l’RPC `save_quiz`. La migrazione non cancella
contenuti esistenti. Le rimozioni dell’editor diventano logiche (`retired`) per non
eliminare lo storico. Gli accessi anonimi alle risposte corrette sono bloccati.

Avviare Redis come descritto in [socket-server/README.md](socket-server/README.md),
oppure impostare `GAME_STORE=memory` nel server solo per sviluppo. Poi, in due terminali:

```sh
npm run dev
npm run dev:engine
```

Aprire `http://localhost:3000`. Per usare telefoni sulla rete locale, configurare
l’URL del game server con l’IP raggiungibile del computer e aggiungere l’origine
frontend a `FRONTEND_ORIGINS` del server. `localhost` sul telefono indica il telefono.

In Supabase Auth configurare Site URL e redirect consentito
`http://localhost:3000/auth/callback` (più il corrispondente URL in produzione).
Se la conferma email è attiva, la registrazione mostra un invito a controllare la posta.

## Flusso disponibile

1. Registrazione/login → dashboard → **Nuovo quiz**.
2. Nell’editor compilare domande, opzioni, risposte corrette, tempi e punti → **Salva quiz**.
   Il salvataggio è transazionale; controlla i permessi e segnala modifiche concorrenti.
   Il riordino conserva la domanda selezionata. Le immagini possono essere indicate tramite URL.
3. Dashboard → **Avvia** → lobby del conduttore con codice, link e QR.
4. I giocatori entrano dalla homepage o `/play/[gameCode]`, senza account.
5. **Apri proiettore** apre `/game/[gameId]/presentation` in un’altra scheda.
6. Il conduttore avvia, mostra soluzione e classifica, passa alla domanda successiva
   e conclude. Preview e risposta hanno timer server-side; l’avanzamento degli altri
   stati è manuale.
7. I risultati vengono archiviati in Supabase. Una partita aperta si riprende dalla
   dashboard; refresh/disconnessione del giocatore recuperano identità e risposta inviata.

Le viste player rimangono sulla stessa route durante tutta la partita: lo stato
ricevuto dal server determina lobby, domanda, soluzione e classifica.
Le modifiche al quiz sono bloccate finché esistono partite `waiting`/`active`.
In modalità memoria un riavvio perde la partita: per sviluppo, eventuali record
rimasti aperti vanno segnati `expired` nel database prima di modificare nuovamente il quiz.

I dettagli di protocollo, limiti e deploy sono nel [README del motore](socket-server/README.md).
Il motore usa una singola istanza; per produzione utilizzare Redis persistente e HTTPS.
Non sono inclusi upload su Storage, interfaccia per invitare collaboratori o analisi dello storico.

## Verifiche

```sh
npm run lint
npx tsc --noEmit
npm run build
npm run test:db
npm run test:engine
# Browser, con Chromium di Playwright installato:
npm run test:e2e
# In alternativa, Chrome già installato sul computer:
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

`test:db` esegue schema e migrazioni su PostgreSQL WASM (PGlite), controllando RLS,
transazioni, conflitti, blocco durante partite e conservazione dello storico.
`test:engine` usa client Socket.IO reali e un repository isolato; il test Redis reale
si abilita con `TEST_REDIS_URL=redis://localhost:6379`.
`test:e2e` avvia servizi locali di test sulle porte 3100, 3101 e 54325: verifica salvataggio,
ricaricamento e partita con tre viste, senza usare credenziali o dati Supabase reali.
I servizi Auth/REST del browser test sono simulati; i permessi SQL sono verificati
separatamente dai test PostgreSQL. Tracce e screenshot sono in `test-results/`.
Se Turbopack non può aprire porte nel proprio ambiente, è disponibile anche
`npm run build -- --webpack`.
