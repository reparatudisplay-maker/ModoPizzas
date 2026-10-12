"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bluetooth, LoaderCircle, Printer, Unplug } from "lucide-react";
import { createIpadThermalPrintJob, saveThermalPrinterSettings, type FormActionState, type ThermalPrinterSettings } from "@/app/admin/actions";
import { createIpadThermalPayload, runIpadShortcut, shouldUseIpadShortcut } from "@/lib/device-thermal-print";
import { printThermalDocuments } from "@/lib/thermal-print";

const initialState: FormActionState = { status: "idle", message: "" };
const BLE_SERVICE_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
const BLE_WRITE_CHARACTERISTIC_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
const BLE_CHUNK_SIZE = 20;

type WritableBleCharacteristic = {
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
};

type BleDevice = {
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<{ getPrimaryService: (uuid: string) => Promise<{ getCharacteristic: (uuid: string) => Promise<WritableBleCharacteristic> }> }>;
    disconnect: () => void;
  };
  addEventListener: (type: "gattserverdisconnected", listener: (event: Event) => void) => void;
  removeEventListener: (type: "gattserverdisconnected", listener: (event: Event) => void) => void;
};

type WebBluetooth = {
  requestDevice: (options: { filters: Array<{ services: string[] }>; optionalServices: string[] }) => Promise<BleDevice>;
};

function getWebBluetooth(): WebBluetooth | null {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) return null;
  return (navigator as Navigator & { bluetooth?: WebBluetooth }).bluetooth ?? null;
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function describeBleError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotFoundError") return "No se seleccionó una impresora Bluetooth.";
  if (error instanceof DOMException && error.name === "SecurityError") return "Bluefy no permitió el acceso Bluetooth. Revisa sus permisos de Bluetooth.";
  if (error instanceof Error) return error.message;
  return "No se pudo completar la operación Bluetooth.";
}

function buildBleTestPayload() {
  const text = new TextEncoder().encode("MODO PIZZAS - PRUEBA BLUETOOTH\nJP58W / 58 mm\n\n");
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, ...text, 0x1b, 0x45, 0x00, 0x1b, 0x61, 0x00, 0x1b, 0x64, 0x03]);
}

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
  const [bleSupported, setBleSupported] = useState(false);
  const [bleStatus, setBleStatus] = useState("Comprobando compatibilidad...");
  const [bleError, setBleError] = useState("");
  const [bleBusy, setBleBusy] = useState(false);
  const deviceRef = useRef<BleDevice | null>(null);
  const characteristicRef = useRef<WritableBleCharacteristic | null>(null);
  const disconnectListenerRef = useRef<((event: Event) => void) | null>(null);
  const sampleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const supported = getWebBluetooth() !== null;
    setBleSupported(supported);
    setBleStatus(supported ? "Sin impresora Bluetooth conectada." : "Web Bluetooth no está disponible en este navegador.");
    return () => {
      if (deviceRef.current && disconnectListenerRef.current) {
        deviceRef.current.removeEventListener("gattserverdisconnected", disconnectListenerRef.current);
      }
    };
  }, []);

  const disconnectBle = () => {
    const device = deviceRef.current;
    if (device?.gatt?.connected) device.gatt.disconnect();
    characteristicRef.current = null;
    deviceRef.current = null;
    setBleStatus("Impresora Bluetooth desconectada.");
    setBleError("");
  };

  const connectBle = async () => {
    const bluetooth = getWebBluetooth();
    if (!bluetooth) {
      setBleError("Este navegador no ofrece Web Bluetooth. Usa Bluefy en el iPad.");
      return;
    }

    setBleBusy(true);
    setBleError("");
    setBleStatus("Selecciona JP-58W_B54E en el selector Bluetooth...");
    try {
      const device = await bluetooth.requestDevice({ filters: [{ services: [BLE_SERVICE_UUID] }], optionalServices: [BLE_SERVICE_UUID] });
      const server = await device.gatt?.connect();
      if (!server) throw new Error("La impresora no permitió una conexión GATT.");
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(BLE_WRITE_CHARACTERISTIC_UUID);

      if (deviceRef.current && disconnectListenerRef.current) {
        deviceRef.current.removeEventListener("gattserverdisconnected", disconnectListenerRef.current);
      }
      const disconnected = () => {
        characteristicRef.current = null;
        deviceRef.current = null;
        setBleStatus("La impresora Bluetooth se desconectó.");
      };
      device.addEventListener("gattserverdisconnected", disconnected);
      disconnectListenerRef.current = disconnected;
      deviceRef.current = device;
      characteristicRef.current = characteristic;
      setBleStatus(`Conectada a ${device.name ?? "JP58W"}. Característica de escritura lista.`);
    } catch (error) {
      setBleStatus("Sin impresora Bluetooth conectada.");
      setBleError(describeBleError(error));
    } finally {
      setBleBusy(false);
    }
  };

  const printBleTest = async () => {
    const characteristic = characteristicRef.current;
    if (!characteristic) {
      setBleError("Conecta primero la impresora Bluetooth.");
      return;
    }

    setBleBusy(true);
    setBleError("");
    setBleStatus("Enviando prueba ESC/POS en fragmentos BLE...");
    try {
      const payload = buildBleTestPayload();
      const write = typeof characteristic.writeValueWithoutResponse === "function"
        ? characteristic.writeValueWithoutResponse.bind(characteristic)
        : typeof characteristic.writeValueWithResponse === "function"
          ? characteristic.writeValueWithResponse.bind(characteristic)
          : typeof characteristic.writeValue === "function"
            ? characteristic.writeValue.bind(characteristic)
            : null;
      if (!write) throw new Error("La característica BLE no admite escritura en Bluefy.");

      for (let offset = 0; offset < payload.length; offset += BLE_CHUNK_SIZE) {
        await write(payload.slice(offset, offset + BLE_CHUNK_SIZE));
        await pause(24);
      }
      setBleStatus("Datos enviados correctamente a la impresora. Confirma la salida física en la JP58W.");
    } catch (error) {
      setBleError(describeBleError(error));
      setBleStatus("No se completó el envío de prueba.");
    } finally {
      setBleBusy(false);
    }
  };

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
      <section className="form-panel kitchen-settings-form" aria-labelledby="ble-print-title">
        <div className="section-title-row"><div><h2 id="ble-print-title">Impresión Bluetooth BLE</h2><p className="muted">Experimental. Conecta directamente desde Bluefy; no usa Wi-Fi, Atajos ni el flujo de impresión de pedidos.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>Impresora esperada</span><input disabled value="JP-58W_B54E · JP58W / 58H" /></label>
          <label className="field"><span>Servicio BLE</span><input disabled value="E7810A71-73AE-499D-8C15-FAA9AEF0C3F2" /></label>
          <label className="field"><span>Escritura</span><input disabled value="Write / Write Without Response · fragmentos de 20 bytes" /></label>
        </div>
        <p className={`form-status ${bleSupported ? "success" : "error"}`}>{bleStatus}</p>
        {bleError ? <p className="form-status error">{bleError}</p> : null}
        <div className="form-actions">
          <button className="primary-button" disabled={bleBusy || !bleSupported} onClick={() => void connectBle()} type="button">{bleBusy ? <LoaderCircle className="spin" size={16} /> : <Bluetooth size={16} />} Conectar impresora Bluetooth</button>
          <button className="ghost-button" disabled={bleBusy || !characteristicRef.current} onClick={() => void printBleTest()} type="button"><Printer size={16} /> Imprimir prueba BLE</button>
          <button className="ghost-button" disabled={bleBusy || !deviceRef.current} onClick={disconnectBle} type="button"><Unplug size={16} /> Desconectar</button>
        </div>
      </section>
    </section>
  );
}
