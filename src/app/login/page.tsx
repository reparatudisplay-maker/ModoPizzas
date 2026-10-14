import Link from "next/link";
import { signIn } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div>
          <Link className="ghost-button" href="/">
            Volver
          </Link>
          <h1 className="section-title">Acceso interno</h1>
          <p className="section-copy">
            Este acceso es exclusivo para el equipo de Modo Pizzas. Las cuentas de clientes se crean e inician desde la tienda pública.
          </p>
          {message ? <p className="alert">{message}</p> : null}
        </div>

        <div className="auth-grid auth-grid-single">
          <form action={signIn} className="form-panel">
            <h2>Iniciar sesion</h2>
            <div className="field">
              <label htmlFor="signin-email">Correo</label>
              <input id="signin-email" name="email" required type="email" />
            </div>
            <div className="field">
              <label htmlFor="signin-password">Contrasena</label>
              <input id="signin-password" minLength={6} name="password" required type="password" />
            </div>
            <button className="primary-button" type="submit">
              Entrar
            </button>
          </form>

        </div>
        <p className="section-copy">¿Buscas pedir? <Link href="/">Ingresa o crea tu cuenta desde la tienda.</Link></p>
      </section>
    </main>
  );
}
