"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bluetooth, LoaderCircle, Printer, Unplug } from "lucide-react";
import { saveThermalPrinterSettings, type FormActionState, type ThermalPrinterSettings } from "@/app/admin/actions";
import {
  connectBlePrinter,
  disconnectBlePrinter,
  getBleErrorMessage,
  getBlePrinterStatus,
  getDevicePrintMethod,
  JP58W_BLE_SERVICE_UUID,
  printBleTest,
  printBleThermalDocuments,
  saveDevicePrintMethod,
  shouldUseBlePrinter,
  subscribeBlePrinterStatus,
  supportsWebBluetooth,
  type BlePrinterStatus,
  type DevicePrintMethod
} from "@/lib/ble-thermal-printer";
import { printThermalDocuments } from "@/lib/thermal-print";

const initialState: FormActionState = { status: "idle", message: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : "Guardar impresora"}</button>;
}

export function PrinterSettingsModule({ settings }: { settings: ThermalPrinterSettings }) {
  const [state, action] = useActionState(saveThermalPrinterSettings, initialState);
  const [method, setMethod] = useState<DevicePrintMethod>("auto");
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState(false);
  const [bleSupported, setBleSupported] = useState(false);
  const [bleStatus, setBleStatus] = useState<BlePrinterStatus>(() => getBlePrinterStatus());
  const [bleError, setBleError] = useState("");
  const [bleBusy, setBleBusy] = useState(false);
  const sampleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const supported = supportsWebBluetooth();
    setBleSupported(supported);
    setMethod(getDevicePrintMethod());
    return subscribeBlePrinterStatus(setBleStatus);
  }, []);

  const disconnectBle = () => {
    disconnectBlePrinter();
    setBleError("");
  };

  const connectBle = async () => {
    if (!supportsWebBluetooth()) {
      setBleError("Este navegador no expone navigator.bluetooth.requestDevice. La impresión Bluetooth BLE no está disponible; usa la impresión original.");
      return;
    }

    setBleBusy(true);
    setBleError("");
    try {
      await connectBlePrinter();
    } catch (error) {
      setBleError(getBleErrorMessage(error));
    } finally {
      setBleBusy(false);
    }
  };

  const handleBleTest = async () => {
    setBleBusy(true);
    setBleError("");
    try {
      await printBleTest();
      setTestMessage("Datos enviados por Bluetooth. Confirma la salida física en la JP58W.");
    } catch (error) {
      setBleError(getBleErrorMessage(error));
    } finally {
      setBleBusy(false);
    }
  };

  const printTest = async () => {
    if (!sampleRef.current) return;
    setTesting(true);
    setTestMessage("");
    setTestError("");
    if (shouldUseBlePrinter()) {
      try {
        const message = await printBleThermalDocuments([sampleRef.current], { connectIfNeeded: true });
        setTestMessage(message);
      } catch (error) {
        setTestError(getBleErrorMessage(error));
      } finally {
        setTesting(false);
      }
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
            <label className="field"><span>Método en este dispositivo</span><select onChange={(event) => { const next = event.target.value as DevicePrintMethod; setMethod(next); saveDevicePrintMethod(next); }} value={method}><option value="auto">Automático (BLE si está disponible)</option><option value="bluetooth">Bluetooth BLE</option><option value="browser">Impresión original</option></select></label>
            <input name="preferred_print_method" type="hidden" value="auto" />
          </div>
          <p className="muted">La preferencia se guarda solo en este navegador. Automático usa BLE cuando este navegador expone navigator.bluetooth.requestDevice; selecciona Impresión original para abrir el diálogo del navegador.</p>
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
      <section className="form-panel kitchen-settings-form" aria-labelledby="ble-print-title">
        <div className="section-title-row"><div><h2 id="ble-print-title">Impresión Bluetooth BLE</h2><p className="muted">Conexión directa desde cualquier navegador compatible con Web Bluetooth. No usa Wi-Fi, Atajos ni modifica los métodos originales.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>Impresora esperada</span><input disabled value="JP-58W_B54E · JP58W / 58H" /></label>
          <label className="field"><span>Servicio BLE</span><input disabled value={JP58W_BLE_SERVICE_UUID.toUpperCase()} /></label>
          <label className="field"><span>Escritura</span><input disabled value="Write / Write Without Response · fragmentos de 20 bytes" /></label>
        </div>
        <p className={`form-status ${bleSupported ? "success" : "error"}`}>{bleStatus.message}</p>
        {bleError ? <p className="form-status error">{bleError}</p> : null}
        <div className="form-actions">
          <button className="primary-button" disabled={bleBusy || !bleSupported} onClick={() => void connectBle()} type="button">{bleBusy ? <LoaderCircle className="spin" size={16} /> : <Bluetooth size={16} />} Conectar impresora Bluetooth</button>
          <button className="ghost-button" disabled={bleBusy || !bleStatus.connected} onClick={() => void handleBleTest()} type="button"><Printer size={16} /> Imprimir prueba BLE</button>
          <button className="ghost-button" disabled={bleBusy || !bleStatus.connected} onClick={disconnectBle} type="button"><Unplug size={16} /> Desconectar</button>
        </div>
      </section>
    </section>
  );
}
