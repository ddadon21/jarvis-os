-- =============================================================================
-- JARVIS CORE v0.1 — row-level security
--
-- Every table is deny-by-default. Enabling RLS with no policy denies everything;
-- each policy below then grants back exactly one thing. This is what makes the
-- anon key safe to ship to the browser, and it is the reason the application
-- code does not have to remember a `where user_id = ...` on every query — a
-- forgotten filter returns nothing rather than someone else's balances.
--
-- Two tables are intentionally narrower than the rest:
--   * audit_log gets INSERT and SELECT only. No update, no delete, for anyone.
--   * events gets a constrained UPDATE that can only advance processing state.
-- =============================================================================

alter table profiles                enable row level security;
alter table goals                   enable row level security;
alter table goal_criteria           enable row level security;
alter table goal_criterion_readings enable row level security;
alter table tasks                   enable row level security;
alter table events                  enable row level security;
alter table world_state_snapshots   enable row level security;
alter table agent_states            enable row level security;
alter table memories                enable row level security;
alter table notifications           enable row level security;
alter table approval_requests       enable row level security;
alter table permission_grants       enable row level security;
alter table audit_log               enable row level security;

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------
create policy profiles_select_own on profiles
  for select using (auth.uid() = id);

create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy profiles_insert_own on profiles
  for insert with check (auth.uid() = id);

-- --------------------------------------------------------------------------
-- Standard owner-only access for the tables the user fully controls.
-- --------------------------------------------------------------------------
create policy goals_owner on goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy goal_criteria_owner on goal_criteria
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy tasks_owner on tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy agent_states_owner on agent_states
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy memories_owner on memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy notifications_owner on notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy approval_requests_owner on approval_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy permission_grants_owner on permission_grants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy world_state_snapshots_owner on world_state_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- goal_criterion_readings — append-only measurement history.
-- Editing a past measurement would silently rewrite a goal's history.
-- --------------------------------------------------------------------------
create policy goal_criterion_readings_select on goal_criterion_readings
  for select using (auth.uid() = user_id);

create policy goal_criterion_readings_insert on goal_criterion_readings
  for insert with check (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- events — insert and read freely; update only the processing lifecycle.
--
-- The trigger below enforces immutability of the event body. RLS alone cannot
-- express "you may change this column but not that one".
-- --------------------------------------------------------------------------
create policy events_select_own on events
  for select using (auth.uid() = user_id);

create policy events_insert_own on events
  for insert with check (auth.uid() = user_id);

create policy events_update_own on events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function jarvis_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.event_type   is distinct from old.event_type
     or new.domain    is distinct from old.domain
     or new.source    is distinct from old.source
     or new.payload   is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at
     or new.user_id   is distinct from old.user_id then
    raise exception 'events are append-only: only processing_status and processed_at may change';
  end if;
  return new;
end;
$$;

create trigger events_immutable
  before update on events
  for each row execute function jarvis_events_immutable();

-- --------------------------------------------------------------------------
-- audit_log — insert and read. Never update, never delete.
--
-- An audit trail that can be edited is not an audit trail. The absence of
-- those two policies IS the control; do not add them.
-- --------------------------------------------------------------------------
create policy audit_log_select_own on audit_log
  for select using (auth.uid() = user_id);

create policy audit_log_insert_own on audit_log
  for insert with check (auth.uid() = user_id);

-- Belt and braces: a future policy added by mistake still cannot mutate a row.
create or replace function jarvis_audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update
  before update or delete on audit_log
  for each row execute function jarvis_audit_log_immutable();
