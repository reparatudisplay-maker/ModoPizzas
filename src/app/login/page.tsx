import Link from "next/link";
import { signIn, signUp } from "@/app/auth/actions";

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
          <h1 className="section-title">Entrar a ModoPizzas</h1>
          <p className="section-copy">
            Usa una cuenta para acceder al panel interno. El primer usuario registrado queda como administrador inicial.
          </p>
          {message ? <p className="alert">{message}</p> : null}
        </div>

        <div className="auth-grid">
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

          <form action={signUp} className="form-panel">
            <h2>Crear cuenta</h2>
            <div className="field">
              <label htmlFor="signup-name">Nombre</label>
              <input id="signup-name" name="full_name" required />
            </div>
            <div className="field">
              <label htmlFor="signup-phone">Telefono</label>
              <input id="signup-phone" name="phone" />
            </div>
            <div className="field">
              <label htmlFor="signup-email">Correo</label>
              <input id="signup-email" name="email" required type="email" />
            </div>
            <div className="field">
              <label htmlFor="signup-password">Contrasena</label>
              <input id="signup-password" minLength={6} name="password" required type="password" />
            </div>
            <button className="primary-button" type="submit">
              Crear cuenta
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
