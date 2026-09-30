import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { snapshot } from "@/lib/store";
import Dashboard from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!process.env.DATABASE_URL) return <Pending />;
  let user;
  try {
    user = await currentUser();
  } catch {
    return <Pending />;
  }
  if (!user) redirect("/login");
  try {
    const data = await snapshot();
    return <Dashboard initial={data} email={user.email} />;
  } catch {
    return <Pending />;
  }
}
function Pending() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">p</span>PayAdmin
        </div>
        <span className="eyebrow">CONFIGURACIÓN PENDIENTE</span>
        <h1>Tu espacio está preparado.</h1>
        <p>
          Falta conectar PostgreSQL en el servidor. Configura DATABASE_URL,
          ejecuta las migraciones y crea tu acceso privado siguiendo el README.
        </p>
        <p className="notice">
          La conexión a Railway sigue pendiente. No se muestran datos privados
          sin autenticación.
        </p>
      </div>
    </main>
  );
}
