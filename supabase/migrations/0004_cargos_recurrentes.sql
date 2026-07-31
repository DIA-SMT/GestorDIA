-- ============================================================================
-- gestorDIA — migración 0004
-- Cargos recurrentes por confirmar.
--
-- Un servicio mensual/anual ahora PROPONE el gasto de cada ciclo y el usuario
-- le da OK (o lo omite, si dieron de baja el servicio). El cargo propuesto NO
-- se guarda: se deriva de services.next_renewal_date. Lo que sí se guarda es:
--
--   1. payments.cycle_date        -> qué ciclo cubre un pago (árbitro de duplicados)
--   2. services.billing_anchor_day-> el día real de cobro, que sobrevive a febrero
--   3. service_cycle_skips        -> qué ciclos se omitieron y por qué
--
-- Correr en el SQL Editor de Supabase (una sola vez). Es idempotente.
-- La app funciona igual si todavía no la corriste: detecta que faltan las
-- columnas y cae a un modo degradado (sin protección contra doble confirmación).
-- ============================================================================

-- 1) Ciclo que cubre cada pago -----------------------------------------------
alter table payments add column if not exists cycle_date date;

-- Un servicio no puede tener dos pagos del mismo ciclo. Los pagos sueltos
-- (service_id null) y los cargados a mano (cycle_date null) quedan afuera.
create unique index if not exists payments_service_cycle_uniq
  on payments (service_id, cycle_date)
  where service_id is not null and cycle_date is not null;

create index if not exists payments_cycle_date_idx on payments (cycle_date);

-- 2) Día real de cobro del servicio ------------------------------------------
alter table services add column if not exists billing_anchor_day smallint;

do $$ begin
  alter table services add constraint services_billing_anchor_day_range
    check (billing_anchor_day is null or (billing_anchor_day between 1 and 31));
exception when duplicate_object then null; end $$;

-- Backfill: el día que ya tenga cargado cada servicio
update services
   set billing_anchor_day = extract(day from next_renewal_date)::smallint
 where billing_anchor_day is null
   and next_renewal_date is not null;

-- 3) Ciclos omitidos ----------------------------------------------------------
-- Para poder contestar "¿por qué no se cobró Figma en marzo?".
create table if not exists service_cycle_skips (
  id          uuid primary key default uuid_generate_v4(),
  service_id  uuid not null references services(id) on delete cascade,
  cycle_date  date not null,
  reason      text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (service_id, cycle_date)
);

create index if not exists service_cycle_skips_service_idx on service_cycle_skips (service_id);

alter table service_cycle_skips enable row level security;

drop policy if exists "service_cycle_skips all for authenticated" on service_cycle_skips;
create policy "service_cycle_skips all for authenticated" on service_cycle_skips
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
