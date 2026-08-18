// Asistente virtual: responde preguntas sobre los datos de gestorDIA y
// propone acciones (crear pago/servicio, marcar rendidos) vía tool calling.
// Las acciones NO se ejecutan acá: se devuelve una propuesta que el chat
// muestra como tarjeta de confirmación; /api/chat/execute las ejecuta.

import { getCurrentUser, listPayments, listServices, listCategories, listPendientesDeRendir } from "@/lib/data";
import { toARS, todayISO, monthOf, shiftMonth } from "@/lib/utils";
import { gastosSinCargarEsteMes, desdeCuando, VENTANA_MESES } from "@/lib/gastos-habituales";
import { RECEIPT_TYPE_LABELS, PAYMENT_STATUS_LABELS, SERVICE_STATUS_LABELS } from "@/lib/types";
import { TOOL_DEFS, buildProposal } from "@/lib/assistant-tools";
import { faltantesDe } from "@/lib/rendicion-status";

export const maxDuration = 60;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const MAX_PAYMENTS = 400; // tope de pagos en el contexto (los más recientes)
const MAX_MESSAGES = 20; // tope de historial de conversación

// Guía de uso de la app: le permite al asistente ayudar con "cómo hago X"
// y con problemas comunes, además de responder sobre los datos.
const APP_GUIDE = `
GUÍA DE LA APP (usala para ayudar al usuario a usar gestorDIA):
- Dashboard (/): KPIs del mes (gasto en ARS y USD, pendiente de rendir, sin factura cargada, servicios activos). Cada tarjeta se clickea y abre el detalle de qué compone el número. Abajo: "Venís pagando esto y este mes todavía no lo cargaste" —mira los últimos 4 meses, no solo el anterior, así un mes salteado o un gasto bimestral no desaparece— con el monto de la última vez, un badge "N de los últimos 4 meses" en los habituales, un aviso ámbar en los que hace 2+ meses que no se cargan, y un botón "↻ Repetir" por gasto. Después, los últimos pagos.
- Pagos (/pagos): lista de todos los pagos con filtros. Botón "+ Registrar pago" (/pagos/nuevo): formulario con servicio (opcional), categoría, descripción, monto y moneda, cotización (si es USD: cargarla hace que el pago sume en los totales en ARS), fecha, estado, medio de pago, y datos para rendición: proveedor, CUIT, tipo de comprobante, número. Se pueden adjuntar comprobantes (imagen o PDF). Cada fila tiene un "↻" que repite ese gasto.
- Detalle de pago (/pagos/[id]): vista tipo ticket. Botón "Editar" para modificar cualquier campo (ahí se corrige una cotización faltante), adjuntar o borrar recibos, eliminar el pago, y "↻ Repetir este gasto".
- Repetir un gasto (/pagos/nuevo?repetir=[id]): abre el formulario de pago nuevo precargado con los datos del pago original (servicio, categoría, descripción, monto, moneda, cotización, proveedor, CUIT, tipo de comprobante, medio de pago), con la fecha en HOY y el N° de comprobante vacío, porque cambia en cada factura. Es la forma de cargar un gasto que se repite todos los meses: se ajusta el monto y se guarda.
- Servicios (/servicios): un servicio AGRUPA pagos (Cursor Pro, Vercel…). Sirve para ver el historial y el total gastado en cada uno. No tiene ciclo de facturación, ni monto esperado, ni fecha de renovación, y no genera gastos solo: eso se sacó a propósito porque el monto real cambia todos los meses. "+ Nuevo servicio" (/servicios/nuevo): nombre, categoría, URL, estado y notas.
- Detalle de servicio (/servicios/[id]): historial de pagos de ese servicio con total (cada uno con su "↻" para repetirlo), y edición del servicio.
- Rendición (/rendicion): acá se ARMA la próxima entrega al contador. Muestra TODO lo que falta rendir, de cualquier período (no de un mes: el filtro "Período" es opcional), agrupado por mes con subtotales. Cada fila avisa qué le falta para que el contador la acepte (proveedor, CUIT, tipo de comprobante, N°, archivo adjunto, cotización) con chips rojos (bloqueantes) o amarillos (menores), y el lápiz ✎ de la derecha abre un editor rápido para cargar esos datos sin salir de la lista (el archivo se adjunta desde la ficha del pago). Filtros: búsqueda, período, categoría y "Estado de la factura" (solo los listos / solo los que falta completar). Se seleccionan pagos con los checkboxes; si no se selecciona nada, se toman todos los visibles. La barra de abajo queda fija con el total y los botones: "🖨 Rendir y generar comprobante" (cierra un LOTE numerado, baja el PDF con las facturas incrustadas y archiva una copia; si hay pagos sin factura pide confirmar una vez), "👁 Vista previa" (no cierra nada) y "⬇ CSV". Los KPIs de arriba muestran el total pendiente, cuántos están listos y cuántos son "arrastres" (de meses anteriores). Solo se rinden los pagos en estado Pagado.
- Presentadas (/rendicion/historial): el historial de rendiciones entregadas, cada una con su número, la fecha en que se presentó, el rango de gastos que cubre, el total congelado y si tiene el PDF archivado.
- Detalle de una rendición (/rendicion/[id]): qué se entregó exactamente. "📄 Descargar el comprobante entregado" baja el PDF archivado tal cual se imprimió; "↻ Reimprimir con los datos de hoy" lo regenera (puede salir distinto si después se corrigió algo). También: editar título y notas, "↩ Sacar" un pago que el contador rebotó (vuelve a pendientes y se recalculan los totales) y "↩ Reabrir" la rendición entera (la borra y devuelve todos sus pagos a la cola).
- Categorías (/categorias): crear categorías con nombre y color, editarlas o borrarlas.

PROBLEMAS COMUNES:
- "El gasto del mes en ARS da $0 o menos de lo esperado": hay pagos en USD sin cotización cargada; no se pueden convertir. Solución: entrar al pago → Editar → completar "Cotización".
- "No encuentro un pago en rendición": /rendicion muestra todo lo pendiente sin filtrar por mes, así que si no está es porque ya se rindió (buscalo en /rendicion/historial) o porque no está en estado Pagado.
- "Quiero deshacer una rendición": entrá a /rendicion/historial, abrí la rendición y usá "↩ Reabrir" (vuelve todo a pendientes y borra el lote). Si es un solo pago el que quedó mal, "↩ Sacar" en su fila.
- "Cerré una rendición sin querer": misma vía, "↩ Reabrir" en la ficha de esa rendición. Para mirar el PDF sin cerrar nada, la próxima vez usá "👁 Vista previa".
- "El contador me pidió las facturas": entrá a /rendicion y cargá los datos con el lápiz ✎ de cada fila (proveedor, CUIT, tipo y N° de comprobante). Para adjuntar el archivo de la factura hay que abrir el pago. Filtrá por "Solo los que falta completar" para verlos juntos.
- "Me llegó la factura de un gasto viejo": no hace falta buscar el mes, sigue apareciendo en /rendicion mientras no se haya rendido — el KPI "Arrastres" cuenta esos casos.
- "Falta un gasto mensual": los gastos no se generan solos, se cargan cuando se pagan. El dashboard lista lo que se viene pagando y este mes todavía no se cargó, con un botón "↻ Repetir" para cargarlo en dos clics.
- "Se me pasó cargar un mes": no se pierde. La lista del dashboard mira los últimos 4 meses, así que el gasto sigue apareciendo con un aviso de hace cuánto que no se carga. Al repetirlo, corregí la fecha si el pago fue de un mes anterior, para que caiga en la rendición del período que corresponde.
- "Se cobró distinto a la vez anterior": es lo normal y por eso se carga a mano. "↻ Repetir" trae todos los datos y solo hay que corregir el monto.
- "¿Y las suscripciones automáticas?": se registran igual que cualquier otro pago, cuando aparecen en el resumen de la tarjeta. El servicio solo agrupa el historial.
`;

const TOOLS_GUIDE = `
ACCIONES QUE PODÉS EJECUTAR (herramientas):
- crear_pago: registrar un gasto/pago suelto nuevo.
- crear_servicio: dar de alta un servicio (solo agrupa pagos: nombre, categoría, URL y notas).
- Para "ya pagué X" o "repetí el gasto de X" usá crear_pago. Si X aparece en SE VIENE PAGANDO Y ESTE MES TODAVÍA NO SE CARGÓ, tomá de ahí la descripción, el proveedor y la moneda, pero PREGUNTÁ EL MONTO en vez de reusar el de la última vez: cambia casi siempre y por eso se carga a mano. Si el usuario ya dijo el monto, usá ese y no preguntes nada.
- generar_rendicion: cuando el usuario pida "hacé/generá/dame la rendición" o "el PDF de la rendición" de un mes o de un proveedor/nombre, SIN hablar de marcar. Pasá "mes" (formato YYYY-MM; convertí "julio 2026" a "2026-07") y/o "texto" (nombre o proveedor). Genera el PDF (con los recibos adjuntos incrustados) para descargar; NO marca nada como rendido.
- marcar_rendido: cuando el usuario diga "marcá como rendidos", "dá por rendidos" o "rendí" (confirmar la presentación al contador). Podés indicar los pagos por sus "id" (de los DATOS) o por "mes"/"texto" igual que generar_rendicion. CIERRA UNA RENDICIÓN: crea un lote numerado con esos pagos, igual que el botón de la pantalla, y devuelve su comprobante en PDF para descargar. Queda en /rendicion/historial y se puede reabrir desde ahí.
Distinguí bien: pedir/descargar el PDF => generar_rendicion; confirmar que se presentaron (marcarlos) => marcar_rendido. Si el usuario primero pide el PDF y después dice "ahora marcalos"/"dalos por rendidos", usá el mismo mes/texto.
Cuando el usuario pida una de estas cosas, llamá a la herramienta directamente con los datos que dio: la app le muestra una tarjeta de confirmación con todo lo interpretado ANTES de ejecutar, así que no pidas confirmación por texto. Solo preguntá si falta un dato obligatorio (ej: el monto) o si no queda claro a qué pago o período se refiere.
Lo que todavía NO podés hacer: editar o borrar pagos/servicios, cargar datos de facturación, adjuntar archivos, reabrir rendiciones. Para eso indicá cómo hacerlo en las pantallas.
`;

const PAGE_LABELS: [RegExp, string][] = [
  [/^\/$/, "Dashboard"],
  [/^\/pagos\/nuevo/, "Registrar pago (formulario)"],
  [/^\/pagos\/[^/]+/, "Detalle de un pago"],
  [/^\/pagos/, "Lista de pagos"],
  [/^\/servicios\/nuevo/, "Nuevo servicio (formulario)"],
  [/^\/servicios\/[^/]+/, "Detalle de un servicio"],
  [/^\/servicios/, "Lista de servicios"],
  [/^\/rendicion\/historial/, "Historial de rendiciones presentadas"],
  [/^\/rendicion\/[^/]+/, "Detalle de una rendición presentada"],
  [/^\/rendicion/, "Rendición de cuentas (armado)"],
  [/^\/categorias/, "Categorías"],
];

async function buildSystemPrompt(path: string | null): Promise<string> {
  const [payments, services, categories, pendientesDeRendir] = await Promise.all([
    listPayments({}),
    listServices(),
    listCategories(),
    listPendientesDeRendir(),
  ]);

  const hoy = todayISO();

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
    estado: SERVICE_STATUS_LABELS[s.status],
    notas: s.description ?? null,
  }));

  const pageLabel = path ? PAGE_LABELS.find(([re]) => re.test(path))?.[1] ?? null : null;

  // Lo que falta rendir, de cualquier período: es la pregunta más frecuente
  // ("¿qué falta rendir?") y no se puede deducir de la lista de pagos sin
  // cruzar rendido_el con el estado.
  const porRendir = pendientesDeRendir
    .filter((p) => p.status === "paid")
    .map((p) => ({
      id: p.id,
      fecha: p.payment_date,
      descripcion: p.description ?? p.service?.name ?? null,
      proveedor: p.provider ?? null,
      monto: Number(p.amount),
      moneda: p.currency,
      equivalente_ars: toARS(Number(p.amount), p.currency, p.exchange_rate),
      le_falta: faltantesDe(p).map((f) => f.label),
    }));

  // Lo que se viene pagando y este mes todavía no se cargó. Reemplaza a los
  // cargos por confirmar, y usa el MISMO módulo que el dashboard para que el
  // chat no diga una cosa y la pantalla otra.
  const mesActual = monthOf(hoy);
  const desdeVentana = `${shiftMonth(mesActual, -VENTANA_MESES)}-01`;
  const sinRepetir = gastosSinCargarEsteMes({
    historial: payments.filter((p) => p.payment_date >= desdeVentana && monthOf(p.payment_date) < mesActual),
    delMesActual: payments.filter((p) => monthOf(p.payment_date) === mesActual),
    mesActual,
    serviciosCancelados: new Set(services.filter((s) => s.status === "cancelled").map((s) => s.id)),
  }).map((g) => ({
    id: g.pago.id,
    descripcion: g.pago.description ?? g.pago.service?.name ?? null,
    proveedor: g.pago.provider ?? null,
    ultima_vez: g.ultimaFecha,
    monto_de_esa_vez: g.ultimoMonto,
    moneda: g.pago.currency,
    meses_en_que_aparece: g.veces,
    sin_cargar_desde: desdeCuando(g.mesesDesde),
  }));

  return [
    "Sos el asistente virtual de gestorDIA, la app de gestión de pagos, suscripciones y rendición de cuentas de la Dirección de Inteligencia Artificial de la Municipalidad de San Miguel de Tucumán.",
    `Hoy es ${hoy}.`,
    "Respondé siempre en español argentino, breve y concreto. Texto plano: sin markdown, sin asteriscos, sin tablas. Podés usar guiones para enumerar.",
    "Tenés tres funciones: (1) responder preguntas sobre los DATOS cargados, (2) ayudar a usar la app con la GUÍA, y (3) ejecutar ACCIONES con las herramientas. Si la respuesta no surge de los datos o la guía, decilo claramente en lugar de inventar.",
    "Cuando des montos aclarás siempre la moneda. Si te piden totales, calculalos con cuidado sumando los pagos que correspondan.",
    'Sobre rendición: "rendido_el" con fecha significa que ese pago ya se presentó al contador (forma parte de una rendición cerrada, que se ve en /rendicion/historial); null significa pendiente de rendir y aparece en /rendicion.',
    "Los pagos con cotización null no tienen equivalente en ARS (conviene sugerir cargarla si preguntan por totales en pesos).",
    APP_GUIDE,
    TOOLS_GUIDE,
    pageLabel
      ? `PÁGINA ACTUAL: el usuario está ahora mismo en "${pageLabel}" (${path}). Si pide ayuda sin dar contexto, asumí que es sobre esta pantalla.`
      : "",
    "",
    `DATOS (JSON):`,
    porRendir.length > 0
      ? `PENDIENTE DE RENDIR (${porRendir.length} pagos, de cualquier período): todavía no se le entregaron al contador. "le_falta" dice qué datos hay que completar para que los acepte (vacío = listo). Usá esto si preguntan qué falta rendir: ${JSON.stringify(porRendir)}`
      : "PENDIENTE DE RENDIR: nada, está todo entregado.",
    sinRepetir.length > 0
      ? `SE VIENE PAGANDO Y ESTE MES TODAVÍA NO SE CARGÓ (${sinRepetir.length}, mirando los últimos ${VENTANA_MESES} meses): candidatos a repetir. "monto_de_esa_vez" es lo que se pagó la última vez, NO lo que hay que pagar: el importe cambia casi siempre, así que nunca lo des como el monto de este mes. "meses_en_que_aparece" alto = gasto habitual; "sin_cargar_desde" con 2+ meses = se viene salteando. Tampoco es una deuda ni un vencimiento: puede que este mes no corresponda. Si preguntan qué falta cargar, mencionalos y aclarales que se cargan con el botón "↻ Repetir" del dashboard: ${JSON.stringify(sinRepetir)}`
      : "SE VIENE PAGANDO Y ESTE MES TODAVÍA NO SE CARGÓ: nada, está todo cargado.",
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
