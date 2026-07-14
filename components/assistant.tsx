"use client";

// Asistente virtual flotante. Además de responder preguntas, propone
// acciones (crear pago/servicio, marcar rendidos): el modelo llama una
// herramienta, acá se muestra una tarjeta de confirmación y recién al
// confirmar se ejecuta contra /api/chat/execute.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/types";
import { downloadRendicionPdf, type RendicionPdfRow } from "@/lib/rendicion-pdf";

interface ActionPdf {
  rows: RendicionPdfRow[];
  totalARS: number;
  totalUSD: number;
  filename: string;
  title: string;
}

type ChatItem =
  | { kind: "msg"; role: "user" | "assistant"; content: string }
  | {
      kind: "action";
      tool: string;
      title: string;
      fields: { label: string; value: string }[];
      warnings: string[];
      args: Record<string, unknown>;
      status: "pending" | "working" | "done" | "cancelled" | "error";
      resultMessage?: string;
      href?: string;
      pdf?: ActionPdf;
    };

export interface AssistantAlert {
  id: string;
  name: string;
  date: string;
  days: number; // negativo = vencido
  amount: number | null;
  currency: CurrencyCode;
  auto: boolean; // true = débito automático, false = pago manual
}

const SUGERENCIAS = [
  "¿Cuánto gastamos este mes?",
  "¿Qué falta rendir?",
  "Quiero registrar un gasto",
];

// Convierte el historial visible en mensajes para el LLM
function toLlmMessages(items: ChatItem[]) {
  return items.map((it) => {
    if (it.kind === "msg") return { role: it.role, content: it.content };
    const estado =
      it.status === "done"
        ? `ejecutada con éxito: ${it.resultMessage ?? ""}`
        : it.status === "error"
        ? `falló: ${it.resultMessage ?? ""}`
        : it.status === "cancelled"
        ? "cancelada por el usuario"
        : "quedó sin confirmar";
    return { role: "assistant" as const, content: `[Acción ${it.tool} (${it.title}) ${estado}]` };
  });
}

export default function Assistant({ alerts = [] }: { alerts?: AssistantAlert[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, open, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const history: ChatItem[] = [...items, { kind: "msg", role: "user", content: question }];
    setItems(history);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toLlmMessages(history), path: pathname }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Error HTTP ${res.status}`);

      const next = [...history];
      if (data.type === "action") {
        if (data.text) next.push({ kind: "msg", role: "assistant", content: data.text });
        next.push({
          kind: "action",
          tool: data.action.tool,
          title: data.action.title,
          fields: data.action.fields,
          warnings: data.action.warnings ?? [],
          args: data.action.args,
          status: "pending",
        });
      } else {
        next.push({ kind: "msg", role: "assistant", content: data.text || "…" });
      }
      setItems(next);
    } catch (e) {
      setItems(history);
      setError(e instanceof Error ? e.message : "No se pudo consultar al asistente.");
    } finally {
      setBusy(false);
    }
  }

  // "Ya lo pagué" desde una alerta manual: pide al bot registrar el pago del servicio
  function payFromAlert(a: AssistantAlert) {
    send(`Ya pagué "${a.name}", registrá el pago y avanzá la próxima fecha de cobro.`);
  }

  async function runAction(index: number) {
    const item = items[index];
    if (item.kind !== "action" || item.status !== "pending") return;
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, status: "working" as const } : it)));
    try {
      const res = await fetch("/api/chat/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: item.tool, args: item.args }),
      });
      const data = await res.json().catch(() => null);
      const ok = res.ok && data?.ok;
      setItems((prev) =>
        prev.map((it, i) =>
          i === index && it.kind === "action"
            ? {
                ...it,
                status: ok ? ("done" as const) : ("error" as const),
                resultMessage: data?.message ?? data?.error ?? "Error desconocido.",
                href: data?.href,
                pdf: data?.pdf ?? undefined,
              }
            : it
        )
      );
      if (ok) router.refresh(); // refresca la página de fondo con el dato nuevo
    } catch {
      setItems((prev) =>
        prev.map((it, i) =>
          i === index && it.kind === "action"
            ? { ...it, status: "error" as const, resultMessage: "No se pudo ejecutar la acción." }
            : it
        )
      );
    }
  }

  function cancelAction(index: number) {
    setItems((prev) =>
      prev.map((it, i) => (i === index && it.kind === "action" ? { ...it, status: "cancelled" as const } : it))
    );
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Cerrar asistente" : "Abrir asistente"}
        title="Asistente DIA"
        className={`assistant-fab${open ? " is-open" : ""}`}
      >
        {open ? (
          <span style={{ color: "var(--text)", fontSize: "1.25rem", lineHeight: 1 }}>✕</span>
        ) : (
          <Image src="/brand/bot.png" alt="" width={36} height={25} />
        )}
        {!open && alerts.length > 0 && (
          <span className="assistant-fab-badge" aria-label={`${alerts.length} alertas`}>
            {alerts.length}
          </span>
        )}
      </button>

      {/* Panel de chat */}
      {open && (
        <div
          className="card assistant-panel"
          style={{
            position: "fixed",
            bottom: "5.6rem",
            right: "1.4rem",
            zIndex: 40,
            width: "min(380px, calc(100vw - 2rem))",
            height: "min(540px, calc(100vh - 8rem))",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--glass-border)" }}>
            <Image src="/brand/bot.png" alt="" width={30} height={21} />
            <div>
              <div className="font-display" style={{ fontWeight: 600, fontSize: "0.95rem" }}>Asistente DIA</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Consultá o pedime cargar gastos, servicios y rendiciones</div>
            </div>
          </div>

          {/* Mensajes */}
          <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {items.length === 0 && (
              <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                {alerts.length > 0 && (
                  <div
                    style={{
                      padding: "0.7rem 0.85rem",
                      borderRadius: "14px 14px 14px 4px",
                      background: "rgba(251, 191, 36, 0.07)",
                      border: "1px solid rgba(251, 191, 36, 0.25)",
                      display: "grid",
                      gap: "0.45rem",
                      marginBottom: "0.4rem",
                    }}
                  >
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#fbbf24" }}>
                      🔔 {alerts.length === 1 ? "1 alerta de pago" : `${alerts.length} alertas de pagos`}
                    </span>
                    {alerts.map((a) => (
                      <div key={a.id} style={{ fontSize: "0.82rem", lineHeight: 1.4 }}>
                        <Link href={`/servicios/${a.id}`} style={{ color: "var(--text)" }}>
                          <span style={{ fontWeight: 600 }}>{a.name}</span>
                          {a.auto ? " se debita" : " tenés que pagarlo"} el {formatDate(a.date)}{" "}
                          <span style={{ color: a.days <= 0 ? "#f87171" : "#fbbf24", fontWeight: 600 }}>
                            {a.days < 0 ? `(venció hace ${-a.days}d)` : a.days === 0 ? "(¡hoy!)" : `(en ${a.days}d)`}
                          </span>
                        </Link>
                        {!a.auto && (
                          <div style={{ marginTop: 3 }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: "0.2rem 0.55rem", fontSize: "0.74rem" }}
                              onClick={() => payFromAlert(a)}
                              disabled={busy}
                            >
                              ✓ Ya lo pagué
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
                  Hola 👋 Puedo responder con los datos de gestorDIA y también cargar gastos, crear servicios o rendir pagos por vos. Probá con:
                </p>
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="btn btn-ghost"
                    style={{ justifyContent: "flex-start", fontSize: "0.82rem", fontWeight: 500, padding: "0.5rem 0.75rem" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {items.map((it, i) =>
              it.kind === "msg" ? (
                <div
                  key={i}
                  style={{
                    alignSelf: it.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    padding: "0.55rem 0.8rem",
                    borderRadius: it.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: it.role === "user" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text)",
                    fontSize: "0.86rem",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {it.content}
                </div>
              ) : (
                <ActionCard key={i} item={it} onConfirm={() => runAction(i)} onCancel={() => cancelAction(i)} />
              )
            )}

            {busy && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "0.55rem 0.8rem",
                  borderRadius: "14px 14px 14px 4px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--glass-border)",
                }}
              >
                <PensandoDots />
              </div>
            )}
            {error && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            style={{ display: "flex", gap: "0.5rem", padding: "0.8rem 1.1rem", borderTop: "1px solid var(--glass-border)" }}
          >
            <input
              className="input"
              placeholder="Escribí tu pregunta o pedido…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-ghost" disabled={busy || !input.trim()} style={{ padding: "0.6rem 0.9rem" }}>
              {busy ? "…" : "➤"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

// Tarjeta de confirmación / resultado de una acción propuesta por el asistente
function ActionCard({
  item,
  onConfirm,
  onCancel,
}: {
  item: Extract<ChatItem, { kind: "action" }>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const done = item.status === "done";
  const cancelled = item.status === "cancelled";
  const failed = item.status === "error";

  return (
    <div
      style={{
        alignSelf: "flex-start",
        width: "95%",
        padding: "0.8rem 0.9rem",
        borderRadius: "14px 14px 14px 4px",
        background: done ? "rgba(52, 211, 153, 0.06)" : "rgba(47, 169, 255, 0.06)",
        border: `1px solid ${done ? "rgba(52, 211, 153, 0.3)" : failed ? "rgba(248, 113, 113, 0.4)" : "rgba(47, 169, 255, 0.3)"}`,
        display: "grid",
        gap: "0.55rem",
        opacity: cancelled ? 0.55 : 1,
        fontSize: "0.84rem",
      }}
    >
      <span style={{ fontWeight: 600, color: done ? "#6ee7b7" : "var(--primary)" }}>
        {done ? "✓ " : "⚡ "}
        {item.title}
      </span>

      <div style={{ display: "grid", gap: "0.25rem" }}>
        {item.fields.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: "0.6rem", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{f.label}</span>
            <span style={{ textAlign: "right", fontWeight: 500 }}>{f.value}</span>
          </div>
        ))}
      </div>

      {item.warnings.length > 0 && !done && !cancelled && (
        <div style={{ display: "grid", gap: "0.2rem" }}>
          {item.warnings.map((w, i) => (
            <span key={i} style={{ fontSize: "0.76rem", color: "#fbbf24" }}>⚠ {w}</span>
          ))}
        </div>
      )}

      {item.status === "pending" && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.15rem" }}>
          <button type="button" className="btn btn-primary" style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }} onClick={onConfirm}>
            Confirmar
          </button>
          <button type="button" className="btn btn-ghost" style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      )}
      {item.status === "working" && <PensandoDots />}
      {cancelled && <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>Cancelado.</span>}
      {(done || failed) && (
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.8rem", color: failed ? "#f87171" : "var(--text-muted)" }}>{item.resultMessage}</span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {done && item.href && (
              <Link href={item.href} className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }}>
                Ver →
              </Link>
            )}
            {done && item.pdf && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }}
                onClick={() => downloadRendicionPdf(item.pdf!)}
              >
                ⬇ Descargar PDF
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PensandoDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }} aria-label="Pensando…">
      <Dot delay="0s" />
      <Dot delay="0.15s" />
      <Dot delay="0.3s" />
      <style>{`@keyframes pulseDot { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }`}</style>
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--primary)",
        animation: `pulseDot 1s ease-in-out ${delay} infinite`,
      }}
    />
  );
}
