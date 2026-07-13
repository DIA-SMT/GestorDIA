-- ============================================================================
-- gestorDIA — esquema inicial
-- Sistema de seguimiento de pagos con tarjeta (credenciales, suscripciones, etc.)
-- ============================================================================
-- Cómo aplicarlo:
--   Opción A) Pegá todo este archivo en el SQL Editor del dashboard de Supabase
--             y ejecutá.
--   Opción B) Con la CLI de Supabase:  supabase db push
-- ============================================================================

-- Extensiones -----------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- Tipos (enums) ---------------------------------------------------------------
do $$ begin
  create type billing_cycle as enum ('monthly', 'yearly', 'quarterly', 'weekly', 'one_time', 'on_demand', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_status as enum ('active', 'paused', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('paid', 'pending', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type currency_code as enum ('USD', 'ARS', 'EUR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_mode as enum ('automatic', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type receipt_type as enum (
    'factura_a', 'factura_b', 'factura_c', 'ticket',
    'recibo', 'nota_credito', 'comprobante_exterior', 'sin_comprobante'
  );
exception when duplicate_object then null; end $$;

-- Utilidad: mantener updated_at ----------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- profiles  (extiende auth.users)
-- ============================================================================
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'member',   -- 'admin' | 'member'
  created_at  timestamptz not null default now()
);

-- Al crearse un usuario en auth, creamos su perfil automáticamente
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill: si algún usuario se registró antes de correr esta migración,
-- le creamos el perfil ahora.
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', email)
from auth.users
on conflict (id) do nothing;

-- ============================================================================
-- categories
-- ============================================================================
create table if not exists categories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  color       text not null default '#6366f1',
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- services  (suscripciones / servicios recurrentes)
-- ============================================================================
create table if not exists services (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  description         text,
  url                 text,                       -- link al servicio / panel de la cuenta
  category_id         uuid references categories(id) on delete set null,
  billing_cycle       billing_cycle not null default 'monthly',
  expected_amount     numeric(12,2),              -- monto esperado por ciclo
  currency            currency_code not null default 'USD',
  status              service_status not null default 'active',
  payment_mode        payment_mode not null default 'automatic',  -- automático o manual (con alerta)
  next_renewal_date   date,                       -- próxima fecha de cobro (para avisos)
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists services_updated_at on services;
create trigger services_updated_at before update on services
  for each row execute function set_updated_at();

create index if not exists services_category_idx on services(category_id);
create index if not exists services_status_idx on services(status);
create index if not exists services_next_renewal_idx on services(next_renewal_date);

-- ============================================================================
-- payments  (cada pago concreto)
-- ============================================================================
create table if not exists payments (
  id              uuid primary key default uuid_generate_v4(),
  service_id      uuid references services(id) on delete set null,   -- opcional: pagos sueltos
  category_id     uuid references categories(id) on delete set null,
  description     text,                          -- ej: "Cursor Pro - Julio 2026"
  amount          numeric(12,2) not null,        -- monto en la moneda original
  currency        currency_code not null default 'USD',
  exchange_rate   numeric(12,4),                 -- cotización a ARS el día del pago
  amount_ars      numeric(14,2),                 -- equivalente en pesos (amount * exchange_rate)
  payment_date    date not null default current_date,
  payment_url     text,                          -- link de donde se pagó / factura online
  status          payment_status not null default 'paid',
  payment_method  text default 'Tarjeta principal',
  -- Rendición de cuentas
  provider        text,                          -- proveedor / razón social
  provider_tax_id text,                          -- CUIT / identificación fiscal
  receipt_type    receipt_type not null default 'sin_comprobante',
  receipt_number  text,                          -- número de comprobante / factura
  paid_by         uuid references profiles(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists payments_updated_at on payments;
create trigger payments_updated_at before update on payments
  for each row execute function set_updated_at();

create index if not exists payments_service_idx on payments(service_id);
create index if not exists payments_category_idx on payments(category_id);
create index if not exists payments_date_idx on payments(payment_date);
create index if not exists payments_status_idx on payments(status);

-- ============================================================================
-- receipts  (comprobantes en Storage)
-- ============================================================================
create table if not exists receipts (
  id            uuid primary key default uuid_generate_v4(),
  payment_id    uuid not null references payments(id) on delete cascade,
  file_path     text not null,                   -- path dentro del bucket 'receipts'
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists receipts_payment_idx on receipts(payment_id);

-- ============================================================================
-- Row Level Security
-- Modelo: equipo de confianza. Cualquier usuario autenticado puede ver y
-- gestionar todo. (Si más adelante querés roles finos, se ajusta acá.)
-- ============================================================================
alter table profiles   enable row level security;
alter table categories enable row level security;
alter table services   enable row level security;
alter table payments   enable row level security;
alter table receipts   enable row level security;

-- profiles: cada uno ve/edita su perfil; todos pueden leer la lista del equipo
drop policy if exists "profiles readable by authenticated" on profiles;
create policy "profiles readable by authenticated" on profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles updatable by owner" on profiles;
create policy "profiles updatable by owner" on profiles
  for update using (auth.uid() = id);

-- Resto de tablas: full access para autenticados
do $$
declare t text;
begin
  foreach t in array array['categories','services','payments','receipts'] loop
    execute format('drop policy if exists "%s all for authenticated" on %I', t, t);
    execute format(
      'create policy "%s all for authenticated" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- Storage bucket para recibos (privado)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Acceso al bucket solo para autenticados
drop policy if exists "receipts read authenticated" on storage.objects;
create policy "receipts read authenticated" on storage.objects
  for select using (bucket_id = 'receipts' and auth.role() = 'authenticated');

drop policy if exists "receipts insert authenticated" on storage.objects;
create policy "receipts insert authenticated" on storage.objects
  for insert with check (bucket_id = 'receipts' and auth.role() = 'authenticated');

drop policy if exists "receipts delete authenticated" on storage.objects;
create policy "receipts delete authenticated" on storage.objects
  for delete using (bucket_id = 'receipts' and auth.role() = 'authenticated');

-- ============================================================================
-- Datos semilla: categorías iniciales
-- ============================================================================
insert into categories (name, color) values
  ('IA / Créditos',   '#8b5cf6'),
  ('Hosting / Deploy', '#06b6d4'),
  ('Dominios',        '#f59e0b'),
  ('Diseño',          '#ec4899'),
  ('Herramientas',    '#10b981'),
  ('Otros',           '#6b7280')
on conflict do nothing;
