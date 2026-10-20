-- The app is a LIVE VIEW of the FRENZO Stock Ledger: people can read, nobody edits in the app.
-- All data arrives through the sync (service role), which bypasses these rules.
drop policy if exists "owner full access" on public.docs;
create policy "owner reads everything" on public.docs for select to authenticated using (public.my_role() = 'owner');
drop policy if exists "crew write logs" on public.docs;
drop policy if exists "crew update logs" on public.docs;
drop policy if exists "crew delete logs" on public.docs;
-- (crew keep "crew read station and logs")
