"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const router = useRouter(); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const password = String(form.get("password") ?? ""); if (password.length < 8 || password !== String(form.get("confirmation") ?? "")) { setError("Usa una contraseña de al menos 8 caracteres y confírmala correctamente."); return; } setPending(true); const { error: updateError } = await createClient().auth.updateUser({ password }); setPending(false); if (updateError) { setError(updateError.message); return; } setMessage("Contraseña actualizada. Puedes continuar con tu pedido."); window.setTimeout(() => router.replace("/"), 800); }
  return <main className="public-reset-page"><section className="public-auth-modal"><header><div><span>MI CUENTA</span><h2>Nueva contraseña</h2></div></header><div className="public-auth-body"><form onSubmit={submit}><label>Nueva contraseña<input autoComplete="new-password" name="password" required type="password" /></label><label>Confirmar contraseña<input autoComplete="new-password" name="confirmation" required type="password" /></label><button className="public-primary" disabled={pending} type="submit">{pending ? "Guardando..." : "Actualizar contraseña"}</button></form>{error ? <p className="public-form-error">{error}</p> : null}{message ? <p className="public-form-success">{message}</p> : null}</div></section></main>;
}
