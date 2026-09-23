-- Existing installations: allow INSERT ... RETURNING to read the newly inserted
-- owner's row without querying it through a STABLE function's older snapshot.
-- This only alters the SELECT predicate; INSERT ownership checks stay unchanged.
begin;
alter policy "Users can view their own quizzes or collaborated quizzes"
  on public.quizzes
  using (owner_id = (select auth.uid()) or public.quiz_access(id));
commit;
