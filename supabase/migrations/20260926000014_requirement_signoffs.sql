-- SHOPEYE 0014 — Manual QA sign-off for SRS requirements (shopeye.in/status)
-- Current result per requirement + append-only history. Only holders of
-- permission srs.signoff (super_admin by default) can mark; everyone can read
-- the result, only signers see notes and who signed.
set search_path = public, extensions;

insert into public.permissions(code, portal, description, sensitive)
values ('srs.signoff', 'super_admin', 'Mark SRS requirements as tested (manual QA sign-off)', false)
on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values ('super_admin', 'srs.signoff') on conflict do nothing;

create table public.requirement_signoffs (
  req_id     text primary key check (req_id ~ '^(CUST|VS|SA|AF|SM|OPS)-FR-[0-9]{3,4}$'),
  result     text not null check (result in ('passed','failed')),
  note       text check (char_length(note) <= 500),
  tested_by  uuid not null references public.profiles(id),
  tested_at  timestamptz not null default now()
);
create table public.requirement_signoff_log (
  id         bigint generated always as identity primary key,
  req_id     text not null,
  result     text not null check (result in ('passed','failed','cleared')),
  note       text,
  tested_by  uuid not null references public.profiles(id),
  tested_at  timestamptz not null default now()
);
create index requirement_signoff_log_req_idx on public.requirement_signoff_log(req_id, tested_at desc);
create trigger requirement_signoff_log_immutable before update or delete on public.requirement_signoff_log
  for each row execute function app.forbid_mutation();
alter table public.requirement_signoffs enable row level security;
alter table public.requirement_signoff_log enable row level security;
revoke all on public.requirement_signoffs, public.requirement_signoff_log from anon, authenticated;

create or replace function public.mark_requirement(p_req text, p_result text, p_note text default null)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('srs.signoff');
  if p_req !~ '^(CUST|VS|SA|AF|SM|OPS)-FR-[0-9]{3,4}$' then raise exception 'INVALID_REQUIREMENT_ID'; end if;
  if p_result = 'failed' and coalesce(btrim(p_note), '') = '' then raise exception 'NOTE_REQUIRED: say what failed'; end if;
  if p_result = 'cleared' then
    delete from requirement_signoffs where req_id = p_req;
  elsif p_result in ('passed','failed') then
    insert into requirement_signoffs(req_id, result, note, tested_by) values (p_req, p_result, nullif(btrim(p_note),''), app.actor_id())
    on conflict (req_id) do update set result = excluded.result, note = excluded.note, tested_by = excluded.tested_by, tested_at = now();
  else raise exception 'UNKNOWN_RESULT';
  end if;
  insert into requirement_signoff_log(req_id, result, note, tested_by) values (p_req, p_result, nullif(btrim(p_note),''), app.actor_id());
  return p_result;
end $$;

-- Everyone sees results; only signers see note and tester name
create or replace function public.requirement_signoff_list()
returns table(req_id text, result text, tested_at timestamptz, note text, tested_by_name text)
language sql stable security definer set search_path = public, app, extensions as $$
  select s.req_id, s.result, s.tested_at,
         case when app.has_permission('srs.signoff') then s.note end,
         case when app.has_permission('srs.signoff') then p.full_name end
    from requirement_signoffs s join profiles p on p.id = s.tested_by
$$;
create or replace function public.requirement_signoff_history(p_req text)
returns table(result text, note text, tested_by_name text, tested_at timestamptz)
language sql stable security definer set search_path = public, app, extensions as $$
  select l.result, l.note, p.full_name, l.tested_at
    from requirement_signoff_log l join profiles p on p.id = l.tested_by
   where l.req_id = p_req and app.has_permission('srs.signoff')
   order by l.tested_at desc limit 50
$$;
revoke execute on function public.mark_requirement(text, text, text), public.requirement_signoff_list(), public.requirement_signoff_history(text) from public, anon, authenticated;
grant execute on function public.mark_requirement(text, text, text), public.requirement_signoff_history(text) to authenticated;
grant execute on function public.requirement_signoff_list() to anon, authenticated;
