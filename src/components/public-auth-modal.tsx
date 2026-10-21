"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { LoaderCircle, Mail, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type View = "signin" | "signup" | "recovery";

export function PublicAuthModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const googleOAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";
  const [view, setView] = useState<View>("signin");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError(""); setMessage("");
    const { error: authError } = await createClient().auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "")
    });
    setPending(false);
    if (authError) { setError("No fue posible iniciar sesión. Revisa tu correo y contraseña."); return; }
    router.refresh(); onClose();
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== String(form.get("password_confirmation") ?? "")) { setError("Las contraseñas no coinciden."); return; }
    if (!form.get("terms")) { setError("Acepta los términos y la política de privacidad para continuar."); return; }
    setPending(true); setError(""); setMessage("");
    const { data, error: authError } = await createClient().auth.signUp({
      email: String(form.get("email") ?? "").trim(),
      password,
      options: { data: { full_name: String(form.get("full_name") ?? "").trim(), phone: String(form.get("phone") ?? "").trim() } }
    });
    setPending(false);
    if (authError) { setError(authError.message); return; }
    if (!data.session) { setMessage("Revisa tu correo para confirmar la cuenta y luego inicia sesión."); return; }
    router.refresh(); onClose();
  }

  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError(""); setMessage("");
    const { error: authError } = await createClient().auth.resetPasswordForEmail(String(form.get("email") ?? "").trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`
    });
    setPending(false);
    if (authError) { setError(authError.message); return; }
    setMessage("Te enviamos un enlace para restablecer la contraseña.");
  }

  async function google() {
    if (!googleOAuthEnabled) {
      setError("El acceso con Google aún no está disponible. Ingresa con correo y contraseña.");
      return;
    }
    setPending(true); setError("");
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?next=/` }
    });
    if (authError) {
      const providerUnavailable = authError.message.toLowerCase().includes("provider is not enabled");
      setError(providerUnavailable ? "El acceso con Google aún no está disponible. Ingresa con correo y contraseña." : "No fue posible continuar con Google. Inténtalo de nuevo.");
      setPending(false);
    }
  }

  return <div className="public-overlay public-auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <section aria-label="Acceso de clientes" aria-modal="true" className="public-auth-modal" role="dialog">
      <header><div><span>MI CUENTA</span><h2>{view === "signin" ? "Ingresa a Modo Pizzas" : view === "signup" ? "Crea tu cuenta" : "Recupera tu acceso"}</h2></div><button aria-label="Cerrar" disabled={pending} onClick={onClose} type="button"><X /></button></header>
      <div className="public-auth-body">
        {view !== "recovery" ? <><button className="public-oauth-button" disabled={pending || !googleOAuthEnabled} onClick={google} type="button">{pending ? <LoaderCircle className="spin" size={18} /> : <span>G</span>}Continuar con Google</button>{!googleOAuthEnabled ? <p className="public-oauth-unavailable">Google aún no está disponible.</p> : null}</> : null}
        {view !== "recovery" ? <div className="public-auth-divider"><span />o con correo<span /></div> : null}
        {view === "signin" ? <form onSubmit={signIn}><label>Correo<input autoComplete="email" name="email" required type="email" /></label><label>Contraseña<input autoComplete="current-password" name="password" required type="password" /></label><button className="public-primary" disabled={pending} type="submit">{pending ? "Ingresando..." : "Iniciar sesión"}</button><button className="public-text-button" onClick={() => { setView("recovery"); setError(""); setMessage(""); }} type="button">¿Olvidaste tu contraseña?</button></form> : null}
        {view === "signup" ? <form onSubmit={signUp}><label>Nombre<input autoComplete="name" name="full_name" required /></label><label>Teléfono<input autoComplete="tel" inputMode="tel" name="phone" required /></label><label>Correo<input autoComplete="email" name="email" required type="email" /></label><label>Contraseña<input autoComplete="new-password" minLength={8} name="password" required type="password" /></label><label>Confirmar contraseña<input autoComplete="new-password" minLength={8} name="password_confirmation" required type="password" /></label><label className="public-terms"><input name="terms" type="checkbox" />Acepto los <Link href="/legal/terminos">términos</Link> y la <Link href="/legal/privacidad">política de privacidad</Link>.</label><button className="public-primary" disabled={pending} type="submit">{pending ? "Creando cuenta..." : "Crear cuenta"}</button></form> : null}
        {view === "recovery" ? <form onSubmit={recover}><p>Te enviaremos un enlace seguro para restablecer tu contraseña.</p><label>Correo<input autoComplete="email" name="email" required type="email" /></label><button className="public-primary" disabled={pending} type="submit"><Mail size={17}/>{pending ? "Enviando..." : "Enviar enlace"}</button></form> : null}
        {error ? <p className="public-form-error" role="alert">{error}</p> : null}{message ? <p className="public-form-success" role="status">{message}</p> : null}
      </div>
      <footer>{view === "signin" ? <>¿Nuevo por aquí? <button onClick={() => { setView("signup"); setError(""); setMessage(""); }} type="button">Crear cuenta</button></> : <button onClick={() => { setView("signin"); setError(""); setMessage(""); }} type="button">Volver a iniciar sesión</button>}</footer>
    </section>
  </div>;
}
