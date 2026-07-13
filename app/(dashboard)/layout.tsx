import { redirect } from "next/navigation";
import { getCurrentUser, IS_DEMO } from "@/lib/data";
import Nav from "./nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav email={user.email} />
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
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "2.5rem 2.5rem 5rem" }}>
        {children}
      </main>
    </div>
  );
}
