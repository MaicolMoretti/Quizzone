import { createClient } from "@/lib/supabase/server";

/**
 * Crea un nuovo quiz per l'utente autenticato.
 *
 * Questa operazione viene eseguita sul server invece che direttamente nel
 * browser. Il client Supabase server legge la sessione dai cookie della
 * richiesta e mantiene quindi il JWT disponibile durante la verifica RLS.
 */
export async function POST(request: Request) {
  try {
    // Il client server usa i cookie della richiesta per mantenere la sessione
    // Supabase e per far valutare auth.uid() con l'utente corretto.
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // Senza un utente autenticato non è possibile soddisfare la policy INSERT
    // di public.quizzes, che richiede owner_id = auth.uid().
    if (authError || !user) {
      return Response.json(
        { error: "Devi effettuare il login prima di creare un quiz." },
        { status: 401 }
      );
    }

    // Il corpo contiene solo i dati editabili dal form. I valori vengono
    // normalizzati e verificati prima di essere passati al database.
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : null;

    // Il titolo è obbligatorio anche a livello applicativo, prima della
    // validazione NOT NULL eventualmente applicata dallo schema SQL.
    if (!title) {
      return Response.json(
        { error: "Il titolo del quiz è obbligatorio." },
        { status: 400 }
      );
    }

    // L'UUID viene generato qui per poter restituire l'identificativo creato
    // senza eseguire una SELECT successiva, che richiederebbe una policy SELECT
    // separata sulla nuova riga.
    const id = crypto.randomUUID();
    const { error } = await supabase
      .from("quizzes")
      .insert({
        id,
        title,
        description: description || null,
        // L'ID arriva dalla sessione verificata sul server: non viene mai
        // accettato dal client, evitando l'assegnazione di quiz ad altri utenti.
        owner_id: user.id,
        status: "draft",
      });

    // Restituisce l'errore del database senza esporre dati aggiuntivi della
    // tabella. Il codice 400 indica che la richiesta non è stata accettata.
    if (error) {
      return Response.json(
        { error: `Errore database: ${error.message}` },
        { status: 400 }
      );
    }

    // L'operazione è riuscita. Il frontend usa l'ID per aprire l'editor.
    return Response.json({ id }, { status: 201 });
  } catch {
    // Gestisce JSON non valido o errori inattesi senza lasciare la richiesta
    // senza risposta HTTP.
    return Response.json(
      { error: "Errore interno durante la creazione del quiz." },
      { status: 500 }
    );
  }
}
