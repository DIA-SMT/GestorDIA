-- ============================================================================
-- gestorDIA — migración 0003
-- Marca de rendición: cuándo se incluyó el pago en una rendición presentada
-- al contador. NULL = todavía pendiente de rendir.
-- ============================================================================
-- Correr en el SQL Editor de Supabase (una sola vez).

alter table payments add column if not exists rendido_at timestamptz;
