-- Single-row global app settings. Currently holds the feature-tabs
-- visibility flag toggled by admins from /admin.
create table if not exists app_settings (
  id text primary key default 'global',
  feature_tabs_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, feature_tabs_enabled)
values ('global', false)
on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Public read: the flag only reveals whether tabs are shown.
drop policy if exists app_settings_public_read on app_settings;
create policy app_settings_public_read on app_settings
  for select using (true);

-- No public write policy: writes happen via the service-role key only.
