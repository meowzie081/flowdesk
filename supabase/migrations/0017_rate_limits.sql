-- Generic fixed-window rate limiter for sensitive server routes (admin user
-- creation, password change/reset). Buckets are keyed by (key, window start).
-- Only service_role may execute the function or touch the table, so limits are
-- enforced server-side via the admin client and cannot be read or reset by clients.
create table if not exists public.rate_limit_buckets (
  key text not null,
  bucket timestamptz not null,
  count integer not null default 0,
  primary key (key, bucket)
);
alter table public.rate_limit_buckets enable row level security;
-- No policies for authenticated/anon: default deny. service_role bypasses RLS.
grant select,insert,update,delete on public.rate_limit_buckets to service_role;

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare b timestamptz; c integer;
begin
  if p_limit is null or p_limit <= 0 or p_window_seconds is null or p_window_seconds <= 0 then
    return true;
  end if;
  b := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limit_buckets(key, bucket, count) values (p_key, b, 1)
  on conflict (key, bucket) do update set count = rate_limit_buckets.count + 1
  returning count into c;
  delete from rate_limit_buckets where key = p_key and bucket < b - make_interval(secs => p_window_seconds * 2);
  return c <= p_limit;
end $$;
revoke all on function public.check_rate_limit(text,integer,integer) from public, authenticated, anon;
grant execute on function public.check_rate_limit(text,integer,integer) to service_role;