-- ============================================================================
-- gestorDIA — migración 0002
-- Agrega el ciclo "recarga a demanda" (créditos tipo OpenRouter):
-- servicios sin fecha fija de cobro donde solo se acumulan recargas.
-- ============================================================================
-- Correr en el SQL Editor de Supabase (una sola vez).

alter type billing_cycle add value if not exists 'on_demand';
