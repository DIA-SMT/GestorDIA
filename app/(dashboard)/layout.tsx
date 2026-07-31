import { redirect } from "next/navigation";
import Image from "next/image";
import { getCurrentUser, listServices, IS_DEMO } from "@/lib/data";
import { loadPendingCharges } from "@/lib/pending";
import { daysUntil, effectiveRenewal, anchorDayOf } from "@/lib/utils";
import Sidebar from "@/components/sidebar";
import Assistant from "@/components/assistant";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [services, pending] = await Promise.all([listServices(), loadPendingCharges()]);

  // Alertas para el asistente: próximos cobros (≤30 días). Los ya vencidos no
  // van acá: aparecen como cargos por confirmar, que es donde se resuelven.
  const alerts = services
    .filter((s) => s.status === "active" && s.next_renewal_date)
    .map((s) => {
      const date = effectiveRenewal(s.next_renewal_date, s.billing_cycle, s.payment_mode, anchorDayOf(s))!;
      return { s, date, d: daysUntil(date)!, auto: s.payment_mode !== "manual" };
    })
    .filter(({ d, auto }) => (auto ? d >= 0 && d <= 30 : d > 0 && d <= 30))
    .sort((a, b) => a.d - b.d)
    .map(({ s, date, d, auto }) => ({
      id: s.id,
      name: s.name,
      date,
      days: d,
      amount: s.expected_amount,
      currency: s.currency,
      auto,
    }));

  return (
    <div className="app-shell">
      <Sidebar email={user.email} porConfirmar={pending.total} />

      {/* minWidth 0 para que las tablas anchas scrolleen adentro y no estiren el grid */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {IS_DEMO && (
          <div
            style={{
              background: "rgba(255,255,255,0.025)",
              borderBottom: "1px solid var(--glass-border)",
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              textAlign: "center",
              padding: "0.5rem 1rem",
            }}
          >
            <strong style={{ color: "#fbbf24" }}>Modo demo</strong> — datos de ejemplo en memoria.
            Completá <code>.env.local</code> con tu proyecto de Supabase para pasar a modo real.
          </div>
        )}

        <main style={{ flex: 1, maxWidth: 1360, width: "100%", margin: "0 auto", padding: "2.25rem 2rem 3rem" }}>
          {children}
        </main>

        <footer
          style={{
            maxWidth: 1360,
            width: "100%",
            margin: "0 auto",
            padding: "1.2rem 2rem 2rem",
            display: "flex",
            alignItems: "center",
            gap: "0.55rem",
            fontSize: "0.78rem",
            color: "var(--text-faint)",
            borderTop: "1px solid var(--glass-border)",
          }}
        >
          <Image src="/brand/muni.png" alt="" aria-hidden width={16} height={17} />
          Dirección de Inteligencia Artificial · Municipalidad de San Miguel de Tucumán
        </footer>
      </div>

      {/* Fuera del grid y sin ancestros con transform: el FAB es position:fixed */}
      <Assistant alerts={alerts} />
    </div>
  );
}
