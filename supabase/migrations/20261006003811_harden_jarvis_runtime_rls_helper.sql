-- Harden the October durable-core RLS policies by reusing the private membership helper
-- created by the September persistence foundation. Remove the temporary public helper,
-- duplicate observer read policy, and duplicate observer time index.

drop policy if exists jarvis_runtime_events_member_read on public.jarvis_runtime_events;
create policy jarvis_runtime_events_member_read on public.jarvis_runtime_events for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_trades_member_read on public.trading_trades;
create policy trading_trades_member_read on public.trading_trades for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_trade_events_member_read on public.trading_trade_events;
create policy trading_trade_events_member_read on public.trading_trade_events for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_bars_member_read on public.trading_bars;
create policy trading_bars_member_read on public.trading_bars for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_model_versions_member_read on public.trading_model_versions;
create policy trading_model_versions_member_read on public.trading_model_versions for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_signals_member_read on public.trading_signals;
create policy trading_signals_member_read on public.trading_signals for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists jarvis_devices_member_read on public.jarvis_devices;
create policy jarvis_devices_member_read on public.jarvis_devices for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists jarvis_device_commands_member_read on public.jarvis_device_commands;
create policy jarvis_device_commands_member_read on public.jarvis_device_commands for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists jarvis_approvals_member_read on public.jarvis_approvals;
create policy jarvis_approvals_member_read on public.jarvis_approvals for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists jarvis_memory_facts_member_read on public.jarvis_memory_facts;
create policy jarvis_memory_facts_member_read on public.jarvis_memory_facts for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists jarvis_vault_notes_member_read on public.jarvis_vault_notes;
create policy jarvis_vault_notes_member_read on public.jarvis_vault_notes for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_trade_frames_member_read on public.trading_trade_frames;
create policy trading_trade_frames_member_read on public.trading_trade_frames for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

drop policy if exists trading_observer_snapshots_member_read on public.trading_observer_snapshots;
drop index if exists public.trading_observer_snapshots_ws_time;
drop function if exists public.jarvis_is_member(uuid);
