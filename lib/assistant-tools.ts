// Herramientas operativas del asistente virtual.
// Flujo en dos pasos: el modelo propone una acción (buildProposal arma la
// tarjeta de confirmación con los datos resueltos) y recién cuando el
// usuario confirma en el chat se ejecuta (executeAction).

import type { CurrencyCode, Payment, PaymentStatus, ReceiptType } from "./types";
import { RECEIPT_TYPE_LABELS } from "./types";
import {
  listCategories,
  listServicesSimple,
  listPayments,
  listPaymentsBetween,
  createPayment,
  createService,
  crearRendicion,
  getCurrentUser,
  getReceiptUrls,
  type PaymentInput,
  type ServiceInput,
} from "./data";
import { formatMoney, formatDate, toARS, todayISO } from "./utils";
import type { RendicionPdfRow } from "./rendicion-pdf";
import { filasDePagos, nombreArchivoDe, subtituloDe, tituloDe } from "./rendicion-doc";
import type { Rendicion } from "./types";

// ---------- Definiciones para el LLM (formato OpenAI/OpenRouter) ----------
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "crear_pago",
      description:
        "Registra un pago/gasto nuevo. Usala cuando el usuario pida cargar, registrar o anotar un gasto o pago. Preguntá antes si falta el monto o una descripción mínima.",
      parameters: {
        type: "object",
        properties: {
          descripcion: { type: "string", description: "Qué se pagó, ej: 'Claude Code — Julio 2026'" },
          monto: { type: "number", description: "Monto en la moneda original" },
          moneda: { type: "string", enum: ["ARS", "USD", "EUR"], description: "Moneda del pago" },
          cotizacion: { type: "number", description: "Cotización a ARS si la moneda no es ARS (opcional)" },
          fecha: { type: "string", description: "Fecha del pago YYYY-MM-DD (default: hoy)" },
          estado: { type: "string", enum: ["paid", "pending"], description: "Default paid" },
          categoria: { type: "string", description: "Nombre de una categoría existente (opcional)" },
          servicio: { type: "string", description: "Nombre de un servicio existente para asociar el pago (opcional)" },
          proveedor: { type: "string", description: "Proveedor / razón social (opcional)" },
          cuit: { type: "string", description: "CUIT del proveedor (opcional)" },
          medio_pago: { type: "string", description: "Ej: 'Tarjeta principal' (opcional)" },
          tipo_comprobante: {
            type: "string",
            enum: ["factura_a", "factura_b", "factura_c", "ticket", "recibo", "nota_credito", "comprobante_exterior", "sin_comprobante"],
          },
          nro_comprobante: { type: "string" },
          notas: { type: "string" },
        },
        required: ["descripcion", "monto", "moneda"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_servicio",
      description:
        "Crea un servicio nuevo. Un servicio solo AGRUPA pagos (ej: Cursor Pro, Vercel), para ver el historial y el total gastado. No tiene ciclo, monto esperado ni fecha de cobro, y no genera gastos: los pagos se cargan uno por uno cuando se pagan. Usala cuando el usuario pida crear o dar de alta un servicio.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          descripcion: { type: "string" },
          url: { type: "string", description: "URL de gestión/facturación (opcional)" },
          categoria: { type: "string", description: "Nombre de una categoría existente (opcional)" },
        },
        required: ["nombre"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generar_rendicion",
      description:
        "Genera el PDF de rendición de un período o filtro SIN marcar nada como rendido. Usala cuando el usuario pida 'hacé/generá/dame la rendición' o 'el PDF de la rendición' de un mes o de un proveedor/nombre. El PDF incluye los recibos/facturas adjuntos incrustados. Después el usuario puede descargarlo desde el chat y, si quiere, pedir marcarlos como rendidos.",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "string", description: "Mes a rendir en formato YYYY-MM (ej: 2026-07)" },
          texto: { type: "string", description: "Filtro por nombre/descripción/proveedor (ej: 'Claude', 'Vercel')" },
          pago_ids: { type: "array", items: { type: "string" }, description: "Ids puntuales de los DATOS (opcional, alternativa a mes/texto)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "marcar_rendido",
      description:
        "Marca pagos como rendidos al contador. Indicá los pagos por sus ids (pago_ids, de los DATOS) o por filtro: mes (YYYY-MM) y/o texto (nombre/proveedor). Con filtro, marca solo los que todavía están pendientes. Devuelve también el PDF de esa rendición (con recibos incrustados) para descargar.",
      parameters: {
        type: "object",
        properties: {
          pago_ids: { type: "array", items: { type: "string" }, description: "Ids de los pagos a rendir" },
          mes: { type: "string", description: "Mes a rendir en formato YYYY-MM (alternativa a pago_ids)" },
          texto: { type: "string", description: "Filtro por nombre/descripción/proveedor (alternativa a pago_ids)" },
        },
      },
    },
  },
];

// ---------- Tipos ----------
export interface ActionProposal {
  tool: string;
  title: string;
  fields: { label: string; value: string }[];
  warnings: string[];
  // Args ya normalizados/resueltos que ejecuta /api/chat/execute sin reinterpretar
  args: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  href?: string;
  pdf?: {
    rows: RendicionPdfRow[];
    totalARS: number;
    totalUSD: number;
    filename: string;
    title: string;
    subtitulo?: string;
    /** Si el PDF corresponde a un lote cerrado, el chat archiva la copia */
    rendicionId?: string;
  };
}

const CURRENCIES: CurrencyCode[] = ["ARS", "USD", "EUR"];
const RECEIPT_TYPES = Object.keys(RECEIPT_TYPE_LABELS) as ReceiptType[];

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
// Día calendario argentino, no UTC (ver todayISO en lib/utils.ts)
const today = () => todayISO();

// ---------- Rendición: resolución por mes/nombre y armado del PDF ----------
const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);

function monthRange(mes: string): { start: string; end: string } {
  const [y, m] = mes.split("-").map(Number);
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: `${mes}-01`, end };
}

function monthLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

// Resuelve los pagos de una rendición por mes y/o texto y/o ids explícitos
async function resolveRendicionPayments(raw: Record<string, unknown>): Promise<{
  found: Payment[];
  label: string;
  mes: string | null;
}> {
  const ids = Array.isArray(raw.pago_ids) ? raw.pago_ids.filter((x): x is string => typeof x === "string") : [];
  const mes = isMonth(raw.mes) ? raw.mes : null;
  const texto = typeof raw.texto === "string" && raw.texto.trim() ? raw.texto.trim().toLowerCase() : null;

  const base = mes
    ? await listPaymentsBetween(monthRange(mes).start, monthRange(mes).end)
    : await listPayments({});

  // Al contador solo se le rinde lo efectivamente pagado: un pago pendiente,
  // fallido o reembolsado no puede entrar en el PDF ni darse por presentado.
  let found = base.filter((p) => p.status === "paid");
  if (ids.length) found = found.filter((p) => ids.includes(p.id));
  if (texto) {
    found = found.filter((p) =>
      [p.description, p.provider, p.service?.name, p.receipt_number, p.category?.name].some((s) =>
        s?.toLowerCase().includes(texto)
      )
    );
  }
  found = [...found].sort((a, b) => a.payment_date.localeCompare(b.payment_date));

  const label = mes ? monthLabel(mes) : texto ? `"${String(raw.texto).trim()}"` : "todos los pagos";
  return { found, label, mes };
}

// Arma el payload del PDF (con recibos incrustados vía URL firmada) para el chat
// Si viene `lote`, el PDF sale identificado como esa rendición (mismo número,
// mismo subtítulo y mismo nombre de archivo que el que genera la pantalla): un
// comprobante cerrado desde el chat tiene que ser indistinguible de uno cerrado
// desde /rendicion.
async function buildRendicionPdf(
  found: Payment[],
  label: string,
  mes: string | null,
  lote?: Rendicion | null
): Promise<NonNullable<ActionResult["pdf"]>> {
  const paths = found
    .flatMap((p) => p.receipts ?? [])
    .map((r) => r.file_path)
    .filter((p): p is string => !!p);
  const urls = paths.length ? await getReceiptUrls([...new Set(paths)]) : {};

  const rows: RendicionPdfRow[] = filasDePagos(found, urls);
  const totalARS = rows.reduce((a, r) => a + (r.ars ?? 0), 0);
  const totalUSD = found.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);

  return {
    rows,
    totalARS,
    totalUSD,
    filename: lote ? nombreArchivoDe(lote.numero) : `rendicion-${mes ?? today()}.pdf`,
    title: lote ? tituloDe(lote) : `Rendición de cuentas — ${label}`,
    subtitulo: lote ? subtituloDe(lote) : undefined,
    rendicionId: lote?.id,
  };
}

async function resolveCategoria(
  nombre: unknown,
  warnings: string[]
): Promise<{ id: string; name: string } | null> {
  if (typeof nombre !== "string" || !nombre.trim()) return null;
  const cats = await listCategories();
  const q = nombre.trim().toLowerCase();
  const cat = cats.find((c) => c.name.toLowerCase() === q) ?? cats.find((c) => c.name.toLowerCase().includes(q));
  if (!cat) {
    warnings.push(`No existe la categoría "${nombre}": se guarda sin categoría.`);
    return null;
  }
  return { id: cat.id, name: cat.name };
}

// ---------- Propuesta (tarjeta de confirmación) ----------
export async function buildProposal(
  tool: string,
  raw: Record<string, unknown>
): Promise<ActionProposal | { error: string }> {
  const warnings: string[] = [];

  if (tool === "crear_pago") {
    const monto = Number(raw.monto);
    if (!Number.isFinite(monto) || monto <= 0) return { error: "El monto del pago no es válido." };
    const descripcion = typeof raw.descripcion === "string" ? raw.descripcion.trim() : "";
    if (!descripcion) return { error: "Falta la descripción del pago." };
    const moneda = CURRENCIES.includes(raw.moneda as CurrencyCode) ? (raw.moneda as CurrencyCode) : "ARS";
    const cotizacion = Number(raw.cotizacion) > 0 ? Number(raw.cotizacion) : null;
    const fecha = isDate(raw.fecha) ? raw.fecha : today();
    const estado: PaymentStatus = raw.estado === "pending" ? "pending" : "paid";
    const tipo = RECEIPT_TYPES.includes(raw.tipo_comprobante as ReceiptType)
      ? (raw.tipo_comprobante as ReceiptType)
      : "sin_comprobante";

    const categoria = await resolveCategoria(raw.categoria, warnings);
    const category_id = categoria?.id ?? null;

    let service_id: string | null = null;
    let serviceName: string | null = null;
    if (typeof raw.servicio === "string" && raw.servicio.trim()) {
      const services = await listServicesSimple();
      const q = raw.servicio.trim().toLowerCase();
      const srv = services.find((s) => s.name.toLowerCase() === q) ?? services.find((s) => s.name.toLowerCase().includes(q));
      if (srv) {
        service_id = srv.id;
        serviceName = srv.name;
      } else {
        warnings.push(`No existe el servicio "${raw.servicio}": el pago se crea sin servicio asociado.`);
      }
    }

    if (moneda !== "ARS" && !cotizacion) {
      warnings.push("Sin cotización, este pago no va a sumar en los totales en ARS (se puede cargar después editándolo).");
    }

    const input: PaymentInput = {
      service_id,
      category_id,
      description: descripcion,
      amount: monto,
      currency: moneda,
      exchange_rate: cotizacion,
      amount_ars: moneda === "ARS" ? monto : cotizacion ? monto * cotizacion : null,
      payment_date: fecha,
      payment_url: null,
      status: estado,
      payment_method: typeof raw.medio_pago === "string" ? raw.medio_pago : null,
      provider: typeof raw.proveedor === "string" ? raw.proveedor : null,
      provider_tax_id: typeof raw.cuit === "string" ? raw.cuit : null,
      receipt_type: tipo,
      receipt_number: typeof raw.nro_comprobante === "string" ? raw.nro_comprobante : null,
      notes: typeof raw.notas === "string" ? raw.notas : null,
    };

    const fields = [
      { label: "Descripción", value: descripcion },
      { label: "Monto", value: `${formatMoney(monto, moneda)}${cotizacion ? ` (cotización $${cotizacion} → ${formatMoney(monto * cotizacion, "ARS")})` : ""}` },
      { label: "Fecha", value: formatDate(fecha) },
      { label: "Estado", value: estado === "paid" ? "Pagado" : "Pendiente" },
      ...(categoria ? [{ label: "Categoría", value: categoria.name }] : []),
      ...(serviceName ? [{ label: "Servicio", value: serviceName }] : []),
      ...(input.provider ? [{ label: "Proveedor", value: input.provider }] : []),
      ...(tipo !== "sin_comprobante" ? [{ label: "Comprobante", value: `${RECEIPT_TYPE_LABELS[tipo]}${input.receipt_number ? ` ${input.receipt_number}` : ""}` }] : []),
    ];

    return { tool, title: "Registrar pago", fields, warnings, args: { input } };
  }

  if (tool === "crear_servicio") {
    const nombre = typeof raw.nombre === "string" ? raw.nombre.trim() : "";
    if (!nombre) return { error: "Falta el nombre del servicio." };
    const categoria = await resolveCategoria(raw.categoria, warnings);

    const input: ServiceInput = {
      name: nombre,
      description: typeof raw.descripcion === "string" ? raw.descripcion : null,
      url: typeof raw.url === "string" ? raw.url : null,
      category_id: categoria?.id ?? null,
      status: "active",
    };

    const fields = [
      { label: "Nombre", value: nombre },
      ...(categoria ? [{ label: "Categoría", value: categoria.name }] : []),
      ...(input.url ? [{ label: "URL", value: input.url }] : []),
      { label: "Para qué sirve", value: "Agrupa los pagos de este servicio; los gastos se cargan uno por uno" },
    ];

    return { tool, title: "Crear servicio", fields, warnings, args: { input } };
  }

  if (tool === "generar_rendicion") {
    const hasFilter = isMonth(raw.mes) || (typeof raw.texto === "string" && raw.texto.trim()) ||
      (Array.isArray(raw.pago_ids) && raw.pago_ids.length > 0);
    if (!hasFilter) return { error: "¿De qué mes o de qué proveedor querés la rendición?" };

    const { found, label, mes } = await resolveRendicionPayments(raw);
    if (found.length === 0) return { error: `No encontré pagos para la rendición (${label}).` };

    const MAX = 15;
    const fields = found.slice(0, MAX).map((p) => ({
      label: formatDate(p.payment_date),
      value: `${p.description || p.service?.name || p.provider || "Pago"} — ${formatMoney(Number(p.amount), p.currency)}${
        (p.receipts?.length ?? 0) > 0 ? " 📎" : ""
      }`,
    }));
    if (found.length > MAX) fields.push({ label: "…", value: `y ${found.length - MAX} pago(s) más` });

    const conRecibo = found.filter((p) => (p.receipts?.length ?? 0) > 0).length;
    const totalARS = found.reduce((a, p) => a + (toARS(Number(p.amount), p.currency, p.exchange_rate) ?? 0), 0);
    fields.push({ label: "Total ARS", value: formatMoney(totalARS, "ARS") });
    fields.push({ label: "Con recibo adjunto", value: `${conRecibo} de ${found.length} (se incrustan en el PDF)` });

    const yaRendidos = found.filter((p) => p.rendido_at).length;
    if (yaRendidos > 0) warnings.push(`${yaRendidos} de estos pagos ya estaban rendidos (se incluyen igual en el PDF).`);

    return {
      tool,
      title: `Generar rendición — ${label} (${found.length})`,
      fields,
      warnings,
      args: { ids: found.map((p) => p.id), label, mes },
    };
  }

  if (tool === "marcar_rendido") {
    const idsRaw = Array.isArray(raw.pago_ids) ? raw.pago_ids.filter((x): x is string => typeof x === "string") : [];
    const hasFilter = isMonth(raw.mes) || (typeof raw.texto === "string" && !!raw.texto.trim());

    let found: Payment[];
    let label = "hoy";
    let mes: string | null = null;

    if (idsRaw.length > 0) {
      // Camino por ids explícitos (de los DATOS)
      const all = await listPayments({});
      const pedidos = all.filter((p) => idsRaw.includes(p.id));
      // Solo se rinde lo efectivamente pagado. Si no se filtraran acá, la
      // tarjeta listaría pagos pendientes/fallidos que después executeAction
      // descarta, y el usuario confirmaría una lista que no es la que se marca.
      found = pedidos.filter((p) => p.status === "paid");
      if (found.length === 0) return { error: "No encontré pagos confirmados entre los indicados." };
      const noConfirmados = pedidos.length - found.length;
      if (noConfirmados > 0) {
        warnings.push(`${noConfirmados} no están en estado Pagado y quedan afuera de la rendición.`);
      }
      if (pedidos.length < idsRaw.length) {
        warnings.push(`${idsRaw.length - pedidos.length} de los pagos indicados no existen y se ignoran.`);
      }
      const yaRendidos = found.filter((p) => p.rendido_at);
      // setPaymentsRendido solo toca los que están pendientes, justamente para
      // no pisar la fecha real de la primera presentación al contador.
      if (yaRendidos.length > 0) {
        warnings.push(`${yaRendidos.length} ya estaban rendidos: conservan su fecha original y no se vuelven a marcar.`);
      }
    } else if (hasFilter) {
      // Camino por mes/nombre: solo los pendientes de rendir
      const r = await resolveRendicionPayments(raw);
      label = r.label;
      mes = r.mes;
      if (r.found.length === 0) return { error: `No encontré pagos (${r.label}) para rendir.` };
      const pend = r.found.filter((p) => !p.rendido_at);
      if (pend.length === 0) return { error: `Todos los pagos (${r.label}) ya están rendidos.` };
      if (r.found.length > pend.length) warnings.push(`${r.found.length - pend.length} ya estaban rendidos: se omiten.`);
      found = pend;
    } else {
      return { error: "¿Qué pagos marco como rendidos? Podés decirme el mes o el proveedor." };
    }

    const MAX = 15;
    const fields = found.slice(0, MAX).map((p) => ({
      label: formatDate(p.payment_date),
      value: `${p.description || p.service?.name || p.provider || "Pago"} — ${formatMoney(Number(p.amount), p.currency)}`,
    }));
    if (found.length > MAX) fields.push({ label: "…", value: `y ${found.length - MAX} pago(s) más` });

    return {
      tool,
      title: `Marcar como rendidos (${found.length} ${found.length === 1 ? "pago" : "pagos"})`,
      fields,
      warnings,
      args: { ids: found.map((p) => p.id), label, mes },
    };
  }

  return { error: `Herramienta desconocida: ${tool}` };
}

/**
 * Ids de pagos que llegan en los args de una acción ya confirmada.
 * Devuelve null si no vino ninguno.
 *
 * Es un guardarraíl, no una formalidad: resolveRendicionPayments interpreta
 * "sin ids" como "no filtres", así que un pedido a /api/chat/execute con args
 * vacíos terminaba marcando como rendidos TODOS los pagos de la base. El
 * endpoint recibe los args del cliente, así que acá no se puede confiar en que
 * buildProposal ya los completó.
 */
function idsExplicitos(args: Record<string, unknown>): string[] | null {
  const ids = Array.isArray(args.ids) ? args.ids.filter((x): x is string => typeof x === "string" && x !== "") : [];
  return ids.length > 0 ? ids : null;
}

// ---------- Ejecución (después de la confirmación del usuario) ----------
export async function executeAction(
  tool: string,
  args: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (tool === "crear_pago") {
    const input = args.input as PaymentInput;
    const r = await createPayment(input, [], userId);
    if (r.error || !r.id) return { ok: false, message: r.error ?? "No se pudo crear el pago." };
    return { ok: true, message: `Pago registrado: ${input.description} (${formatMoney(input.amount, input.currency)}).`, href: `/pagos/${r.id}` };
  }

  if (tool === "crear_servicio") {
    const input = args.input as ServiceInput;
    const r = await createService(input, userId);
    if (r.error || !r.id) return { ok: false, message: r.error ?? "No se pudo crear el servicio." };
    return { ok: true, message: `Servicio creado: ${input.name}.`, href: `/servicios/${r.id}` };
  }

  if (tool === "generar_rendicion") {
    const ids = idsExplicitos(args);
    if (!ids) return { ok: false, message: "No recibí qué pagos incluir en la rendición." };
    const { found } = await resolveRendicionPayments({ pago_ids: ids });
    if (found.length === 0) return { ok: false, message: "No encontré los pagos de la rendición." };

    const label = typeof args.label === "string" ? args.label : formatDate(today());
    const mes = typeof args.mes === "string" ? args.mes : null;
    const pdf = await buildRendicionPdf(found, label, mes);
    const conRecibo = found.filter((p) => (p.receipts?.length ?? 0) > 0).length;

    return {
      ok: true,
      message: `Rendición lista: ${found.length} ${found.length === 1 ? "pago" : "pagos"}${
        conRecibo > 0 ? `, ${conRecibo} con recibo incrustado` : ""
      }. Descargá el PDF acá abajo.`,
      href: "/rendicion",
      pdf,
    };
  }

  if (tool === "marcar_rendido") {
    const ids = idsExplicitos(args);
    if (!ids) return { ok: false, message: "No recibí qué pagos marcar como rendidos." };

    // Cierra un lote igual que la pantalla, no una marca suelta: si el chat
    // marcara pagos sin rendición, quedarían fuera del historial y sin
    // comprobante asociado, que es justo lo que este rediseño vino a arreglar.
    const user = await getCurrentUser();
    const r = await crearRendicion(
      { ids, titulo: null, notas: "Cerrada desde el asistente." },
      user?.id ?? null
    );
    if (r.error || r.payments.length === 0) {
      return { ok: false, message: r.error ?? "No se pudo cerrar la rendición." };
    }

    const label = typeof args.label === "string" ? args.label : formatDate(today());
    const mes = typeof args.mes === "string" ? args.mes : null;
    const pdf = await buildRendicionPdf(r.payments, label, mes, r.rendicion);

    const nro = r.rendicion ? ` N° ${r.rendicion.numero}` : "";
    const afuera = r.descartados > 0 ? ` ${r.descartados} quedaron afuera (ya rendidos o sin confirmar).` : "";
    return {
      ok: true,
      message: `Rendición${nro} cerrada con ${r.payments.length} ${
        r.payments.length === 1 ? "pago" : "pagos"
      }. Descargá el comprobante acá abajo.${afuera}`,
      href: r.rendicion ? `/rendicion/${r.rendicion.id}` : "/rendicion",
      pdf,
    };
  }

  return { ok: false, message: `Herramienta desconocida: ${tool}` };
}
