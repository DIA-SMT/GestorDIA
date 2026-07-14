import { redirect } from "next/navigation";
import Image from "next/image";
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
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "2.5rem 2.5rem 3rem" }}>
        {children}
      </main>
      <footer
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          padding: "1.2rem 2.5rem 2rem",
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
  );
}
