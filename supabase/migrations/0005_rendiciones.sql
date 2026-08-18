-- ============================================================================
-- gestorDIA — migración 0005
-- La rendición pasa a ser una ENTIDAD: cada entrega al contador es un lote
-- numerado, con su período real, sus totales congelados y su PDF archivado.
--
-- Antes solo existía `payments.rendido_at` (un timestamp suelto por pago). Con
-- eso no se podía contestar "¿qué le entregué al contador el 12 de agosto?":
-- dos entregas del mismo mes se mezclaban en una sola lista y el botón de
-- reimprimir armaba un PDF que nunca había existido.
--
--   1. rendiciones            -> el lote (Nº, fecha de entrega, período, totales, PDF)
--   2. payments.rendicion_id  -> a qué lote pertenece cada pago
--   3. bucket 'rendiciones'   -> el PDF exacto que se entregó, archivado
--
-- `rendido_at` se conserva: sigue siendo la marca "este pago ya se presentó" que
-- leen el dashboard y el asistente. Ahora además apunta a su lote.
--
-- Correr en el SQL Editor de Supabase (una sola vez). Es idempotente.
-- La app funciona igual si todavía no la corriste: detecta que falta la tabla y
-- cae al modo anterior (marca los pagos, pero sin historial ni PDF archivado).
-- ============================================================================

-- 1) El lote -----------------------------------------------------------------
-- El número correlativo sale de una secuencia y no del `max(numero)+1`: dos
-- rendiciones generadas al mismo tiempo se pisarían el número.
create sequence if not exists rendiciones_numero_seq;

create table if not exists rendiciones (
  id            uuid primary key default uuid_generate_v4(),
  numero        integer not null default nextval('rendiciones_numero_seq'),
  titulo        text,
  notas         text,
  -- Período que REALMENTE cubre: el mínimo y máximo payment_date de lo incluido.
  -- No es un mes calendario: una entrega puede arrastrar un gasto de enero cuya
  -- factura recién llegó en marzo.
  periodo_desde date not null,
  periodo_hasta date not null,
  cantidad      integer not null default 0,
  -- Totales congelados al momento de entregar. Si después se edita un pago, el
  -- lote sigue diciendo lo que decía el papel que firmó el contador.
  total_ars     numeric(14,2) not null default 0,
  total_usd     numeric(14,2) not null default 0,
  pdf_path      text,          -- ruta dentro del bucket 'rendiciones'
  presentada_at timestamptz not null default now(),
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create unique index if not exists rendiciones_numero_uniq on rendiciones (numero);
create index if not exists rendiciones_presentada_idx on rendiciones (presentada_at desc);

-- Por si la tabla ya existía de una corrida anterior
alter table rendiciones alter column numero set default nextval('rendiciones_numero_seq');

-- 2) A qué lote pertenece cada pago ------------------------------------------
-- `on delete set null`: borrar un lote reabre sus pagos, no los borra.
alter table payments add column if not exists rendicion_id uuid references rendiciones(id) on delete set null;
create index if not exists payments_rendicion_idx on payments (rendicion_id);

-- 3) Recuperar las entregas históricas ----------------------------------------
-- Los pagos marcados en una misma tanda comparten el `rendido_at` exacto (la app
-- calculaba el timestamp una sola vez por tanda), así que agrupando por ese
-- valor se reconstruyen las entregas reales, no un promedio por mes.
do $$
declare
  r record;
  nuevo uuid;
begin
  for r in
    select rendido_at,
           min(payment_date) as desde,
           max(payment_date) as hasta,
           count(*)          as cant,
           coalesce(sum(
             case
               when currency = 'ARS' then amount
               when amount_ars is not null then amount_ars
               when exchange_rate is not null then amount * exchange_rate
             end
           ), 0) as ars,
           coalesce(sum(amount) filter (where currency = 'USD'), 0) as usd
      from payments
     where rendido_at is not null
       and rendicion_id is null
     group by rendido_at
     order by rendido_at
  loop
    insert into rendiciones (periodo_desde, periodo_hasta, cantidad, total_ars, total_usd, presentada_at, notas)
    values (r.desde, r.hasta, r.cant, r.ars, r.usd, r.rendido_at,
            'Entrega recuperada del esquema anterior: no tiene el PDF archivado.')
    returning id into nuevo;

    update payments
       set rendicion_id = nuevo
     where rendido_at = r.rendido_at
       and rendicion_id is null;
  end loop;
end $$;

-- 4) RLS ----------------------------------------------------------------------
alter table rendiciones enable row level security;

drop policy if exists "rendiciones all for authenticated" on rendiciones;
create policy "rendiciones all for authenticated" on rendiciones
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 5) Bucket privado para los PDF entregados -----------------------------------
insert into storage.buckets (id, name, public)
values ('rendiciones', 'rendiciones', false)
on conflict (id) do nothing;

drop policy if exists "rendiciones read authenticated" on storage.objects;
create policy "rendiciones read authenticated" on storage.objects
  for select using (bucket_id = 'rendiciones' and auth.role() = 'authenticated');

drop policy if exists "rendiciones insert authenticated" on storage.objects;
create policy "rendiciones insert authenticated" on storage.objects
  for insert with check (bucket_id = 'rendiciones' and auth.role() = 'authenticated');

drop policy if exists "rendiciones delete authenticated" on storage.objects;
create policy "rendiciones delete authenticated" on storage.objects
  for delete using (bucket_id = 'rendiciones' and auth.role() = 'authenticated');
