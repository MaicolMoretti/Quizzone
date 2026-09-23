-- Abilita l’estensione che genera gli UUID delle righe.
create extension if not exists "uuid-ossp";

-- 1. Quiz: metadati, proprietario e stato editoriale.
create table quizzes (
    id uuid primary key default uuid_generate_v4(),
    title text not null,
    description text,
    cover_image text,
    owner_id uuid references auth.users(id) not null,
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Collaboratori: editor modifica, viewer può leggere il contenuto del quiz.
create table quiz_collaborators (
    id uuid primary key default uuid_generate_v4(),
    quiz_id uuid references quizzes(id) on delete cascade not null,
    user_id uuid references auth.users(id) on delete cascade not null,
    role text not null check (role in ('editor', 'viewer')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(quiz_id, user_id)
);

-- 3. Domande: ordine, testo, immagine, tempi in secondi e punteggi.
create table questions (
    id uuid primary key default uuid_generate_v4(),
    quiz_id uuid references quizzes(id) on delete cascade not null,
    question_text text not null,
    image_url text,
    question_order integer not null,
    preview_seconds integer not null default 5,
    answer_seconds integer not null default 15,
    correct_points integer not null default 100,
    wrong_points integer not null default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Opzioni: ordine e correttezza, mai leggibili direttamente dai giocatori anonimi.
create table answers (
    id uuid primary key default uuid_generate_v4(),
    question_id uuid references questions(id) on delete cascade not null,
    answer_text text not null,
    answer_order integer not null,
    is_correct boolean not null default false
);

-- 5. Partite: codice pubblico, conduttore e stato sintetico dello storico.
create table games (
    id uuid primary key default uuid_generate_v4(),
    quiz_id uuid references quizzes(id) on delete cascade not null,
    game_code text not null unique,
    status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'expired')),
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_by uuid references auth.users(id) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Giocatori: nickname e punteggio finale della singola partita.
create table game_players (
    id uuid primary key default uuid_generate_v4(),
    game_id uuid references games(id) on delete cascade not null,
    nickname text not null,
    socket_session_id text,
    score integer not null default 0,
    joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
    last_seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(game_id, nickname)
);

-- 7. Invii storici: risposta scelta, correttezza, punti e tempo impiegato.
create table player_answers (
    id uuid primary key default uuid_generate_v4(),
    game_id uuid references games(id) on delete cascade not null,
    question_id uuid references questions(id) on delete cascade not null,
    player_id uuid references game_players(id) on delete cascade not null,
    answer_id uuid references answers(id) on delete cascade not null,
    is_correct boolean not null,
    points_awarded integer not null,
    response_time integer not null, -- millisecondi trascorsi prima dell’invio
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Configurazione RLS: permessi di accesso alle singole righe.

-- Policy iniziali per i quiz; editor.sql completa e aggiorna i permessi.
alter table quizzes enable row level security;
create policy "Users can view their own quizzes or collaborated quizzes" on quizzes
    for select using (
        auth.uid() = owner_id or 
        exists (select 1 from quiz_collaborators where quiz_id = quizzes.id and user_id = auth.uid())
    );
create policy "Users can insert their own quizzes" on quizzes
    for insert with check (auth.uid() = owner_id);
create policy "Users can update their own quizzes or if editor" on quizzes
    for update using (
        auth.uid() = owner_id or 
        exists (select 1 from quiz_collaborators where quiz_id = quizzes.id and user_id = auth.uid() and role = 'editor')
    );
create policy "Users can delete their own quizzes" on quizzes
    for delete using (auth.uid() = owner_id);

-- Schema di base storico: da solo NON è una configurazione completa.
-- Applicare anche game-engine.sql ed editor.sql prima di usare l’applicazione.
-- Per un database nuovo preferire setup.sql, che abilita tutte le RLS nella stessa transazione.
