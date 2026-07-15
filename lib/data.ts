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
  BillingCycle,
  ServiceStatus,
  PaymentStatus,
  ReceiptType,
  PaymentMode,
} from "./types";
import { demoDb, newId } from "./demo-store";

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
  billing_cycle: BillingCycle;
  expected_amount: number | null;
  currency: CurrencyCode;
  status: ServiceStatus;
  payment_mode: PaymentMode;
  next_renewal_date: string | null;
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
      .sort((a, b) => {
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        if (!a.next_renewal_date) return 1;
        if (!b.next_renewal_date) return -1;
        return a.next_renewal_date.localeCompare(b.next_renewal_date);
      });
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("services")
    .select("*, category:categories(*)")
    .order("status", { ascending: true })
    .order("next_renewal_date", { ascending: true, nullsFirst: false });
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

// Actualiza solo la próxima fecha de cobro de un servicio (al registrar un pago)
export async function setServiceRenewal(id: string, nextRenewalDate: string | null): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const s = demoDb().services.find((x) => x.id === id);
    if (s) {
      s.next_renewal_date = nextRenewalDate;
      s.updated_at = nowIso();
    }
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("services").update({ next_renewal_date: nextRenewalDate }).eq("id", id);
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
    .select("*, category:categories(*), service:services(name), receipts(id)")
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

// Marca (o desmarca) pagos como rendidos al contador
export async function setPaymentsRendido(ids: string[], rendido: boolean): Promise<{ error?: string }> {
  if (ids.length === 0) return {};
  const rendido_at = rendido ? nowIso() : null;
  if (IS_DEMO) {
    demoDb().payments.forEach((p) => {
      if (ids.includes(p.id)) p.rendido_at = rendido_at;
    });
    return {};
  }
  const supabase = await sb();
  const { error } = await supabase.from("payments").update({ rendido_at }).in("id", ids);
  return { error: error?.message };
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
