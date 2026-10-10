"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Printer } from "lucide-react";
import { createIpadThermalPrintJob, saveThermalPrinterSettings, type FormActionState, type ThermalPrinterSettings } from "@/app/admin/actions";
import { createIpadThermalPayload, runIpadShortcut, shouldUseIpadShortcut } from "@/lib/device-thermal-print";
import { printThermalDocuments } from "@/lib/thermal-print";

const initialState: FormActionState = { status: "idle", message: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : "Guardar impresora"}</button>;
}

export function PrinterSettingsModule({ settings }: { settings: ThermalPrinterSettings }) {
  const [state, action] = useActionState(saveThermalPrinterSettings, initialState);
  const [method, setMethod] = useState(settings.preferred_print_method);
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState(false);
  const sampleRef = useRef<HTMLElement>(null);

  const printTest = async () => {
    if (!sampleRef.current) return;
    setTesting(true);
    setTestMessage("");
    setTestError("");
    const current = { ...settings, preferred_print_method: method };
    if (shouldUseIpadShortcut(current)) {
      const result = await createIpadThermalPrintJob(createIpadThermalPayload([sampleRef.current]));
      setTesting(false);
      if (result.status === "error" || !result.shortcut_input) {
        setTestError(result.message);
        return;
      }
      setTestMessage("Prueba enviada al atajo Imprimir Modo Pizzas.");
      runIpadShortcut(result.shortcut_input);
      return;
    }
    const opened = printThermalDocuments([sampleRef.current], "Prueba impresora Modo Pizzas");
    setTesting(false);
    if (!opened) setTestError("No se pudo abrir la prueba de impresión.");
    else setTestMessage("Se abrió la prueba en el servicio de impresión del dispositivo.");
  };

  return (
    <section className="module-stack">
      <div className="section-title-row"><h1>Impresoras</h1></div>
      <form action={action} className="form-panel kitchen-settings-form">
        <section className="settings-section">
          <h2>Impresora térmica</h2>
          <div className="form-grid">
            <label className="field"><span>Modelo</span><input disabled value="JP58W" /></label>
            <label className="field"><span>Papel</span><input disabled value="58 mm · área útil 48 mm" /></label>
            <label className="field"><span>Dirección IP</span><input defaultValue={settings.ip_address} inputMode="decimal" name="ip_address" required /></label>
            <label className="field"><span>Puerto TCP</span><input defaultValue={settings.port} max={65535} min={1} name="port" required type="number" /></label>
            <label className="field"><span>Método de impresión</span><select name="preferred_print_method" onChange={(event) => setMethod(event.target.value as ThermalPrinterSettings["preferred_print_method"])} value={method}><option value="auto">Automático por dispositivo</option><option value="browser">Navegador / servicios del dispositivo</option><option value="ipad_shortcut">Atajo de iPad</option></select></label>
          </div>
          <p className="muted">Automático usa el atajo en iPadOS, incluso cuando Safari se identifica como macOS con pantalla táctil. Windows y Android conservan la impresión del dispositivo.</p>
        </section>
        {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
        <div className="form-actions"><SaveButton /><button className="ghost-button" disabled={testing} onClick={() => void printTest()} type="button"><Printer size={16} /> {testing ? "Preparando..." : "Impresión de prueba"}</button></div>
        {testMessage ? <p className="form-status success">{testMessage}</p> : null}
        {testError ? <p className="form-status error">{testError}</p> : null}
      </form>
      <article aria-hidden="true" className="thermal printer-test-document" ref={sampleRef} style={{ left: "-10000px", position: "fixed", top: 0, width: "48mm" }}>
        <header className="kitchen-ticket-header"><strong>MODO PIZZAS</strong><b>PRUEBA DE IMPRESORA</b><span>JP58W · 58 mm</span></header>
        <section className="kitchen-ticket-summary"><p><span>IP</span><strong>{settings.ip_address}:{settings.port}</strong></p><p><span>ESTADO</span><strong>LISTA</strong></p></section>
      </article>
    </section>
  );
}
