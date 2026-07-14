// Asistente virtual: responde preguntas sobre los datos de gestorDIA y
// propone acciones (crear pago/servicio, marcar rendidos) vía tool calling.
// Las acciones NO se ejecutan acá: se devuelve una propuesta que el chat
// muestra como tarjeta de confirmación; /api/chat/execute las ejecuta.

import { getCurrentUser, listPayments, listServices, listCategories } from "@/lib/data";
import { toARS, daysUntil, effectiveRenewal } from "@/lib/utils";
import { BILLING_CYCLE_LABELS, RECEIPT_TYPE_LABELS, PAYMENT_STATUS_LABELS, SERVICE_STATUS_LABELS } from "@/lib/types";
import { TOOL_DEFS, buildProposal } from "@/lib/assistant-tools";

export const maxDuration = 60;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const MAX_PAYMENTS = 400; // tope de pagos en el contexto (los más recientes)
const MAX_MESSAGES = 20; // tope de historial de conversación

// Guía de uso de la app: le permite al asistente ayudar con "cómo hago X"
// y con problemas comunes, además de responder sobre los datos.
const APP_GUIDE = `
GUÍA DE LA APP (usala para ayudar al usuario a usar gestorDIA):
- Dashboard (/): KPIs del mes. Cada tarjeta se clickea y abre el detalle de qué compone el número. Abajo: alertas de pagos manuales por vencer, próximos débitos automáticos y últimos pagos.
- Pagos (/pagos): lista de todos los pagos con filtros. Botón "+ Registrar pago" (/pagos/nuevo): formulario con servicio (opcional), categoría, descripción, monto y moneda, cotización (si es USD: cargarla hace que el pago sume en los totales en ARS), fecha, estado, medio de pago, y datos para rendición: proveedor, CUIT, tipo de comprobante, número. Se pueden adjuntar comprobantes (imagen o PDF).
- Detalle de pago (/pagos/[id]): vista tipo ticket. Botón "Editar" para modificar cualquier campo (ahí se corrige una cotización faltante), adjuntar o borrar recibos, y eliminar el pago.
- Servicios (/servicios): tarjetas por servicio con el gasto real acumulado (suma de pagos hechos) y el monto estimado por ciclo. "+ Nuevo servicio" (/servicios/nuevo): nombre, categoría, ciclo de facturación (mensual, anual, único, recarga a demanda, etc.), monto estimado, modo de pago (débito automático = se cobra solo e informa; manual = genera alerta para pagarlo), próxima renovación.
- Detalle de servicio (/servicios/[id]): historial de pagos de ese servicio con total, y edición del servicio.
- Rendición (/rendicion): elegir el mes arriba. Buscador por nombre/proveedor/monto y filtro por categoría. Se seleccionan pagos con los checkboxes (o "seleccionar todos"), se exportan con los botones CSV o PDF (exportan la selección, o todos los pendientes filtrados si no hay selección) y se marcan con "✓ Marcar como rendidos". Los rendidos pasan a la lista de abajo con fecha y botón "↩ Deshacer". El PDF sale con membrete y totales, listo para el contador.
- Categorías (/categorias): crear categorías con nombre y color, editarlas o borrarlas.

PROBLEMAS COMUNES:
- "El gasto del mes en ARS da $0 o menos de lo esperado": hay pagos en USD sin cotización cargada; no se pueden convertir. Solución: entrar al pago → Editar → completar "Cotización".
- "No encuentro un pago en rendición": verificar que el mes elegido sea el correcto (usa la fecha de pago) y que no esté ya abajo en la lista de Rendidos.
- "Quiero deshacer una rendición": en /rendicion, sección Rendidos, botón "↩ Deshacer" en la fila.
- "Un servicio aparece vencido": editar el servicio y actualizar la fecha de próxima renovación después de pagarlo (registrar el pago no la actualiza sola).
`;

const TOOLS_GUIDE = `
ACCIONES QUE PODÉS EJECUTAR (herramientas):
- crear_pago: registrar un gasto/pago suelto nuevo.
- crear_servicio: dar de alta un servicio/suscripción.
- pagar_servicio: cuando el usuario diga que YA PAGÓ un servicio existente (o toque "Ya lo pagué"), registra el pago de ese servicio y adelanta su próxima fecha de cobro un ciclo. Pasá el nombre del servicio; el monto por defecto es el estimado, salvo que el usuario aclare otro.
- marcar_rendido: marcar pagos como rendidos al contador (usá los "id" de los pagos que figuran en los DATOS). Después el usuario puede descargar el PDF de esa rendición desde el chat.
Cuando el usuario pida una de estas cosas, llamá a la herramienta directamente con los datos que dio: la app le muestra una tarjeta de confirmación con todo lo interpretado ANTES de ejecutar, así que no pidas confirmación por texto. Solo preguntá si falta un dato obligatorio (ej: el monto) o si no queda claro a qué pago se refiere.
Lo que todavía NO podés hacer: editar o borrar pagos/servicios, adjuntar archivos, deshacer rendiciones. Para eso indicá cómo hacerlo en las pantallas.
`;

const PAGE_LABELS: [RegExp, string][] = [
  [/^\/$/, "Dashboard"],
  [/^\/pagos\/nuevo/, "Registrar pago (formulario)"],
  [/^\/pagos\/[^/]+/, "Detalle de un pago"],
  [/^\/pagos/, "Lista de pagos"],
  [/^\/servicios\/nuevo/, "Nuevo servicio (formulario)"],
  [/^\/servicios\/[^/]+/, "Detalle de un servicio"],
  [/^\/servicios/, "Lista de servicios"],
  [/^\/rendicion/, "Rendición de cuentas"],
  [/^\/categorias/, "Categorías"],
];

async function buildSystemPrompt(path: string | null): Promise<string> {
  const [payments, services, categories] = await Promise.all([
    listPayments({}),
    listServices(),
    listCategories(),
  ]);

  const pagos = payments.slice(0, MAX_PAYMENTS).map((p) => ({
    id: p.id,
    fecha: p.payment_date,
    descripcion: p.description ?? null,
    servicio: p.service?.name ?? null,
    proveedor: p.provider ?? null,
    monto: Number(p.amount),
    moneda: p.currency,
    cotizacion: p.exchange_rate ?? null,
    equivalente_ars: toARS(Number(p.amount), p.currency, p.exchange_rate),
    estado: PAYMENT_STATUS_LABELS[p.status],
    categoria: p.category?.name ?? null,
    comprobante: RECEIPT_TYPE_LABELS[p.receipt_type],
    nro_comprobante: p.receipt_number ?? null,
    tiene_recibo_adjunto: (p.receipts?.length ?? 0) > 0,
    rendido_el: p.rendido_at ? p.rendido_at.slice(0, 10) : null,
  }));

  const servicios = services.map((s) => ({
    nombre: s.name,
    categoria: s.category?.name ?? null,
    ciclo: BILLING_CYCLE_LABELS[s.billing_cycle],
    monto_estimado: s.expected_amount,
    moneda: s.currency,
    estado: SERVICE_STATUS_LABELS[s.status],
    modo_pago: s.payment_mode === "manual" ? "manual (hay que pagarlo)" : "débito automático",
    proxima_renovacion: effectiveRenewal(s.next_renewal_date, s.billing_cycle, s.payment_mode),
  }));

  const hoy = new Date().toISOString().slice(0, 10);
  const pageLabel = path ? PAGE_LABELS.find(([re]) => re.test(path))?.[1] ?? null : null;

  // Alertas activas: próximos cobros (≤30 días). Automáticos usan el próximo
  // débito futuro (el anterior ya se cobró); manuales incluyen vencidos.
  const alertas = services
    .filter((s) => s.status === "active" && s.next_renewal_date)
    .map((s) => {
      const fecha = effectiveRenewal(s.next_renewal_date, s.billing_cycle, s.payment_mode)!;
      return { s, fecha, d: daysUntil(fecha)!, auto: s.payment_mode !== "manual" };
    })
    .filter(({ d, auto }) => (auto ? d >= 0 && d <= 30 : d <= 30))
    .sort((a, b) => a.d - b.d)
    .map(({ s, fecha, d, auto }) => ({
      servicio: s.name,
      fecha,
      situacion: d < 0 ? `vencido hace ${-d} días` : d === 0 ? (auto ? "se debita hoy" : "vence hoy") : auto ? `se debita en ${d} días` : `vence en ${d} días`,
      monto_estimado: s.expected_amount,
      moneda: s.currency,
      modo: auto ? "débito automático" : "manual (hay que pagarlo)",
    }));

  return [
    "Sos el asistente virtual de gestorDIA, la app de gestión de pagos, suscripciones y rendición de cuentas de la Dirección de Inteligencia Artificial de la Municipalidad de San Miguel de Tucumán.",
    `Hoy es ${hoy}.`,
    "Respondé siempre en español argentino, breve y concreto. Texto plano: sin markdown, sin asteriscos, sin tablas. Podés usar guiones para enumerar.",
    "Tenés tres funciones: (1) responder preguntas sobre los DATOS cargados, (2) ayudar a usar la app con la GUÍA, y (3) ejecutar ACCIONES con las herramientas. Si la respuesta no surge de los datos o la guía, decilo claramente en lugar de inventar.",
    "Cuando des montos aclarás siempre la moneda. Si te piden totales, calculalos con cuidado sumando los pagos que correspondan.",
    'Sobre rendición: "rendido_el" con fecha significa que ese pago ya se presentó al contador; null significa pendiente de rendir.',
    "Los pagos con cotización null no tienen equivalente en ARS (conviene sugerir cargarla si preguntan por totales en pesos).",
    APP_GUIDE,
    TOOLS_GUIDE,
    pageLabel
      ? `PÁGINA ACTUAL: el usuario está ahora mismo en "${pageLabel}" (${path}). Si pide ayuda sin dar contexto, asumí que es sobre esta pantalla.`
      : "",
    "",
    `DATOS (JSON):`,
    alertas.length > 0
      ? `ALERTAS ACTIVAS (próximos cobros en ≤30 días o vencidos — priorizá esto si preguntan qué hay pendiente o por vencer): ${JSON.stringify(alertas)}`
      : "ALERTAS ACTIVAS: ninguna por ahora.",
    `Categorías: ${JSON.stringify(categories.map((c) => c.name))}`,
    `Servicios: ${JSON.stringify(servicios)}`,
    `Pagos (${pagos.length} más recientes): ${JSON.stringify(pagos)}`,
  ].join("\n");
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Falta configurar OPENROUTER_API_KEY en .env.local (y en Vercel para producción)." },
      { status: 500 }
    );
  }

  let messages: ChatMessage[];
  let path: string | null = null;
  try {
    const body = await req.json();
    messages = (body.messages as ChatMessage[])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_MESSAGES);
    if (messages.length === 0) throw new Error("empty");
    if (typeof body.path === "string") path = body.path.slice(0, 120);
  } catch {
    return Response.json({ error: "Mensajes inválidos." }, { status: 400 });
  }

  const system = await buildSystemPrompt(path);

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "gestorDIA",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      tools: TOOL_DEFS,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("OpenRouter error:", upstream.status, detail);
    return Response.json(
      { error: `El modelo no respondió (HTTP ${upstream.status}). Revisá la API key y que el modelo soporte herramientas.` },
      { status: 502 }
    );
  }

  const data = await upstream.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) {
    return Response.json({ error: "Respuesta vacía del modelo." }, { status: 502 });
  }

  const toolCall = msg.tool_calls?.[0];
  if (toolCall?.function?.name) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      return Response.json({ type: "text", text: "No pude interpretar los datos de la acción. ¿Me los repetís?" });
    }
    const proposal = await buildProposal(toolCall.function.name, args);
    if ("error" in proposal) {
      return Response.json({ type: "text", text: proposal.error + " ¿Me pasás el dato que falta?" });
    }
    return Response.json({ type: "action", text: typeof msg.content === "string" && msg.content.trim() ? msg.content : null, action: proposal });
  }

  return Response.json({ type: "text", text: typeof msg.content === "string" ? msg.content : "" });
}
