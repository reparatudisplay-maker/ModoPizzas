"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bluetooth, LoaderCircle, Plus, Printer, Save, Trash2, Unplug } from "lucide-react";
import { saveThermalPrinterSettings, type FormActionState, type ThermalPrinterSettings } from "@/app/admin/actions";
import {
  connectBlePrinter,
  createBluetoothProfileId,
  disconnectBlePrinter,
  getBluetoothPrinterConfiguration,
  getBleErrorMessage,
  getBlePrinterStatus,
  getDefaultBluetoothProfile,
  getDevicePrintMethod,
  JP58W_BLUETOOTH_PROFILE,
  printBleTest,
  printBleThermalDocuments,
  saveBluetoothPrinterConfiguration,
  saveDevicePrintMethod,
  shouldUseBlePrinter,
  subscribeBlePrinterStatus,
  supportsWebBluetooth,
  validateBluetoothProfile,
  type BluetoothPrinterConfiguration,
  type BluetoothPrinterProfile,
  type BlePrinterStatus,
  type DevicePrintMethod
} from "@/lib/ble-thermal-printer";
import { printThermalDocuments } from "@/lib/thermal-print";

const initialState: FormActionState = { status: "idle", message: "" };

function newBluetoothProfile(): BluetoothPrinterProfile {
  return {
    id: createBluetoothProfileId(),
    name: "Nueva impresora térmica",
    serviceUuid: "",
    writeCharacteristicUuid: "",
    protocol: "escpos",
    paperWidthMm: 58,
    printableWidthMm: 48,
    chunkSize: 20,
    writeDelayMs: 24
  };
}

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
  const [bluetoothConfiguration, setBluetoothConfiguration] = useState<BluetoothPrinterConfiguration>(() => getBluetoothPrinterConfiguration());
  const [selectedProfileId, setSelectedProfileId] = useState(JP58W_BLUETOOTH_PROFILE.id);
  const [profileDraft, setProfileDraft] = useState<BluetoothPrinterProfile>(JP58W_BLUETOOTH_PROFILE);
  const [profileMessage, setProfileMessage] = useState("");
  const sampleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const supported = supportsWebBluetooth();
    setBleSupported(supported);
    setMethod(getDevicePrintMethod());
    const configuration = getBluetoothPrinterConfiguration();
    setBluetoothConfiguration(configuration);
    const profile = getDefaultBluetoothProfile(configuration);
    setSelectedProfileId(profile.id);
    setProfileDraft(profile);
    return subscribeBlePrinterStatus(setBleStatus);
  }, []);

  const selectedProfile = bluetoothConfiguration.profiles.find((profile) => profile.id === selectedProfileId) ?? JP58W_BLUETOOTH_PROFILE;
  const hasSavedSelectedProfile = bluetoothConfiguration.profiles.some((profile) => profile.id === selectedProfileId);

  const saveBluetoothConfiguration = (nextConfiguration: BluetoothPrinterConfiguration) => {
    const normalized = saveBluetoothPrinterConfiguration(nextConfiguration);
    setBluetoothConfiguration(normalized);
    return normalized;
  };

  const selectProfile = (profileId: string) => {
    const profile = bluetoothConfiguration.profiles.find((item) => item.id === profileId) ?? JP58W_BLUETOOTH_PROFILE;
    setSelectedProfileId(profile.id);
    setProfileDraft(profile);
    setProfileMessage("");
    setBleError("");
  };

  const saveProfile = () => {
    if (profileDraft.builtIn) {
      setProfileMessage("El perfil preconfigurado JP58W se conserva sin cambios. Crea un perfil nuevo para otra impresora.");
      return;
    }
    const error = validateBluetoothProfile(profileDraft);
    if (error) {
      setProfileMessage(error);
      return;
    }
    const profiles = bluetoothConfiguration.profiles.some((profile) => profile.id === profileDraft.id)
      ? bluetoothConfiguration.profiles.map((profile) => profile.id === profileDraft.id ? profileDraft : profile)
      : [...bluetoothConfiguration.profiles, profileDraft];
    saveBluetoothConfiguration({ ...bluetoothConfiguration, profiles });
    setSelectedProfileId(profileDraft.id);
    setProfileMessage(`Perfil ${profileDraft.name} guardado en este dispositivo.`);
  };

  const deleteProfile = () => {
    if (selectedProfile.builtIn) return;
    const printers = bluetoothConfiguration.printers.filter((printer) => printer.profileId !== selectedProfile.id);
    const configuration = saveBluetoothConfiguration({
      profiles: bluetoothConfiguration.profiles.filter((profile) => profile.id !== selectedProfile.id),
      printers,
      defaultPrinterId: bluetoothConfiguration.defaultPrinterId
    });
    const profile = getDefaultBluetoothProfile(configuration);
    setSelectedProfileId(profile.id);
    setProfileDraft(profile);
    setProfileMessage("Perfil eliminado de este dispositivo.");
  };

  const disconnectBle = () => {
    disconnectBlePrinter();
    setBleError("");
  };

  const connectBle = async () => {
    if (!supportsWebBluetooth()) {
      setBleError("Este navegador no permite conexión Bluetooth desde páginas web. En iPhone o iPad, abre Modo Pizzas desde Bluefy; en otros dispositivos usa la impresión original.");
      return;
    }

    setBleBusy(true);
    setBleError("");
    try {
      const status = await connectBlePrinter(selectedProfile);
      const connectedDeviceId = status.deviceId ?? status.deviceName ?? "unknown";
      const printerId = `${selectedProfile.id}:${connectedDeviceId}`;
      const printers = bluetoothConfiguration.printers.some((printer) => printer.id === printerId)
        ? bluetoothConfiguration.printers
        : [...bluetoothConfiguration.printers, {
          id: printerId,
          name: status.deviceName ?? selectedProfile.name,
          deviceId: connectedDeviceId,
          profileId: selectedProfile.id
        }];
      saveBluetoothConfiguration({
        ...bluetoothConfiguration,
        printers,
        defaultPrinterId: bluetoothConfiguration.defaultPrinterId ?? printerId
      });
      setProfileMessage(`${status.deviceName ?? selectedProfile.name} quedó registrada con el perfil ${selectedProfile.name}.`);
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
      setTestMessage(`Datos enviados por Bluetooth a ${bleStatus.deviceName ?? selectedProfile.name}. Confirma la salida física.`);
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
            <label className="field"><span>Método en este dispositivo</span><select onChange={(event) => { const next = event.target.value as DevicePrintMethod; setMethod(next); saveDevicePrintMethod(next); }} value={method}><option value="auto">Automático (Bluetooth si está disponible)</option><option value="bluetooth">Bluetooth</option><option value="browser">Impresión original</option></select></label>
            <input name="preferred_print_method" type="hidden" value="auto" />
          </div>
          <p className="muted">La preferencia se guarda solo en este navegador. Automático usa Bluetooth cuando este navegador permite seleccionar impresoras; selecciona Impresión original para abrir el diálogo del navegador.</p>
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
        <div className="section-title-row"><div><h2 id="ble-print-title">Impresión Bluetooth</h2><p className="muted">Busca cualquier dispositivo BLE, pero solo escribe en una impresora validada con el perfil seleccionado. No usa Wi-Fi ni modifica la impresión original.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>Perfil de comunicación</span><select onChange={(event) => selectProfile(event.target.value)} value={selectedProfileId}>{!bluetoothConfiguration.profiles.some((profile) => profile.id === selectedProfileId) ? <option value={selectedProfileId}>Nuevo perfil sin guardar</option> : null}{bluetoothConfiguration.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.builtIn ? " · preconfigurado" : ""}</option>)}</select></label>
          <label className="field"><span>Impresora predeterminada</span><select onChange={(event) => saveBluetoothConfiguration({ ...bluetoothConfiguration, defaultPrinterId: event.target.value || null })} value={bluetoothConfiguration.defaultPrinterId ?? ""}><option value="">Sin impresora registrada</option>{bluetoothConfiguration.printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name} · {bluetoothConfiguration.profiles.find((profile) => profile.id === printer.profileId)?.name ?? "Perfil no disponible"}</option>)}</select></label>
          <label className="field"><span>Protocolo validado</span><input disabled value={selectedProfile.protocol === "escpos" ? "ESC/POS · escritura permitida" : "RAW · escritura bloqueada por seguridad"} /></label>
        </div>
        <p className={`form-status ${bleSupported ? "success" : "error"}`}>{bleStatus.message}</p>
        {!hasSavedSelectedProfile ? <p className="field-hint">Guarda el nuevo perfil antes de conectar una impresora.</p> : null}
        {!bleSupported ? <p className="field-hint">Para conectar la impresora por Bluetooth, abre Modo Pizzas desde <a href="https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055" rel="noreferrer" target="_blank">Bluefy</a> en iPhone o iPad. En otros equipos, usa un navegador compatible o la impresión original.</p> : null}
        {bleError ? <p className="form-status error">{bleError}</p> : null}
        <div className="form-actions">
          <button className="primary-button" disabled={bleBusy || !hasSavedSelectedProfile} onClick={() => void connectBle()} type="button">{bleBusy ? <LoaderCircle className="spin" size={16} /> : <Bluetooth size={16} />} Conectar por Bluetooth</button>
          <button className="ghost-button" disabled={bleBusy || !bleStatus.connected} onClick={() => void handleBleTest()} type="button"><Printer size={16} /> Imprimir prueba Bluetooth</button>
          <button className="ghost-button" disabled={bleBusy || !bleStatus.connected} onClick={disconnectBle} type="button"><Unplug size={16} /> Desconectar</button>
        </div>
        <section className="settings-section">
          <div className="section-title-row"><div><h3>Perfil seleccionado</h3><p className="muted">El servicio y la característica se verifican antes de enviar comandos. Los perfiles RAW se guardan como referencia, pero esta integración solo imprime ESC/POS.</p></div><button className="ghost-button" onClick={() => { const profile = newBluetoothProfile(); setSelectedProfileId(profile.id); setProfileDraft(profile); setProfileMessage(""); }} type="button"><Plus size={16} /> Nuevo perfil</button></div>
          <div className="form-grid">
            <label className="field"><span>Nombre del perfil</span><input disabled={Boolean(profileDraft.builtIn)} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} value={profileDraft.name} /></label>
            <label className="field"><span>Protocolo</span><select disabled={Boolean(profileDraft.builtIn)} onChange={(event) => setProfileDraft({ ...profileDraft, protocol: event.target.value as BluetoothPrinterProfile["protocol"] })} value={profileDraft.protocol}><option value="escpos">ESC/POS</option><option value="raw">RAW</option></select></label>
            <label className="field"><span>UUID del servicio</span><input disabled={Boolean(profileDraft.builtIn)} onChange={(event) => setProfileDraft({ ...profileDraft, serviceUuid: event.target.value })} value={profileDraft.serviceUuid} /></label>
            <label className="field"><span>UUID de escritura</span><input disabled={Boolean(profileDraft.builtIn)} onChange={(event) => setProfileDraft({ ...profileDraft, writeCharacteristicUuid: event.target.value })} value={profileDraft.writeCharacteristicUuid} /></label>
            <label className="field"><span>Papel (mm)</span><input disabled={Boolean(profileDraft.builtIn)} max={120} min={40} onChange={(event) => setProfileDraft({ ...profileDraft, paperWidthMm: Number(event.target.value) })} type="number" value={profileDraft.paperWidthMm} /></label>
            <label className="field"><span>Ancho útil (mm)</span><input disabled={Boolean(profileDraft.builtIn)} max={110} min={30} onChange={(event) => setProfileDraft({ ...profileDraft, printableWidthMm: Number(event.target.value) })} type="number" value={profileDraft.printableWidthMm} /></label>
            <label className="field"><span>Fragmento BLE (bytes)</span><input disabled={Boolean(profileDraft.builtIn)} max={512} min={20} onChange={(event) => setProfileDraft({ ...profileDraft, chunkSize: Number(event.target.value) })} type="number" value={profileDraft.chunkSize} /></label>
            <label className="field"><span>Pausa entre fragmentos (ms)</span><input disabled={Boolean(profileDraft.builtIn)} max={500} min={0} onChange={(event) => setProfileDraft({ ...profileDraft, writeDelayMs: Number(event.target.value) })} type="number" value={profileDraft.writeDelayMs} /></label>
          </div>
          {profileMessage ? <p className="form-status success">{profileMessage}</p> : null}
          <div className="form-actions">
            <button className="primary-button" disabled={Boolean(profileDraft.builtIn)} onClick={saveProfile} type="button"><Save size={16} /> Guardar perfil</button>
            <button className="ghost-button" disabled={Boolean(selectedProfile.builtIn)} onClick={deleteProfile} type="button"><Trash2 size={16} /> Eliminar perfil</button>
          </div>
        </section>
        {bluetoothConfiguration.printers.length > 0 ? <section className="settings-section"><h3>Impresoras registradas en este navegador</h3><div className="compact-list">{bluetoothConfiguration.printers.map((printer) => <label className="field" key={printer.id}><span>{printer.id === bluetoothConfiguration.defaultPrinterId ? "Predeterminada" : "Impresora"}</span><input onChange={(event) => saveBluetoothConfiguration({ ...bluetoothConfiguration, printers: bluetoothConfiguration.printers.map((item) => item.id === printer.id ? { ...item, name: event.target.value } : item) })} value={printer.name} /></label>)}</div></section> : null}
      </section>
    </section>
  );
}
