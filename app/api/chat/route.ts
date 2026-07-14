// Asistente virtual: responde preguntas sobre los datos de gestorDIA
// (pagos, servicios, rendiciones) usando un LLM vía OpenRouter.
// El contexto se arma en cada request con un snapshot de la base.

import { getCurrentUser, listPayments, listServices, listCategories } from "@/lib/data";
import { toARS } from "@/lib/utils";
import { BILLING_CYCLE_LABELS, RECEIPT_TYPE_LABELS, PAYMENT_STATUS_LABELS, SERVICE_STATUS_LABELS } from "@/lib/types";

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
- El asistente NO puede crear, editar ni borrar nada todavía: solo lee los datos. Para operar hay que usar las pantallas.
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
    proxima_renovacion: s.next_renewal_date,
  }));

  const hoy = new Date().toISOString().slice(0, 10);
  const pageLabel = path ? PAGE_LABELS.find(([re]) => re.test(path))?.[1] ?? null : null;

  return [
    "Sos el asistente virtual de gestorDIA, la app de gestión de pagos, suscripciones y rendición de cuentas de la Dirección de Inteligencia Artificial de la Municipalidad de San Miguel de Tucumán.",
    `Hoy es ${hoy}.`,
    "Respondé siempre en español argentino, breve y concreto. Texto plano: sin markdown, sin asteriscos, sin tablas. Podés usar guiones para enumerar.",
    "Tenés dos funciones: (1) responder preguntas sobre los DATOS cargados, y (2) ayudar a usar la app con la GUÍA. Si la respuesta no surge de los datos o la guía, decilo claramente en lugar de inventar.",
    "Cuando des montos aclarás siempre la moneda. Si te piden totales, calculalos con cuidado sumando los pagos que correspondan.",
    'Sobre rendición: "rendido_el" con fecha significa que ese pago ya se presentó al contador; null significa pendiente de rendir.',
    "Los pagos con cotización null no tienen equivalente en ARS (conviene sugerir cargarla si preguntan por totales en pesos).",
    APP_GUIDE,
    pageLabel
      ? `PÁGINA ACTUAL: el usuario está ahora mismo en "${pageLabel}" (${path}). Si pide ayuda sin dar contexto, asumí que es sobre esta pantalla.`
      : "",
    "",
    `DATOS (JSON):`,
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
      stream: true,
      max_tokens: 1024,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("OpenRouter error:", upstream.status, detail);
    return Response.json(
      { error: `El modelo no respondió (HTTP ${upstream.status}). Revisá la API key y el modelo configurado.` },
      { status: 502 }
    );
  }

  // Convierte el SSE de OpenRouter en un stream de texto plano para el cliente
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data:")) continue;
        const payload = data.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined = json.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        } catch {
          // línea SSE incompleta o de metadata: se ignora
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
