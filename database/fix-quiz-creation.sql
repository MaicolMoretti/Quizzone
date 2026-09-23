-- Correzione per installazioni esistenti: INSERT ... RETURNING deve vedere la
-- riga appena creata dal proprietario senza dipendere dallo snapshot precedente
-- usato dalla funzione STABLE quiz_access. Cambia soltanto la policy SELECT.
-- I controlli owner_id = auth.uid() sugli inserimenti rimangono attivi.
-- Richiede lo schema e la migrazione editor già applicati; è riapplicabile.
begin;
alter policy "Users can view their own quizzes or collaborated quizzes"
  on public.quizzes
  using (owner_id = (select auth.uid()) or public.quiz_access(id));
commit;
