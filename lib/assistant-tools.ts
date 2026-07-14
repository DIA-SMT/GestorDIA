// Herramientas operativas del asistente virtual.
// Flujo en dos pasos: el modelo propone una acción (buildProposal arma la
// tarjeta de confirmación con los datos resueltos) y recién cuando el
// usuario confirma en el chat se ejecuta (executeAction).

import type { BillingCycle, CurrencyCode, PaymentStatus, ReceiptType } from "./types";
import { BILLING_CYCLE_LABELS, RECEIPT_TYPE_LABELS } from "./types";
import {
  listCategories,
  listServicesSimple,
  listPayments,
  createPayment,
  createService,
  setPaymentsRendido,
  setServiceRenewal,
  type PaymentInput,
  type ServiceInput,
} from "./data";
import { formatMoney, formatDate, toARS, nextCycleDate, upcomingRenewal } from "./utils";
import type { RendicionPdfRow } from "./rendicion-pdf";

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
        "Crea un servicio/suscripción nuevo (ej: un hosting, una herramienta con cobro mensual). Usala cuando el usuario pida crear o dar de alta un servicio.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          descripcion: { type: "string" },
          url: { type: "string", description: "URL de gestión/facturación (opcional)" },
          categoria: { type: "string", description: "Nombre de una categoría existente (opcional)" },
          ciclo: {
            type: "string",
            enum: ["monthly", "yearly", "quarterly", "weekly", "one_time", "on_demand"],
            description: "Ciclo de facturación",
          },
          monto_estimado: { type: "number", description: "Monto esperado por ciclo (opcional)" },
          moneda: { type: "string", enum: ["ARS", "USD", "EUR"] },
          modo_pago: {
            type: "string",
            enum: ["automatic", "manual"],
            description: "automatic = se debita solo; manual = hay que pagarlo (genera alertas)",
          },
          proxima_renovacion: { type: "string", description: "Próxima fecha de cobro YYYY-MM-DD (opcional)" },
        },
        required: ["nombre", "ciclo", "moneda"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pagar_servicio",
      description:
        "Registra el pago de un servicio existente (típicamente uno de pago manual que el usuario acaba de pagar) y adelanta su próxima fecha de cobro un ciclo. Usala cuando el usuario diga que ya pagó un servicio o toque 'Ya lo pagué'. El monto por defecto es el estimado del servicio; si el usuario aclara otro monto, usá ese.",
      parameters: {
        type: "object",
        properties: {
          servicio: { type: "string", description: "Nombre del servicio que se pagó" },
          monto: { type: "number", description: "Monto real pagado (si no se aclara, se usa el estimado del servicio)" },
          fecha: { type: "string", description: "Fecha del pago YYYY-MM-DD (default hoy)" },
        },
        required: ["servicio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "marcar_rendido",
      description:
        "Marca uno o más pagos como rendidos al contador. Usá los ids de los pagos que figuran en los DATOS. Después de ejecutarse, el usuario puede descargar el PDF de la rendición desde el chat.",
      parameters: {
        type: "object",
        properties: {
          pago_ids: { type: "array", items: { type: "string" }, description: "Ids de los pagos a rendir" },
        },
        required: ["pago_ids"],
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
  pdf?: { rows: RendicionPdfRow[]; totalARS: number; totalUSD: number; filename: string; title: string };
}

const CURRENCIES: CurrencyCode[] = ["ARS", "USD", "EUR"];
const CYCLES: BillingCycle[] = ["monthly", "yearly", "quarterly", "weekly", "one_time", "on_demand", "custom"];
const RECEIPT_TYPES = Object.keys(RECEIPT_TYPE_LABELS) as ReceiptType[];

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = () => new Date().toISOString().slice(0, 10);

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
    const ciclo = CYCLES.includes(raw.ciclo as BillingCycle) ? (raw.ciclo as BillingCycle) : "monthly";
    const moneda = CURRENCIES.includes(raw.moneda as CurrencyCode) ? (raw.moneda as CurrencyCode) : "ARS";
    const modo = raw.modo_pago === "manual" ? "manual" : "automatic";
    const monto = Number(raw.monto_estimado) > 0 ? Number(raw.monto_estimado) : null;
    const renovacion = isDate(raw.proxima_renovacion) ? raw.proxima_renovacion : null;
    if (!renovacion && ciclo !== "on_demand" && ciclo !== "one_time") {
      warnings.push("Sin fecha de próxima renovación no va a aparecer en las alertas de vencimiento.");
    }
    const categoria = await resolveCategoria(raw.categoria, warnings);
    const category_id = categoria?.id ?? null;

    const input: ServiceInput = {
      name: nombre,
      description: typeof raw.descripcion === "string" ? raw.descripcion : null,
      url: typeof raw.url === "string" ? raw.url : null,
      category_id,
      billing_cycle: ciclo,
      expected_amount: monto,
      currency: moneda,
      status: "active",
      payment_mode: modo,
      next_renewal_date: renovacion,
    };

    const fields = [
      { label: "Nombre", value: nombre },
      ...(categoria ? [{ label: "Categoría", value: categoria.name }] : []),
      { label: "Ciclo", value: BILLING_CYCLE_LABELS[ciclo] },
      ...(monto != null ? [{ label: "Monto estimado", value: `${formatMoney(monto, moneda)} por ciclo` }] : []),
      { label: "Modo de pago", value: modo === "manual" ? "Manual (genera alertas)" : "Débito automático" },
      ...(renovacion ? [{ label: "Próxima renovación", value: formatDate(renovacion) }] : []),
    ];

    return { tool, title: "Crear servicio", fields, warnings, args: { input } };
  }

  if (tool === "pagar_servicio") {
    const nombre = typeof raw.servicio === "string" ? raw.servicio.trim() : "";
    if (!nombre) return { error: "¿Qué servicio pagaste?" };
    const services = await listServicesSimple();
    const q = nombre.toLowerCase();
    const srv = services.find((s) => s.name.toLowerCase() === q) ?? services.find((s) => s.name.toLowerCase().includes(q));
    if (!srv) return { error: `No encontré un servicio que se llame "${nombre}".` };

    const monto = Number(raw.monto) > 0 ? Number(raw.monto) : srv.expected_amount ?? null;
    if (monto == null || monto <= 0) {
      return { error: `El servicio "${srv.name}" no tiene monto estimado. ¿Cuánto pagaste?` };
    }
    const fecha = isDate(raw.fecha) ? raw.fecha : today();

    // Próxima renovación: un ciclo después de la fecha guardada, adelantada a hoy-o-futuro
    const afterOne = nextCycleDate(srv.next_renewal_date, srv.billing_cycle);
    const nextRenewal = afterOne ? upcomingRenewal(afterOne, srv.billing_cycle) : srv.next_renewal_date;

    const input: PaymentInput = {
      service_id: srv.id,
      category_id: srv.category_id,
      description: `${srv.name} — ${BILLING_CYCLE_LABELS[srv.billing_cycle]}`,
      amount: monto,
      currency: srv.currency,
      exchange_rate: null,
      amount_ars: srv.currency === "ARS" ? monto : null,
      payment_date: fecha,
      payment_url: null,
      status: "paid",
      payment_method: null,
      provider: null,
      provider_tax_id: null,
      receipt_type: "sin_comprobante",
      receipt_number: null,
      notes: null,
    };

    if (srv.currency !== "ARS") {
      warnings.push("Sin cotización no suma en los totales en ARS (podés editar el pago para cargarla).");
    }

    const fields = [
      { label: "Servicio", value: srv.name },
      { label: "Monto", value: formatMoney(monto, srv.currency) },
      { label: "Fecha", value: formatDate(fecha) },
      ...(nextRenewal && nextRenewal !== srv.next_renewal_date
        ? [{ label: "Próxima renovación", value: formatDate(nextRenewal) }]
        : []),
    ];

    return {
      tool,
      title: "Registrar pago del servicio",
      fields,
      warnings,
      args: { input, serviceId: srv.id, nextRenewal },
    };
  }

  if (tool === "marcar_rendido") {
    const ids = Array.isArray(raw.pago_ids) ? raw.pago_ids.filter((x): x is string => typeof x === "string") : [];
    if (ids.length === 0) return { error: "No se indicó ningún pago para rendir." };

    const all = await listPayments({});
    const found = all.filter((p) => ids.includes(p.id));
    if (found.length === 0) return { error: "No encontré los pagos indicados." };
    if (found.length < ids.length) warnings.push(`${ids.length - found.length} de los pagos indicados no existen y se ignoran.`);
    const yaRendidos = found.filter((p) => p.rendido_at);
    if (yaRendidos.length > 0) warnings.push(`${yaRendidos.length} ya estaban rendidos: se vuelven a marcar con la fecha de hoy.`);

    const fields = found.map((p) => ({
      label: formatDate(p.payment_date),
      value: `${p.description || p.service?.name || p.provider || "Pago"} — ${formatMoney(Number(p.amount), p.currency)}`,
    }));

    return {
      tool,
      title: `Marcar como rendidos (${found.length} ${found.length === 1 ? "pago" : "pagos"})`,
      fields,
      warnings,
      args: { ids: found.map((p) => p.id) },
    };
  }

  return { error: `Herramienta desconocida: ${tool}` };
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

  if (tool === "pagar_servicio") {
    const input = args.input as PaymentInput;
    const serviceId = args.serviceId as string;
    const nextRenewal = (args.nextRenewal as string | null) ?? null;
    const r = await createPayment(input, [], userId);
    if (r.error || !r.id) return { ok: false, message: r.error ?? "No se pudo registrar el pago." };
    if (nextRenewal) await setServiceRenewal(serviceId, nextRenewal);
    return {
      ok: true,
      message: `Pago registrado: ${input.description} (${formatMoney(input.amount, input.currency)})${
        nextRenewal ? `. Próxima renovación: ${formatDate(nextRenewal)}.` : "."
      }`,
      href: `/servicios/${serviceId}`,
    };
  }

  if (tool === "marcar_rendido") {
    const ids = (args.ids as string[]) ?? [];
    const all = await listPayments({});
    const found = all.filter((p) => ids.includes(p.id));
    if (found.length === 0) return { ok: false, message: "No encontré los pagos a rendir." };

    const r = await setPaymentsRendido(found.map((p) => p.id), true);
    if (r.error) return { ok: false, message: r.error };

    const rows: RendicionPdfRow[] = found.map((p) => ({
      fecha: formatDate(p.payment_date),
      proveedor: p.provider ?? "",
      cuit: p.provider_tax_id ?? "",
      descripcion: p.description ?? p.service?.name ?? "",
      comprobante: RECEIPT_TYPE_LABELS[p.receipt_type],
      nro: p.receipt_number ?? "",
      moneda: p.currency,
      monto: Number(p.amount),
      ars: toARS(Number(p.amount), p.currency, p.exchange_rate),
      recibo: (p.receipts?.length ?? 0) > 0,
    }));
    const totalARS = rows.reduce((a, r2) => a + (r2.ars ?? 0), 0);
    const totalUSD = found.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount), 0);

    return {
      ok: true,
      message: `${found.length} ${found.length === 1 ? "pago marcado" : "pagos marcados"} como rendidos.`,
      href: "/rendicion",
      pdf: {
        rows,
        totalARS,
        totalUSD,
        filename: `rendicion-${today()}.pdf`,
        title: `Rendición de cuentas — ${formatDate(today())}`,
      },
    };
  }

  return { ok: false, message: `Herramienta desconocida: ${tool}` };
}
