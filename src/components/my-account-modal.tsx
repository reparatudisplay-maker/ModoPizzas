"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { ImagePlus, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import { updateMyEmail, updateMyPassword, updateMyProfile, type AccountActionState } from "@/app/auth/actions";
import { optimizeImageInput } from "@/lib/client-images";

const initialState: AccountActionState = { status: "idle", message: "" };

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : children}</button>;
}

export function MyAccountModal({ avatarUrl, email, fullName, role, onClose }: { avatarUrl: string | null; email: string; fullName: string; role: string; onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "email" | "password">("profile");
  const [preview, setPreview] = useState(avatarUrl ?? "");
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [profileState, profileAction] = useActionState(updateMyProfile, initialState);
  const [emailState, emailAction] = useActionState(updateMyEmail, initialState);
  const [passwordState, passwordAction] = useActionState(updateMyPassword, initialState);

  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (profileState.status === "success") window.dispatchEvent(new Event("modopizzas-profile-updated")); }, [profileState.status]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const message = tab === "profile" ? profileState : tab === "email" ? emailState : passwordState;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="Mi cuenta" aria-modal="true" className="modal-panel my-account-modal" role="dialog">
        <header className="modal-header">
          <div><h2>Mi cuenta</h2><span>{role}</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="account-tabs" role="tablist">
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")} type="button"><UserRound size={16} />Perfil</button>
          <button className={tab === "email" ? "active" : ""} onClick={() => setTab("email")} type="button"><Mail size={16} />Correo</button>
          <button className={tab === "password" ? "active" : ""} onClick={() => setTab("password")} type="button"><ShieldCheck size={16} />Contrasena</button>
        </div>
        {tab === "profile" ? (
          <form action={profileAction} className="modal-content form-grid">
            <input name="remove_profile_image" type="hidden" value={removeImage ? "1" : "0"} />
            <div className="account-avatar-row">
              {preview && !removeImage ? <img alt="Foto de perfil" className="account-avatar-preview" src={preview} /> : <span className="account-avatar-fallback">{fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((name) => name[0]).join("").toUpperCase() || "MP"}</span>}
              <div>
                <label className="ghost-button icon-text-button"><ImagePlus size={16} />{preview && !removeImage ? "Cambiar foto" : "Subir foto"}
                  <input accept="image/jpeg,image/png,image/webp" className="sr-only" key={inputKey} name="profile_image" onChange={async (event) => {
                    const result = await optimizeImageInput(event.currentTarget);
                    if (result.error) { setImageError(result.error); return; }
                    if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
                    setPreview(result.previewUrl); setRemoveImage(false); setImageError("");
                  }} type="file" />
                </label>
                {preview && !removeImage ? <button className="text-button danger-text" onClick={() => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); setPreview(""); setRemoveImage(true); setInputKey((value) => value + 1); }} type="button">Eliminar foto</button> : null}
              </div>
            </div>
            <label className="field full-row">Nombre<input defaultValue={fullName} name="full_name" required /></label>
            <label className="field full-row">Correo actual<input disabled value={email} /></label>
            {imageError ? <p className="form-error full-row">{imageError}</p> : null}
            {message.status !== "idle" ? <p className={message.status === "error" ? "form-error full-row" : "form-status success full-row"}>{message.message}</p> : null}
            <footer className="form-actions modal-form-actions full-row"><button className="ghost-button" onClick={onClose} type="button">Cerrar</button><SubmitButton>Guardar perfil</SubmitButton></footer>
          </form>
        ) : null}
        {tab === "email" ? <form action={emailAction} className="modal-content form-grid"><label className="field full-row">Nuevo correo<input defaultValue={email} name="email" required type="email" /></label>{message.status !== "idle" ? <p className={message.status === "error" ? "form-error full-row" : "form-status success full-row"}>{message.message}</p> : null}<footer className="form-actions modal-form-actions full-row"><button className="ghost-button" onClick={onClose} type="button">Cerrar</button><SubmitButton>Confirmar cambio</SubmitButton></footer></form> : null}
        {tab === "password" ? <form action={passwordAction} className="modal-content form-grid"><label className="field full-row">Nueva contrasena<input autoComplete="new-password" minLength={8} name="password" required type="password" /></label><label className="field full-row">Confirmar contrasena<input autoComplete="new-password" minLength={8} name="password_confirmation" required type="password" /></label>{message.status !== "idle" ? <p className={message.status === "error" ? "form-error full-row" : "form-status success full-row"}>{message.message}</p> : null}<footer className="form-actions modal-form-actions full-row"><button className="ghost-button" onClick={onClose} type="button">Cerrar</button><SubmitButton>Actualizar contrasena</SubmitButton></footer></form> : null}
      </section>
    </div>
  );
}
