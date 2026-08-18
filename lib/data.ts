// Capa de datos unificada.
//   - Sin credenciales de Supabase  -> MODO DEMO (store en memoria)
//   - Con credenciales               -> Supabase real
// Las páginas y acciones usan SOLO estas funciones, así el cambio de demo a
// producción es automático (basta completar .env.local).

import type {
  Category,
  CurrencyCode,
  Payment,
  Receipt,
  Service,
  ServiceStatus,
  PaymentStatus,
  ReceiptType,
  Rendicion,
} from "./types";
import { demoDb, newId } from "./demo-store";
import { toARS } from "./utils";

export const IS_DEMO =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Import perezoso del cliente de Supabase (evita tocar cookies() en modo demo)
async function sb() {
  const { createClient } = await import("./supabase/server");
  return createClient();
}

const nowIso = () => new Date().toISOString();

// ---------- Tipos de entrada ----------
export interface PaymentInput {
  service_id: string | null;
  category_id: string | null;
  description: string | null;
  amount: number;
  currency: CurrencyCode;
  exchange_rate: number | null;
  amount_ars: number | null;
  payment_date: string;
  payment_url: string | null;
  status: PaymentStatus;
  payment_method: string | null;
  provider: string | null;
  provider_tax_id: string | null;
  receipt_type: ReceiptType;
  receipt_number: string | null;
  notes: string | null;
}

export interface ServiceInput {
  name: string;
  description: string | null;
  url: string | null;
  category_id: string | null;
  status: ServiceStatus;
}

export interface FileLike {
  name: string;
  size: number;
  type: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

// ---------- Auth ----------
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  if (IS_DEMO) return { id: "demo-user", email: "demo@gestordia.app" };
  const supabase = await sb();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? "" } : null;
}

// ---------- Hidratación demo ----------
function hydrateService(s: Service): Service {
  const db = demoDb();
  return { ...s, category: db.categories.find((c) => c.id === s.category_id) ?? null };
}
function hydratePayment(p: Payment): Payment {
  const db = demoDb();
  return {
    ...p,
    category: db.categories.find((c) => c.id === p.category_id) ?? null,
    service: p.service_id ? db.services.find((s) => s.id === p.service_id) ?? null : null,
    receipts: db.receipts.filter((r) => r.payment_id === p.id),
  };
}

// ============================================================
// CATEGORIES
// ============================================================
export async function listCategories(): Promise<Category[]> {
  if (IS_DEMO) return [...demoDb().categories].sort((a, b) => a.name.localeCompare(b.name));
  const supabase = await sb();
  const { data } = await supabase.from("categories").select("*").order("name");
  return (data ?? []) as Category[];
}

export async function categoryPaymentCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (IS_DEMO) {
    demoDb().payments.forEach((p) => {
      if (p.category_id) counts[p.category_id] = (counts[p.category_id] ?? 0) + 1;
    });
    return counts;
  }
  const supabase = await sb();
  const { data } = await supabase.from("payments").select("category_id");
  (data ?? []).forEach((u: { category_id: string | null }) => {
    if (u.category_id) counts[u.category_id] = (counts[u.category_id] ?? 0) + 1;
  });
  return counts;
}

export async function createCategory(name: string, color: string): Promise<{ error?: string }> {
  if (IS_DEMO) {
    demoDb().categories.push({ id: newId("cat"), name, color, created_at: nowIso() });
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("categories").insert({ name, color });
  return { error: error?.message };
}

export async function updateCategory(id: string, name: string, color: string): Promise<void> {
  if (IS_DEMO) {
    const c = demoDb().categories.find((x) => x.id === id);
    if (c) {
      c.name = name;
      c.color = color;
    }
    return;
  }
  const supabase = await sb();
  await supabase.from("categories").update({ name, color }).eq("id", id);
}

export async function deleteCategory(id: string): Promise<void> {
  if (IS_DEMO) {
    const db = demoDb();
    db.categories = db.categories.filter((c) => c.id !== id);
    db.payments.forEach((p) => {
      if (p.category_id === id) p.category_id = null;
    });
    return;
  }
  const supabase = await sb();
  await supabase.from("categories").delete().eq("id", id);
}

// ============================================================
// SERVICES
// ============================================================
export async function listServices(): Promise<Service[]> {
  if (IS_DEMO) {
    const order: Record<ServiceStatus, number> = { active: 0, paused: 1, cancelled: 2 };
    return [...demoDb().services]
      .map(hydrateService)
      .sort((a, b) =>
        order[a.status] !== order[b.status]
          ? order[a.status] - order[b.status]
          : a.name.localeCompare(b.name)
      );
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("services")
    .select("*, category:categories(*)")
    .order("status", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Service[];
}

export async function listServicesSimple(): Promise<Service[]> {
  if (IS_DEMO) return [...demoDb().services].sort((a, b) => a.name.localeCompare(b.name));
  const supabase = await sb();
  const { data } = await supabase.from("services").select("*").order("name");
  return (data ?? []) as Service[];
}

export async function getService(id: string): Promise<Service | null> {
  if (IS_DEMO) {
    const s = demoDb().services.find((x) => x.id === id);
    return s ? hydrateService(s) : null;
  }
  const supabase = await sb();
  const { data } = await supabase.from("services").select("*").eq("id", id).single();
  return (data as Service) ?? null;
}

export async function getServicePayments(serviceId: string): Promise<Payment[]> {
  if (IS_DEMO) {
    return demoDb()
      .payments.filter((p) => p.service_id === serviceId)
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("service_id", serviceId)
    .order("payment_date", { ascending: false });
  return (data ?? []) as Payment[];
}

// Gasto real acumulado por servicio (solo pagos "paid"), separado por moneda
// para no mezclar ARS y USD sin tipo de cambio.
export interface ServiceSpendTotal {
  currency: CurrencyCode;
  total: number;
  count: number;
}

function aggregateSpend(
  rows: { service_id: string | null; amount: number; currency: CurrencyCode }[]
): Record<string, ServiceSpendTotal[]> {
  const byService: Record<string, ServiceSpendTotal[]> = {};
  for (const r of rows) {
    if (!r.service_id) continue;
    const totals = (byService[r.service_id] ??= []);
    const t = totals.find((x) => x.currency === r.currency);
    if (t) {
      t.total += Number(r.amount);
      t.count += 1;
    } else {
      totals.push({ currency: r.currency, total: Number(r.amount), count: 1 });
    }
  }
  return byService;
}

export async function servicePaidTotals(): Promise<Record<string, ServiceSpendTotal[]>> {
  if (IS_DEMO) {
    return aggregateSpend(demoDb().payments.filter((p) => p.status === "paid"));
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("service_id, amount, currency")
    .eq("status", "paid")
    .not("service_id", "is", null);
  return aggregateSpend((data ?? []) as { service_id: string; amount: number; currency: CurrencyCode }[]);
}

export async function createService(input: ServiceInput, userId: string | null): Promise<{ id?: string; error?: string }> {
  if (IS_DEMO) {
    const id = newId("srv");
    demoDb().services.push({ ...input, id, created_by: userId, created_at: nowIso(), updated_at: nowIso() });
    return { id };
  }
  const supabase = await sb();
  const { data, error } = await supabase
    .from("services")
    .insert({ ...input, created_by: userId })
    .select("id")
    .single();
  return { id: data?.id, error: error?.message };
}

export async function updateService(id: string, input: ServiceInput): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const s = demoDb().services.find((x) => x.id === id);
    if (s) Object.assign(s, input, { updated_at: nowIso() });
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("services").update(input).eq("id", id);
  return { error: error?.message };
}

export async function deleteService(id: string): Promise<void> {
  if (IS_DEMO) {
    const db = demoDb();
    db.services = db.services.filter((s) => s.id !== id);
    db.payments.forEach((p) => {
      if (p.service_id === id) p.service_id = null;
    });
    return;
  }
  const supabase = await sb();
  await supabase.from("services").delete().eq("id", id);
}

// ============================================================
// PAYMENTS
// ============================================================
export interface PaymentFilters {
  q?: string;
  category?: string;
  status?: string;
  currency?: string;
}

export async function listPayments(f: PaymentFilters = {}): Promise<Payment[]> {
  if (IS_DEMO) {
    let items = demoDb().payments.map(hydratePayment);
    if (f.category) items = items.filter((p) => p.category_id === f.category);
    if (f.status) items = items.filter((p) => p.status === f.status);
    if (f.currency) items = items.filter((p) => p.currency === f.currency);
    if (f.q) items = items.filter((p) => (p.description ?? "").toLowerCase().includes(f.q!.toLowerCase()));
    return items.sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  }
  const supabase = await sb();
  let query = supabase
    .from("payments")
    .select("*, category:categories(*), service:services(name), receipts(id, file_path, file_name, mime_type)")
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (f.category) query = query.eq("category_id", f.category);
  if (f.status) query = query.eq("status", f.status);
  if (f.currency) query = query.eq("currency", f.currency);
  if (f.q) query = query.ilike("description", `%${f.q}%`);
  const { data } = await query;
  return (data ?? []) as unknown as Payment[];
}

export async function recentPayments(limit: number): Promise<Payment[]> {
  if (IS_DEMO) {
    return demoDb()
      .payments.map(hydratePayment)
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
      .slice(0, limit);
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("*, category:categories(*), service:services(name)")
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as Payment[];
}

export async function monthPaidPayments(monthStart: string): Promise<Payment[]> {
  if (IS_DEMO) {
    return demoDb()
      .payments.map(hydratePayment)
      .filter((p) => p.status === "paid" && p.payment_date >= monthStart);
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("*, category:categories(*), service:services(name)")
    .gte("payment_date", monthStart)
    .eq("status", "paid");
  return (data ?? []) as unknown as Payment[];
}

// Pagos dentro de un rango de fechas [start, end) — para la rendición por período
export async function listPaymentsBetween(startInclusive: string, endExclusive: string): Promise<Payment[]> {
  if (IS_DEMO) {
    return demoDb()
      .payments.map(hydratePayment)
      .filter((p) => p.payment_date >= startInclusive && p.payment_date < endExclusive)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date));
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("*, category:categories(*), service:services(name), receipts(id, file_path, file_name, mime_type)")
    .gte("payment_date", startInclusive)
    .lt("payment_date", endExclusive)
    .order("payment_date", { ascending: true });
  return (data ?? []) as unknown as Payment[];
}

export async function getPayment(id: string): Promise<(Payment & { receipts: Receipt[] }) | null> {
  if (IS_DEMO) {
    const p = demoDb().payments.find((x) => x.id === id);
    if (!p) return null;
    return hydratePayment(p) as Payment & { receipts: Receipt[] };
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("*, receipts(*), category:categories(*), service:services(*)")
    .eq("id", id)
    .single();
  return (data as Payment & { receipts: Receipt[] }) ?? null;
}

export async function createPayment(
  input: PaymentInput,
  files: FileLike[],
  userId: string | null
): Promise<{ id?: string; error?: string }> {
  if (IS_DEMO) {
    const id = newId("pay");
    demoDb().payments.push({ ...input, id, paid_by: userId, created_at: nowIso(), updated_at: nowIso() });
    addReceiptsDemo(id, files, userId);
    return { id };
  }
  const supabase = await sb();
  const { data, error } = await supabase
    .from("payments")
    .insert({ ...input, paid_by: userId })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear el pago." };
  await uploadReceiptsSupabase(data.id, files, userId);
  return { id: data.id };
}

export async function updatePayment(
  id: string,
  input: PaymentInput,
  files: FileLike[],
  userId: string | null
): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const p = demoDb().payments.find((x) => x.id === id);
    if (p) Object.assign(p, input, { updated_at: nowIso() });
    addReceiptsDemo(id, files, userId);
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("payments").update(input).eq("id", id);
  if (error) return { error: error.message };
  await uploadReceiptsSupabase(id, files, userId);
  return {};
}

// Marca (o desmarca) pagos como rendidos al contador.
// Devuelve cuántas filas cambiaron de verdad.
//
// - Al MARCAR solo toca los que están pendientes (`rendido_at is null`), así
//   bajar el PDF dos veces no pisa la fecha real de la primera presentación.
// - Se manda de a tandas: un `.in()` con 300 ids se pasa del largo de URL que
//   acepta PostgREST.
export async function setPaymentsRendido(
  ids: string[],
  rendido: boolean
): Promise<{ error?: string; updated: number }> {
  if (ids.length === 0) return { updated: 0 };
  const rendido_at = rendido ? nowIso() : null;

  if (IS_DEMO) {
    let updated = 0;
    demoDb().payments.forEach((p) => {
      if (!ids.includes(p.id)) return;
      if (rendido && p.rendido_at) return; // ya rendido: no se pisa la fecha
      if (!rendido && !p.rendido_at) return;
      p.rendido_at = rendido_at;
      updated++;
    });
    return { updated };
  }

  const supabase = await sb();
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let q = supabase.from("payments").update({ rendido_at }).in("id", slice);
    q = rendido ? q.is("rendido_at", null) : q.not("rendido_at", "is", null);
    const { data, error } = await q.select("id");
    if (error) return { error: error.message, updated };
    updated += data?.length ?? 0;
  }
  return { updated };
}

export async function deletePayment(id: string): Promise<void> {
  if (IS_DEMO) {
    const db = demoDb();
    db.payments = db.payments.filter((p) => p.id !== id);
    db.receipts = db.receipts.filter((r) => r.payment_id !== id);
    return;
  }
  const supabase = await sb();
  const { data: receipts } = await supabase.from("receipts").select("file_path").eq("payment_id", id);
  if (receipts && receipts.length > 0) {
    await supabase.storage.from("receipts").remove(receipts.map((r) => r.file_path));
  }
  await supabase.from("payments").delete().eq("id", id);
}

// ============================================================
// SONDEO DE MIGRACIONES
// ============================================================
// La app tiene que seguir funcionando si falta correr un SQL, así que se sondea
// una vez y se cachea 60 segundos: apenas el usuario lo corre, se auto-cura sin
// necesidad de redeploy.
interface MigrationProbe {
  value: boolean;
  at: number;
}
const PROBE_TTL_MS = 60_000;

/**
 * ¿Este error significa "falta correr la migración" y no "algo salió mal"?
 *
 * Hay que mirar dos familias de códigos, y la diferencia se paga caro: Postgres
 * avisa de una COLUMNA faltante con 42703 ("column x does not exist"), pero de
 * una TABLA faltante avisa PostgREST, con su propio código PGRST205 y el
 * mensaje "Could not find the table ... in the schema cache" — nunca 42P01.
 * Buscando solo los códigos de Postgres, una tabla que no existe se leería como
 * error transitorio, la app se daría por migrada y el usuario recibiría el
 * error crudo de la base en vez del cartel que le dice qué SQL correr.
 */
function esFaltaDeMigracion(error: { code?: string; message: string }): boolean {
  return (
    error.code === "42P01" || // relation does not exist (Postgres)
    error.code === "42703" || // column does not exist (Postgres)
    error.code === "PGRST205" || // tabla ausente del schema cache (PostgREST)
    error.code === "PGRST204" || // columna ausente del schema cache (PostgREST)
    /does not exist|schema cache/i.test(error.message)
  );
}

// ============================================================
// RECEIPTS
// ============================================================
function addReceiptsDemo(paymentId: string, files: FileLike[], userId: string | null) {
  for (const f of files) {
    if (!f || f.size === 0) continue;
    demoDb().receipts.push({
      id: newId("rec"),
      payment_id: paymentId,
      file_path: `demo/${f.name}`,
      file_name: f.name,
      mime_type: f.type || null,
      size_bytes: f.size,
      uploaded_by: userId,
      created_at: nowIso(),
    });
  }
}

async function uploadReceiptsSupabase(paymentId: string, files: FileLike[], userId: string | null) {
  const supabase = await sb();
  for (const file of files) {
    if (!file || file.size === 0) continue;
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${paymentId}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage
      .from("receipts")
      .upload(path, file as unknown as File, { contentType: file.type || undefined, upsert: false });
    if (error) continue;
    await supabase.from("receipts").insert({
      payment_id: paymentId,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: userId,
    });
  }
}

export async function deleteReceipt(receiptId: string): Promise<void> {
  if (IS_DEMO) {
    const db = demoDb();
    db.receipts = db.receipts.filter((r) => r.id !== receiptId);
    return;
  }
  const supabase = await sb();
  const { data: receipt } = await supabase.from("receipts").select("file_path").eq("id", receiptId).single();
  if (receipt) {
    await supabase.storage.from("receipts").remove([receipt.file_path]);
    await supabase.from("receipts").delete().eq("id", receiptId);
  }
}

export async function getReceiptUrl(filePath: string, expiresInSeconds = 60 * 10): Promise<string | null> {
  if (IS_DEMO) return null; // en demo no hay archivo real
  const supabase = await sb();
  const { data } = await supabase.storage.from("receipts").createSignedUrl(filePath, expiresInSeconds);
  return data?.signedUrl ?? null;
}

// URLs firmadas en lote (una sola llamada). Se usa en la exportación de la
// rendición: enlace en el CSV y descarga de bytes para incrustar en el PDF.
export async function getReceiptUrls(
  filePaths: string[],
  expiresInSeconds = 60 * 60 * 24 * 7 // 7 días
): Promise<Record<string, string | null>> {
  const map: Record<string, string | null> = {};
  if (filePaths.length === 0) return map;
  if (IS_DEMO) {
    filePaths.forEach((p) => (map[p] = null)); // en demo no hay archivo real
    return map;
  }
  const supabase = await sb();
  const { data } = await supabase.storage.from("receipts").createSignedUrls(filePaths, expiresInSeconds);
  (data ?? []).forEach((row) => {
    if (row.path) map[row.path] = row.error ? null : row.signedUrl;
  });
  // Cualquier ruta sin respuesta queda como null
  filePaths.forEach((p) => (p in map ? null : (map[p] = null)));
  return map;
}

// ============================================================
// RENDICIONES  (migración 0005)
// ============================================================
// Una rendición es un LOTE cerrado: los pagos que se le entregaron al contador
// en una fecha concreta, con el período que realmente cubren, los totales
// congelados y el PDF que se imprimió.
//
// `payments.rendido_at` se sigue escribiendo: es la marca "ya se presentó" que
// leen el dashboard, los cargos recurrentes y el asistente. `rendicion_id` dice
// además en qué entrega fue.

// ¿Está corrida la migración 0005? Se sondea una vez, se cachea corto, y solo
// el error "no existe" cuenta como "falta el SQL": un fallo de red no puede
// degradar la app por 60 segundos.
export async function hasRendicionesTable(): Promise<boolean> {
  if (IS_DEMO) return true;
  const g = globalThis as unknown as { __gestorRendicionesProbe?: MigrationProbe };
  const cached = g.__gestorRendicionesProbe;
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;

  const supabase = await sb();
  const { error } = await supabase.from("rendiciones").select("id").limit(1);
  if (!error) {
    g.__gestorRendicionesProbe = { value: true, at: Date.now() };
    return true;
  }

  if (esFaltaDeMigracion(error)) {
    g.__gestorRendicionesProbe = { value: false, at: Date.now() };
    console.warn("[gestorDIA] Falta correr supabase/migrations/0005_rendiciones.sql:", error.message);
    return false;
  }

  console.warn("[gestorDIA] No se pudo sondear rendiciones:", error.message);
  return true;
}

const PAGO_SELECT =
  "*, category:categories(*), service:services(name), receipts(id, file_path, file_name, mime_type)";

/**
 * Todo lo que falta rendir, de cualquier período.
 *
 * A propósito NO filtra por mes: el gasto de enero cuya factura recién llegó en
 * marzo tiene que seguir a la vista, si no se pierde. El recorte por mes es un
 * filtro de la pantalla, no de la consulta.
 */
export async function listPendientesDeRendir(): Promise<Payment[]> {
  if (IS_DEMO) {
    return demoDb()
      .payments.map(hydratePayment)
      .filter((p) => !p.rendido_at)
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select(PAGO_SELECT)
    .is("rendido_at", null)
    .order("payment_date", { ascending: false });
  return (data ?? []) as unknown as Payment[];
}

// Totales de un conjunto de pagos, con el mismo criterio que la pantalla y el PDF
function totalesDe(pagos: Pick<Payment, "amount" | "currency" | "exchange_rate">[]) {
  const ars = pagos.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
  const usd = pagos.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);
  return { ars: Math.round(ars * 100) / 100, usd: Math.round(usd * 100) / 100 };
}

export interface CrearRendicionInput {
  ids: string[];
  titulo: string | null;
  notas: string | null;
}

export interface CrearRendicionResult {
  error?: string;
  /** null cuando falta la migración 0005: se marcaron los pagos, sin lote */
  rendicion?: Rendicion | null;
  /** Los pagos que EFECTIVAMENTE entraron (puede ser menos de los pedidos) */
  payments: Payment[];
  /** Pedidos que quedaron afuera por no estar pagados o ya estar rendidos */
  descartados: number;
}

/**
 * Cierra una rendición: crea el lote y le engancha los pagos.
 *
 * Los totales y el período NO vienen del cliente: se recalculan acá sobre los
 * pagos que realmente se pudieron enganchar. Si el navegador tenía la lista
 * desactualizada (alguien rindió lo mismo desde otra pantalla), el lote refleja
 * lo que pasó, no lo que el cliente creía.
 */
export async function crearRendicion(
  input: CrearRendicionInput,
  userId: string | null
): Promise<CrearRendicionResult> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return { error: "No hay pagos para rendir.", payments: [], descartados: 0 };

  const presentada_at = nowIso();

  if (IS_DEMO) {
    const db = demoDb();
    const elegibles = db.payments.filter((p) => ids.includes(p.id) && p.status === "paid" && !p.rendido_at);
    if (elegibles.length === 0) {
      return { error: "Esos pagos ya estaban rendidos o no están confirmados.", payments: [], descartados: ids.length };
    }
    const { ars, usd } = totalesDe(elegibles);
    const fechas = elegibles.map((p) => p.payment_date).sort();
    const rendicion: Rendicion = {
      id: newId("ren"),
      numero: db.rendiciones.reduce((a, r) => Math.max(a, r.numero), 0) + 1,
      titulo: input.titulo,
      notas: input.notas,
      periodo_desde: fechas[0],
      periodo_hasta: fechas[fechas.length - 1],
      cantidad: elegibles.length,
      total_ars: ars,
      total_usd: usd,
      pdf_path: null,
      presentada_at,
      created_by: userId,
      created_at: presentada_at,
    };
    db.rendiciones.push(rendicion);
    elegibles.forEach((p) => {
      p.rendido_at = presentada_at;
      p.rendicion_id = rendicion.id;
    });
    return {
      rendicion,
      payments: elegibles.map(hydratePayment),
      descartados: ids.length - elegibles.length,
    };
  }

  const supabase = await sb();
  const migrado = await hasRendicionesTable();

  // Modo degradado (falta la 0005): se marcan los pagos como antes. Sin lote no
  // hay historial ni PDF archivado, pero la app no se rompe.
  if (!migrado) {
    const r = await setPaymentsRendido(ids, true);
    if (r.error) return { error: r.error, payments: [], descartados: 0 };
    const { data } = await supabase.from("payments").select(PAGO_SELECT).in("id", ids);
    return {
      rendicion: null,
      payments: (data ?? []) as unknown as Payment[],
      descartados: ids.length - r.updated,
    };
  }

  // 1) Qué se puede rendir de verdad, leído del servidor
  const { data: candidatos, error: errLeer } = await supabase
    .from("payments")
    .select(PAGO_SELECT)
    .in("id", ids)
    .eq("status", "paid")
    .is("rendido_at", null);
  if (errLeer) return { error: errLeer.message, payments: [], descartados: 0 };

  const elegibles = (candidatos ?? []) as unknown as Payment[];
  if (elegibles.length === 0) {
    return { error: "Esos pagos ya estaban rendidos o no están confirmados.", payments: [], descartados: ids.length };
  }

  // 2) El lote, con los totales de lo que se leyó
  const { ars, usd } = totalesDe(elegibles);
  const fechas = elegibles.map((p) => p.payment_date).sort();
  const { data: creada, error: errCrear } = await supabase
    .from("rendiciones")
    .insert({
      titulo: input.titulo,
      notas: input.notas,
      periodo_desde: fechas[0],
      periodo_hasta: fechas[fechas.length - 1],
      cantidad: elegibles.length,
      total_ars: ars,
      total_usd: usd,
      presentada_at,
      created_by: userId,
    })
    .select("*")
    .single();
  if (errCrear || !creada) {
    return { error: errCrear?.message ?? "No se pudo crear la rendición.", payments: [], descartados: 0 };
  }

  const rendicion = creada as Rendicion;

  // 3) Enganchar los pagos. El filtro por rendido_at nulo es la carrera real: si
  //    entre el paso 1 y este alguien rindió el mismo pago desde otra pestaña,
  //    acá queda afuera en vez de quedar en dos lotes a la vez.
  const enganchados: string[] = [];
  const CHUNK = 100;
  const idsElegibles = elegibles.map((p) => p.id);
  for (let i = 0; i < idsElegibles.length; i += CHUNK) {
    const slice = idsElegibles.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("payments")
      .update({ rendido_at: presentada_at, rendicion_id: rendicion.id })
      .in("id", slice)
      .is("rendido_at", null)
      .select("id");
    if (error) {
      // Deshacer lo hecho: un lote a medias es peor que ninguno
      await supabase.from("payments").update({ rendido_at: null, rendicion_id: null }).eq("rendicion_id", rendicion.id);
      await supabase.from("rendiciones").delete().eq("id", rendicion.id);
      return { error: error.message, payments: [], descartados: 0 };
    }
    enganchados.push(...(data ?? []).map((r: { id: string }) => r.id));
  }

  if (enganchados.length === 0) {
    await supabase.from("rendiciones").delete().eq("id", rendicion.id);
    return {
      error: "Esos pagos se rindieron desde otro lado mientras armabas este PDF.",
      payments: [],
      descartados: ids.length,
    };
  }

  // 4) Si se enganchó menos de lo leído, el lote tiene que decir la verdad
  const finales = elegibles.filter((p) => enganchados.includes(p.id));
  if (finales.length !== elegibles.length) {
    const t = totalesDe(finales);
    const f = finales.map((p) => p.payment_date).sort();
    const { data: ajustada } = await supabase
      .from("rendiciones")
      .update({
        cantidad: finales.length,
        total_ars: t.ars,
        total_usd: t.usd,
        periodo_desde: f[0],
        periodo_hasta: f[f.length - 1],
      })
      .eq("id", rendicion.id)
      .select("*")
      .single();
    if (ajustada) Object.assign(rendicion, ajustada as Rendicion);
  }

  return { rendicion, payments: finales, descartados: ids.length - finales.length };
}

export async function listRendiciones(): Promise<Rendicion[]> {
  if (IS_DEMO) {
    return [...demoDb().rendiciones].sort((a, b) => b.presentada_at.localeCompare(a.presentada_at));
  }
  if (!(await hasRendicionesTable())) return [];
  const supabase = await sb();
  const { data } = await supabase.from("rendiciones").select("*").order("presentada_at", { ascending: false });
  return (data ?? []) as Rendicion[];
}

export async function getRendicion(id: string): Promise<(Rendicion & { payments: Payment[] }) | null> {
  if (IS_DEMO) {
    const db = demoDb();
    const r = db.rendiciones.find((x) => x.id === id);
    if (!r) return null;
    const payments = db.payments
      .filter((p) => p.rendicion_id === id)
      .map(hydratePayment)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date));
    return { ...r, payments };
  }
  if (!(await hasRendicionesTable())) return null;
  const supabase = await sb();
  const [{ data: cab }, { data: pagos }] = await Promise.all([
    supabase.from("rendiciones").select("*").eq("id", id).maybeSingle(),
    supabase.from("payments").select(PAGO_SELECT).eq("rendicion_id", id).order("payment_date", { ascending: true }),
  ]);
  if (!cab) return null;
  return { ...(cab as Rendicion), payments: (pagos ?? []) as unknown as Payment[] };
}

export async function updateRendicion(
  id: string,
  campos: { titulo?: string | null; notas?: string | null }
): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const r = demoDb().rendiciones.find((x) => x.id === id);
    if (r) Object.assign(r, campos);
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("rendiciones").update(campos).eq("id", id);
  return { error: error?.message };
}

/**
 * Reabre una rendición: sus pagos vuelven a pendientes y el lote desaparece
 * (junto con el PDF archivado, que ya no documenta nada).
 */
export async function reabrirRendicion(id: string): Promise<{ error?: string; liberados: number }> {
  if (IS_DEMO) {
    const db = demoDb();
    let liberados = 0;
    db.payments.forEach((p) => {
      if (p.rendicion_id === id) {
        p.rendicion_id = null;
        p.rendido_at = null;
        liberados++;
      }
    });
    db.rendiciones = db.rendiciones.filter((r) => r.id !== id);
    return { liberados };
  }
  const supabase = await sb();
  const { data: cab } = await supabase.from("rendiciones").select("pdf_path").eq("id", id).maybeSingle();

  const { data, error } = await supabase
    .from("payments")
    .update({ rendido_at: null, rendicion_id: null })
    .eq("rendicion_id", id)
    .select("id");
  if (error) return { error: error.message, liberados: 0 };

  const path = (cab as { pdf_path: string | null } | null)?.pdf_path;
  if (path) await supabase.storage.from("rendiciones").remove([path]);
  const { error: errBorrar } = await supabase.from("rendiciones").delete().eq("id", id);
  if (errBorrar) return { error: errBorrar.message, liberados: data?.length ?? 0 };
  return { liberados: data?.length ?? 0 };
}

/** Saca UN pago de una rendición ya cerrada (se coló, o el contador lo rebotó). */
export async function quitarDeRendicion(paymentId: string): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const p = demoDb().payments.find((x) => x.id === paymentId);
    if (!p) return {};
    const rid = p.rendicion_id;
    p.rendicion_id = null;
    p.rendido_at = null;
    if (rid) recalcularDemo(rid);
    return {};
  }
  const supabase = await sb();
  const { data: pago } = await supabase.from("payments").select("rendicion_id").eq("id", paymentId).maybeSingle();
  const { error } = await supabase
    .from("payments")
    .update({ rendido_at: null, rendicion_id: null })
    .eq("id", paymentId);
  if (error) return { error: error.message };
  const rid = (pago as { rendicion_id: string | null } | null)?.rendicion_id;
  if (rid) await recalcularRendicion(rid);
  return {};
}

// Vuelve a calcular cabecera y totales de un lote a partir de los pagos que le
// quedan. Los totales están congelados a propósito, pero si se saca un pago
// dejarían de cuadrar con el detalle: ahí sí hay que recalcular.
async function recalcularRendicion(id: string): Promise<void> {
  const supabase = await sb();
  const { data } = await supabase
    .from("payments")
    .select("amount, currency, exchange_rate, payment_date")
    .eq("rendicion_id", id);
  const pagos = (data ?? []) as Pick<Payment, "amount" | "currency" | "exchange_rate" | "payment_date">[];
  if (pagos.length === 0) {
    const { data: cab } = await supabase.from("rendiciones").select("pdf_path").eq("id", id).maybeSingle();
    const path = (cab as { pdf_path: string | null } | null)?.pdf_path;
    if (path) await supabase.storage.from("rendiciones").remove([path]);
    await supabase.from("rendiciones").delete().eq("id", id);
    return;
  }
  const { ars, usd } = totalesDe(pagos);
  const fechas = pagos.map((p) => p.payment_date).sort();
  await supabase
    .from("rendiciones")
    .update({
      cantidad: pagos.length,
      total_ars: ars,
      total_usd: usd,
      periodo_desde: fechas[0],
      periodo_hasta: fechas[fechas.length - 1],
    })
    .eq("id", id);
}

function recalcularDemo(id: string): void {
  const db = demoDb();
  const r = db.rendiciones.find((x) => x.id === id);
  if (!r) return;
  const pagos = db.payments.filter((p) => p.rendicion_id === id);
  if (pagos.length === 0) {
    db.rendiciones = db.rendiciones.filter((x) => x.id !== id);
    return;
  }
  const { ars, usd } = totalesDe(pagos);
  const fechas = pagos.map((p) => p.payment_date).sort();
  Object.assign(r, {
    cantidad: pagos.length,
    total_ars: ars,
    total_usd: usd,
    periodo_desde: fechas[0],
    periodo_hasta: fechas[fechas.length - 1],
  });
}

// ---------- El PDF archivado ----------
/** Deja registrada la ruta del PDF que se subió al bucket. */
export async function setRendicionPdfPath(id: string, path: string): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const r = demoDb().rendiciones.find((x) => x.id === id);
    if (r) r.pdf_path = path;
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("rendiciones").update({ pdf_path: path }).eq("id", id);
  return { error: error?.message };
}

/** URL firmada del PDF archivado (1 hora). */
export async function getRendicionPdfUrl(path: string, expiresInSeconds = 60 * 60): Promise<string | null> {
  if (IS_DEMO) return null;
  const supabase = await sb();
  const { data } = await supabase.storage
    .from("rendiciones")
    .createSignedUrl(path, expiresInSeconds, { download: true });
  return data?.signedUrl ?? null;
}

// ---------- Completar datos fiscales sin salir de la rendición ----------
export interface DatosFiscales {
  provider: string | null;
  provider_tax_id: string | null;
  receipt_type: ReceiptType;
  receipt_number: string | null;
  exchange_rate: number | null;
}

/**
 * Actualiza SOLO los campos de rendición de un pago. Existe aparte de
 * updatePayment porque el circuito real es "el contador pide las facturas y las
 * cargo de a diez": abrir la ficha completa de cada pago para tipear un número
 * de factura es justo la fricción que hace que no se carguen.
 */
export async function actualizarDatosFiscales(
  id: string,
  campos: DatosFiscales
): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const p = demoDb().payments.find((x) => x.id === id);
    if (p) {
      Object.assign(p, campos, { updated_at: nowIso() });
      p.amount_ars = toARS(Number(p.amount), p.currency, p.exchange_rate);
    }
    return {};
  }
  const supabase = await sb();
  const { data: pago } = await supabase.from("payments").select("amount, currency").eq("id", id).maybeSingle();
  const patch: DatosFiscales & { amount_ars: number | null } = { ...campos, amount_ars: null };
  if (pago) {
    const { amount, currency } = pago as { amount: number; currency: CurrencyCode };
    patch.amount_ars = toARS(Number(amount), currency, campos.exchange_rate);
  }
  const { error } = await supabase.from("payments").update(patch).eq("id", id);
  return { error: error?.message };
}
