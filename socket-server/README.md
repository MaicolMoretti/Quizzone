# Quizzone Game Engine

Microservizio Node.js (22+) separato da Next.js. Gestisce partite, timer, risposte,
classifiche, sessioni dei giocatori e archivio Supabase. Le UI Admin, Presentation e Player e il salvataggio dell’editor sono nel progetto Next.js alla radice.

## Avvio

1. Per un progetto Supabase nuovo eseguire l’intero `database/setup.sql` nel SQL
   Editor. Se lo schema di base esiste già, applicare nell’ordine `game-engine.sql`
   ed `editor.sql`, senza rilanciare il setup iniziale. I percorsi completi e le
   verifiche RLS sono descritti nel [README principale](../README.md#configurazione-di-supabase).
2. Dalla cartella `socket-server`: `npm ci` e `cp .env.example .env`.
3. Configurare URL e chiave **service_role** di Supabase, URL Redis e origini frontend.
   La chiave resta esclusivamente nel processo Node: non usare `NEXT_PUBLIC_`.
4. Avviare Redis con persistenza, per esempio:

   ```sh
   docker run -d --name quizzone-redis -p 127.0.0.1:6379:6379 -v quizzone-redis:/data redis:7-alpine redis-server --appendonly yes
   ```

5. Avviare `npm run dev` oppure `npm start`. Il server ascolta sulla porta 3001;
   Next.js continua ad avviarsi separatamente con `npm run dev` dalla radice.

`GAME_STORE=memory` permette sviluppo senza Redis; perde le partite al riavvio ed è
rifiutato con `NODE_ENV=production`. `GET /health` restituisce 200, oppure 503 se
il processo perde la propria lease Redis. Un errore durante l'avvio interrompe il server.

Il quiz deve già contenere domande e risposte persistite tramite **Salva quiz** nell’editor. Può avviarlo il proprietario o un collaboratore
`editor`; chi crea la partita diventa il suo unico conduttore.

## Protocollo Socket.IO

Ogni evento accetta un oggetto ed un acknowledgement:

```js
{ ok: true, data: { /* risultato */ } }
{ ok: false, error: { code: 'STALE_STATE', message: '...' } }
```

Senza callback gli errori arrivano su `game:error`. Ogni socket assume un solo ruolo
in una sola partita. Per cambiare partita/ruolo aprire una nuova connessione.
Le room interne sono identificate dal **gameId UUID**, non dal codice pubblico.

L'admin invia il JWT Supabase in `auth.accessToken` nella connessione. Il server
lo verifica su Supabase per ogni comando amministrativo. Dopo il refresh del JWT,
riconnettere il socket con il nuovo token e inviare nuovamente `admin:join`.

| Evento client → server | Payload | Risultato `data` |
| --- | --- | --- |
| `admin:create_game` | `{ quizId }` | `{ state }`, incluso codice a 6 cifre |
| `admin:join` | `{ gameCode }` oppure `{ gameId }` | `{ state }` |
| `presentation:join` | `{ gameCode }` oppure `{ gameId }` | `{ state }`, sola lettura |
| `player:join` | `{ gameCode, nickname }` | `{ playerId, sessionToken, state }` |
| `player:reconnect` | `{ gameCode, playerId, sessionToken }` | `{ playerId, answerId, state }` |
| `player:answer` | `{ questionId, answerId }` | `{ answerId }` |
| `admin:start_game` | `{ revision }` | `{ state }` |
| `admin:next_state` | `{ revision }` | `{ state }` |
| `admin:kick_player` | `{ revision, playerId }` | `{ state }` |
| `admin:end_game` | `{ revision }` | `{ state }` |
| `game:sync` | `{}` | `{ state, answerId }` (risposta personale, se player) |

`gameCode` è una stringa. La `revision` deve essere quella dell'ultimo stato
ricevuto: evita che doppi clic, richieste ripetute o schede obsolete saltino fasi.
Se arriva `STALE_STATE`, usare `game:sync` e lasciare che il conduttore confermi
nuovamente l'azione. Le vecchie bozze di eventi `admin:start_question`,
`admin:show_answer` e `admin:show_leaderboard` sono sostituite da `admin:next_state`.

| Evento server → client | Contenuto |
| --- | --- |
| `game:state_update` | Snapshot pubblico completo, con `revision` |
| `game:timer_update` | `{ gameId, revision, deadline, serverTime, timer }` |
| `game:leaderboard_update` | `{ gameId, revision, leaderboard }` |
| `game:ended` | Snapshot finale con `endReason` (`finished` o `expired`) |
| `player:kicked` | Rimozione seguita dalla disconnessione |
| `player:session_replaced` | La sessione è stata ripristinata su un altro socket |
| `game:error` | `{ code, message }` quando manca l'acknowledgement |

Lo snapshot contiene identificativi, titolo, fase, indice domanda (da zero; -1 in
lobby), totale domande, partecipanti con stato connessione, numero di risposte e
scadenza. Durante la preview espone solo testo/immagine; durante la risposta espone
le opzioni senza correttezza. Da `ANSWER_REVEAL` include soluzioni, statistiche e
classifica. Non espone mai token, hash delle sessioni, socket ID o risposte individuali.
Il proiettore può unirsi con il codice pubblico e vede lo stesso snapshot.

Le percentuali usano come denominatore le risposte ricevute, non tutti gli iscritti.
A parità di punti il rango è condiviso (1, 1, 3); il nome ordina solo la visualizzazione.

### Esempio client

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  auth: { accessToken: supabaseSession.access_token }, // omettere per player/proiettore
});
socket.on('game:state_update', state => renderGame(state));
socket.on('game:timer_update', tick => renderTimer(tick));

const result = await socket.timeout(10000).emitWithAck('admin:create_game', { quizId });
if (!result.ok) throw new Error(result.error.message);
const { gameCode } = result.data.state;
```

Il player conserva `playerId` e `sessionToken` restituiti dal join in `sessionStorage`
o `localStorage`, sotto una chiave specifica per partita. Su ogni nuova connessione
invoca `player:reconnect`, anziché ripetere `player:join`. Il token è una credenziale
privata: non inserirlo nel QR code. Una riconnessione sostituisce il socket precedente
e restituisce anche l'eventuale risposta già inviata alla domanda corrente.

## Regole della partita

```text
LOBBY --start--> QUESTION_PREVIEW --timer/next--> QUESTION_ACTIVE
  --timer/next--> QUESTION_LOCKED --next--> ANSWER_REVEAL
  --next--> LEADERBOARD --next--> NEXT_QUESTION --> QUESTION_PREVIEW
                       \--ultima domanda/next--> FINAL_RESULTS --next--> ENDED
```

- Il timer usa scadenze assolute del server. Tick ogni secondo circa; le risposte
  vengono rifiutate alla scadenza anche se il callback del timer è in ritardo.
- I tempi provengono dal quiz: preview 0–300 s, risposta 1–600 s. L'admin può saltare
  la preview o chiudere prima; il client non sceglie la durata né il tempo risposta.
- Un solo invio per giocatore/domanda. Il punteggio è fisso: `correct_points` per
  risposta corretta, `wrong_points` (zero o negativo) per risposta errata, zero per
  mancata risposta. Non è previsto un bonus legato alla velocità.
- Il server calcola i punti una sola volta alla chiusura. Le opzioni possono avere
  più risposte corrette, ma ogni giocatore ne seleziona una.
- Nuovi giocatori solo in lobby, nickname unici senza distinzione maiuscole/minuscole.
  Riconnessione consentita anche dopo l'avvio. Chi viene espulso non può recuperare
  quella sessione; i suoi invii restano nello storico, ma scompare dalla classifica.
- `admin:end_game` conclude anticipatamente, conteggiando gli invii della domanda
  attiva. Le partite scadono dopo 24 ore; risultati e sessioni finali restano per 1 ora.
- Limiti iniziali: 100 partite attive, 500 giocatori per partita, 200 domande,
  2–8 opzioni/domanda, 30 eventi al secondo per socket e payload massimo 16 KiB.

## Persistenza e deploy

Redis conserva lo snapshot privato dopo ogni mutazione, prima dell'ack/broadcast.
Al riavvio i giocatori risultano disconnessi e i timer recuperano le scadenze originali:
una domanda già scaduta non concede altro tempo. Configurare la persistenza Redis
(AOF/servizio gestito) per conservare i dati anche al riavvio di Redis stesso.
I record non hanno una TTL Redis automatica: l'engine archivia le partite scadute
anche dopo un fermo prolungato, poi rimuove gli snapshot finali scaduti.

Il database riceve subito la partita e lo stato di avvio; giocatori e risposte sono
archiviati insieme al termine tramite `archive_game`. L'RPC è transazionale e
ripetibile senza duplicare risposte. In caso di errore DB la conclusione è ritentabile;
le scadenze vengono ritentate automaticamente. Redis e PostgreSQL non condividono
una transazione: un'interruzione tra i due salvataggi può richiedere una ripetizione
della conclusione. Non eliminare quiz/domande/risposte di una partita in corso:
lo storico mantiene le foreign key previste dallo schema esistente.

Questa versione usa **un solo processo engine** per namespace Redis. Una lease con
scritture protette impedisce avvii concorrenti; dopo un arresto anomalo può essere
necessario aspettare fino a 30 secondi. Per scalare su più processi serviranno
partizionamento delle partite e un adapter Socket.IO; Redis da solo non li sostituisce.
Dopo perdita della lease il processo va riavviato. Usare un servizio Node persistente
(Render/Fly/VPS), TLS e `FRONTEND_ORIGINS` esplicito; il frontend può restare su Vercel.

## Test

```sh
cd socket-server
npm ci
npm test
# Aggiunge il test Redis reale, con namespace casuale isolato:
TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
```

I test coprono flusso completo, timer, punteggi, risposte duplicate/tardive,
autorizzazione, isolamento delle room, sessioni, espulsioni, ripristino e fallimenti di
persistenza. I test Socket.IO aprono una porta locale temporanea. Redis reale è
facoltativo e segnalato come skipped se `TEST_REDIS_URL` manca. Supabase è sostituito
nei test da un repository in memoria; la migrazione va applicata e verificata
nell'ambiente Supabase prima dell'uso reale.

## Mappa del codice e flusso di una richiesta

| File | Responsabilità |
| --- | --- |
| `index.js` | Legge l’ambiente, sceglie lo store e gestisce SIGINT/SIGTERM |
| `lib/server.js` | Collega eventi Socket.IO a operazioni autorizzate del motore |
| `lib/engine.js` | Valida input, serializza mutazioni, gestisce fasi e calcola snapshot |
| `lib/store.js` | Conserva lo stato privato e protegge l’accesso esclusivo a Redis |
| `lib/repository.js` | Interroga Supabase Auth/REST e archivia i risultati |

Una richiesta passa prima dai controlli di origine, dimensione e frequenza del
server. Il gestore verifica il ruolo del socket e, per i comandi del conduttore,
il JWT su Supabase. Il motore accoda la mutazione per codice partita e lavora su
una copia dello stato. Controlla le scadenze, applica l’operazione e salva lo stato
prima di confermarlo o pubblicarlo. Gli errori applicativi restituiscono un codice
leggibile; gli errori imprevisti producono una risposta generica senza credenziali.

La coda per socket mantiene l’ordine tra ingresso e comandi; la coda per partita
coordina client diversi e timer. La `revision` protegge i comandi amministrativi
dallo stato obsoleto. Nessuno di questi meccanismi sostituisce gli altri.

## Errori e recupero

| Codice o sintomo | Significato e gestione |
| --- | --- |
| `UNAUTHORIZED` | Credenziale assente o rifiutata: accedere nuovamente come organizzatore |
| `FORBIDDEN` | Ruolo o proprietario non autorizzato all’operazione |
| `INVALID_QUIZ` | Quiz incompleto o non valido: correggere e salvare nell’editor |
| `INVALID_CODE`, `GAME_NOT_FOUND` | Codice errato o partita non più presente nello store |
| `GAME_STARTED` | La lobby è terminata: nuovi giocatori non ammessi |
| `INVALID_NICKNAME`, `NICKNAME_TAKEN` | Correggere il nome prima di riprovare l’ingresso |
| `INVALID_SESSION` | Token non valido o sessione espulsa: non creare automaticamente un duplicato |
| `ALREADY_ANSWERED` | Risposta già accettata: sincronizzare la risposta personale |
| `ANSWERS_CLOSED` | Invio fuori dalla fase attiva o oltre la scadenza |
| `STALE_STATE` | Revisione vecchia: sincronizzare e richiedere una nuova azione esplicita |
| `RATE_LIMIT` | Superato il limite di eventi della connessione |
| `UNAVAILABLE`, HTTP 503 | Motore in chiusura o lease persa: verificare Redis e riavviare |
| `INTERNAL_ERROR` | Errore imprevisto: verificare i log prima di ripetere operazioni |

Un timeout del client non dimostra che la mutazione sia fallita: la conferma può
essersi persa dopo un salvataggio riuscito. Usare `game:sync` prima di ripetere un
comando. Gli eventi non sono una coda durevole di messaggi; il recupero avviene
attraverso lo stato persistito e la riconnessione della sessione.

## Configurazione e gestione operativa

Il modello è [`.env.example`](.env.example); la descrizione completa delle variabili
è nel [README principale](../README.md#configurazione-delle-variabili-dambiente).
URL pubblico del browser e `FRONTEND_ORIGINS` devono essere coerenti. Per le prove
con telefoni eseguire dalla radice `npm run configure:lan` e riavviare entrambi i
processi. Il QR contiene solo l’URL della pagina giocatore e il codice pubblico.

Per riavviare un container Redis già creato usare `docker start quizzone-redis`,
senza ripetere `docker run`. Controllare `docker exec quizzone-redis redis-cli ping`
e poi avviare il motore. Dopo una perdita della lease, il processo non torna sano
spontaneamente: richiede un riavvio anche quando Redis torna raggiungibile.

`GET /health` misura lo stato operativo del processo rispetto alla lease; non
esegue una verifica completa della connessione a Supabase. Per controllare anche
l’archivio serve una partita di prova conclusa correttamente.

Lo spegnimento smette di accettare operazioni, chiude i socket e attende quelle
accodate prima di rilasciare Redis. Il punto di ingresso impone un limite di
15 secondi alla chiusura. Un arresto forzato può lasciare la lease valida fino
alla sua scadenza di 30 secondi.

La conservazione dello stato finale per un’ora riguarda Redis; non cancella i
risultati già archiviati in PostgreSQL. Le rimozioni dell’editor sono logiche,
ma non costituiscono versionamento immutabile dei testi: lo storico conserva
UUID, esito e punti, non una copia completa di ogni vecchia versione del quiz.
