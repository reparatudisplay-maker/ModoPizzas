"use client";

export const JP58W_BLE_SERVICE_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
export const JP58W_BLE_WRITE_CHARACTERISTIC_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
const DEVICE_PRINT_METHOD_KEY = "modo-pizzas:thermal-print-method";
const BLUETOOTH_PRINTERS_KEY = "modo-pizzas:bluetooth-printers";
const DEFAULT_BLE_CHUNK_SIZE = 20;
const DEFAULT_BLE_WRITE_DELAY_MS = 24;

export type BluetoothPrinterProtocol = "escpos" | "raw";

export type BluetoothPrinterProfile = {
  id: string;
  name: string;
  serviceUuid: string;
  writeCharacteristicUuid: string;
  protocol: BluetoothPrinterProtocol;
  paperWidthMm: number;
  printableWidthMm: number;
  chunkSize: number;
  writeDelayMs: number;
  builtIn?: boolean;
};

export type RegisteredBluetoothPrinter = {
  id: string;
  name: string;
  deviceId: string;
  profileId: string;
};

export type BluetoothPrinterConfiguration = {
  profiles: BluetoothPrinterProfile[];
  printers: RegisteredBluetoothPrinter[];
  defaultPrinterId: string | null;
};

export const JP58W_BLUETOOTH_PROFILE: BluetoothPrinterProfile = {
  id: "jp58w-escpos",
  name: "JP58W / 58H",
  serviceUuid: JP58W_BLE_SERVICE_UUID,
  writeCharacteristicUuid: JP58W_BLE_WRITE_CHARACTERISTIC_UUID,
  protocol: "escpos",
  paperWidthMm: 58,
  printableWidthMm: 48,
  chunkSize: DEFAULT_BLE_CHUNK_SIZE,
  writeDelayMs: DEFAULT_BLE_WRITE_DELAY_MS,
  builtIn: true
};

export type DevicePrintMethod = "auto" | "bluetooth" | "browser";

type WritableBleCharacteristic = {
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
};

type BleDevice = {
  id?: string;
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
  requestDevice: (options: { acceptAllDevices: true; optionalServices: string[] }) => Promise<BleDevice>;
};

export type BlePrinterStatus = {
  connected: boolean;
  supported: boolean;
  deviceName: string | null;
  deviceId: string | null;
  profileId: string | null;
  profileName: string | null;
  message: string;
};

let device: BleDevice | null = null;
let characteristic: WritableBleCharacteristic | null = null;
let activeProfile: BluetoothPrinterProfile | null = null;
let disconnectListener: ((event: Event) => void) | null = null;
let writing = false;
let lastPayloadFingerprint = "";
let lastPayloadAt = 0;
const statusListeners = new Set<(status: BlePrinterStatus) => void>();

function normalizeUuid(value: string) {
  return value.trim().toLowerCase();
}

function isBluetoothUuid(value: string) {
  return /^[0-9a-f]{4}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function clampNumber(value: number, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function normalizeProfile(profile: BluetoothPrinterProfile): BluetoothPrinterProfile {
  return {
    ...profile,
    id: profile.id.trim(),
    name: profile.name.trim() || "Impresora Bluetooth",
    serviceUuid: normalizeUuid(profile.serviceUuid),
    writeCharacteristicUuid: normalizeUuid(profile.writeCharacteristicUuid),
    protocol: profile.protocol === "raw" ? "raw" : "escpos",
    paperWidthMm: clampNumber(profile.paperWidthMm, 40, 120, 58),
    printableWidthMm: clampNumber(profile.printableWidthMm, 30, 110, 48),
    chunkSize: clampNumber(profile.chunkSize, 20, 512, DEFAULT_BLE_CHUNK_SIZE),
    writeDelayMs: clampNumber(profile.writeDelayMs, 0, 500, DEFAULT_BLE_WRITE_DELAY_MS)
  };
}

export function validateBluetoothProfile(profile: BluetoothPrinterProfile) {
  const normalized = normalizeProfile(profile);
  if (!normalized.id) return "El perfil necesita un identificador.";
  if (!normalized.name) return "El perfil necesita un nombre.";
  if (!isBluetoothUuid(normalized.serviceUuid)) return "El UUID del servicio Bluetooth no es válido.";
  if (!isBluetoothUuid(normalized.writeCharacteristicUuid)) return "El UUID de la característica de escritura no es válido.";
  if (normalized.printableWidthMm > normalized.paperWidthMm) return "El ancho útil no puede superar el ancho del papel.";
  return null;
}

function normalizeConfiguration(configuration: Partial<BluetoothPrinterConfiguration> | null | undefined): BluetoothPrinterConfiguration {
  const customProfiles = (configuration?.profiles ?? [])
    .filter((profile) => profile?.id && profile.id !== JP58W_BLUETOOTH_PROFILE.id)
    .map(normalizeProfile);
  const profiles = [JP58W_BLUETOOTH_PROFILE, ...customProfiles];
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const printers = (configuration?.printers ?? [])
    .filter((printer) => printer?.id && printer.deviceId && profileIds.has(printer.profileId))
    .map((printer) => ({
      id: printer.id,
      name: printer.name.trim() || "Impresora Bluetooth",
      deviceId: printer.deviceId,
      profileId: printer.profileId
    }));
  const defaultPrinterId = printers.some((printer) => printer.id === configuration?.defaultPrinterId)
    ? configuration?.defaultPrinterId ?? null
    : printers[0]?.id ?? null;
  return { profiles, printers, defaultPrinterId };
}

export function getBluetoothPrinterConfiguration(): BluetoothPrinterConfiguration {
  if (typeof window === "undefined") return normalizeConfiguration(null);
  try {
    const stored = window.localStorage.getItem(BLUETOOTH_PRINTERS_KEY);
    return normalizeConfiguration(stored ? JSON.parse(stored) : null);
  } catch {
    return normalizeConfiguration(null);
  }
}

export function saveBluetoothPrinterConfiguration(configuration: BluetoothPrinterConfiguration) {
  const normalized = normalizeConfiguration(configuration);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(BLUETOOTH_PRINTERS_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function createBluetoothProfileId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `printer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDefaultBluetoothProfile(configuration = getBluetoothPrinterConfiguration()) {
  const defaultPrinter = configuration.printers.find((printer) => printer.id === configuration.defaultPrinterId);
  return configuration.profiles.find((profile) => profile.id === defaultPrinter?.profileId) ?? JP58W_BLUETOOTH_PROFILE;
}

function ensureEscPosProfile(profile: BluetoothPrinterProfile) {
  if (profile.protocol !== "escpos") {
    throw new Error(`El perfil ${profile.name} usa protocolo RAW. Por seguridad, esta versión solo envía ESC/POS a perfiles validados.`);
  }
}

function getWebBluetooth(): WebBluetooth | null {
  if (typeof navigator === "undefined") return null;

  const bluetooth = (navigator as Navigator & { bluetooth?: Partial<WebBluetooth> }).bluetooth;
  return bluetooth && typeof bluetooth.requestDevice === "function"
    ? (bluetooth as WebBluetooth)
    : null;
}

export function supportsWebBluetooth() {
  return getWebBluetooth() !== null;
}

export function getDevicePrintMethod(): DevicePrintMethod {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(DEVICE_PRINT_METHOD_KEY);
  return stored === "bluetooth" || stored === "browser" ? stored : "auto";
}

export function saveDevicePrintMethod(method: DevicePrintMethod) {
  if (typeof window !== "undefined") window.localStorage.setItem(DEVICE_PRINT_METHOD_KEY, method);
}

export function shouldUseBlePrinter() {
  const method = getDevicePrintMethod();
  if (method === "browser") return false;
  return supportsWebBluetooth();
}

function currentStatus(): BlePrinterStatus {
  const connected = Boolean(device?.gatt?.connected && characteristic);
  return {
    supported: supportsWebBluetooth(),
    connected,
    deviceName: connected ? device?.name ?? activeProfile?.name ?? "Impresora Bluetooth" : null,
    deviceId: connected ? device?.id ?? null : null,
    profileId: connected ? activeProfile?.id ?? null : null,
    profileName: connected ? activeProfile?.name ?? null : null,
    message: connected
      ? `Conectada a ${device?.name ?? activeProfile?.name ?? "la impresora"} con el perfil ${activeProfile?.name ?? "Bluetooth"}.`
      : supportsWebBluetooth()
        ? "Sin impresora Bluetooth conectada."
        : "Este navegador no permite conexión Bluetooth desde páginas web."
  };
}

function notifyStatus() {
  const status = currentStatus();
  statusListeners.forEach((listener) => listener(status));
}

export function getBlePrinterStatus() {
  return currentStatus();
}

export function subscribeBlePrinterStatus(listener: (status: BlePrinterStatus) => void) {
  statusListeners.add(listener);
  listener(currentStatus());
  return () => {
    statusListeners.delete(listener);
  };
}

function describeBleError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotFoundError") return "No se seleccionó una impresora Bluetooth.";
  if (error instanceof DOMException && error.name === "SecurityError") return "El navegador no permitió el acceso Bluetooth. Revisa sus permisos.";
  if (error instanceof DOMException && error.name === "NotSupportedError") return "Este navegador no permite seleccionar impresoras Bluetooth desde páginas web. Usa la impresión original.";
  if (error instanceof Error) return error.message;
  return "No se pudo completar la operación Bluetooth.";
}

export function getBleErrorMessage(error: unknown) {
  return describeBleError(error);
}

export async function connectBlePrinter(profile = getDefaultBluetoothProfile()) {
  const bluetooth = getWebBluetooth();
  if (!bluetooth) throw new Error("Este navegador no permite conexión Bluetooth desde páginas web. En iPhone o iPad, abre Modo Pizzas desde Bluefy; en otros dispositivos usa la impresión original.");
  const profileError = validateBluetoothProfile(profile);
  if (profileError) throw new Error(profileError);
  const normalizedProfile = normalizeProfile(profile);
  ensureEscPosProfile(normalizedProfile);
  if (device?.gatt?.connected && characteristic && activeProfile?.id === normalizedProfile.id) return currentStatus();
  if (device?.gatt?.connected) disconnectBlePrinter();

  const nextDevice = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [normalizedProfile.serviceUuid]
  });
  const server = await nextDevice.gatt?.connect();
  if (!server) throw new Error("La impresora no permitió una conexión GATT.");
  let nextCharacteristic: WritableBleCharacteristic;
  try {
    const service = await server.getPrimaryService(normalizedProfile.serviceUuid);
    nextCharacteristic = await service.getCharacteristic(normalizedProfile.writeCharacteristicUuid);
  } catch {
    if (nextDevice.gatt?.connected) nextDevice.gatt.disconnect();
    throw new Error(`La impresora seleccionada no coincide con el perfil ${normalizedProfile.name}. Verifica el servicio y la característica de escritura antes de imprimir.`);
  }

  if (device && disconnectListener) device.removeEventListener("gattserverdisconnected", disconnectListener);
  device = nextDevice;
  characteristic = nextCharacteristic;
  activeProfile = normalizedProfile;
  disconnectListener = () => {
    characteristic = null;
    device = null;
    activeProfile = null;
    disconnectListener = null;
    notifyStatus();
  };
  device.addEventListener("gattserverdisconnected", disconnectListener);
  notifyStatus();
  return currentStatus();
}

export function disconnectBlePrinter() {
  if (device && disconnectListener) device.removeEventListener("gattserverdisconnected", disconnectListener);
  if (device?.gatt?.connected) device.gatt.disconnect();
  device = null;
  characteristic = null;
  activeProfile = null;
  disconnectListener = null;
  notifyStatus();
}

function toPrinterAscii(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/gi, (character) => character === "Ñ" ? "N" : "n")
    .replace(/[^\x20-\x7E\n]/g, "");
}

function wrapThermalLine(line: string, width = 32) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const rows: string[] = [];
  let row = "";
  for (const word of words) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && candidate.length > width) {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(row);
  return rows;
}

type BlePrintOptions = {
  connectIfNeeded?: boolean;
  leadingBlankLines?: number;
  trailingBlankLines?: number;
};

function feedLines(lines: number) {
  return [0x1b, 0x64, Math.max(0, Math.min(20, Math.round(lines)))];
}

function templateElementBytes(element: HTMLElement) {
  const encoder = new TextEncoder();
  const alignment = element.dataset.printAlign === "center" ? 1 : element.dataset.printAlign === "right" ? 2 : 0;
  const fontSize = element.dataset.printFontSize === "large" ? 0x10 : 0;
  const bold = element.dataset.printBold === "true" ? 1 : 0;
  const underline = element.dataset.printUnderline === "true" ? 1 : 0;
  const spacingAfter = Math.max(0, Math.min(8, Math.round(Number(element.dataset.printSpacingAfter ?? 0))));
  const text = element.querySelector(".print-template-separator")
    ? "--------------------------------"
    : toPrinterAscii(element.innerText);
  const lines = text.split(/\r?\n/).flatMap((line) => wrapThermalLine(line));
  return [0x1b, 0x61, alignment, 0x1b, 0x45, bold, 0x1b, 0x2d, underline, 0x1b, 0x21, fontSize, ...encoder.encode(`${lines.join("\n")}\n${"\n".repeat(spacingAfter)}`), 0x1b, 0x45, 0x00, 0x1b, 0x2d, 0x00, 0x1b, 0x21, 0x00];
}

export function buildBleThermalPayload(documents: HTMLElement[], options: BlePrintOptions = {}) {
  const body = documents.flatMap((document) => {
    const templateElements = Array.from(document.querySelectorAll<HTMLElement>(".print-template-element"));
    if (templateElements.length > 0) return templateElements.flatMap(templateElementBytes);
    const text = toPrinterAscii(document.innerText).split(/\r?\n/).flatMap((line) => wrapThermalLine(line)).join("\n");
    return [...new TextEncoder().encode(`${text}\n`)];
  });
  const leading = Math.max(0, Math.min(20, Math.round(options.leadingBlankLines ?? Number(documents[0]?.dataset.thermalLeadingBlankLines ?? 0))));
  const trailing = Math.max(0, Math.min(20, Math.round(options.trailingBlankLines ?? Number(documents[0]?.dataset.thermalTrailingBlankLines ?? 3))));
  return new Uint8Array([0x1b, 0x40, ...feedLines(leading), ...body, ...feedLines(trailing)]);
}

export function buildBleTestPayload() {
  const text = new TextEncoder().encode("MODO PIZZAS - PRUEBA BLUETOOTH\nJP58W / 58 mm\n\n");
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, ...text, 0x1b, 0x45, 0x00, 0x1b, 0x61, 0x00, 0x1b, 0x64, 0x03]);
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function writeBlePayload(payload: Uint8Array) {
  if (!characteristic || !device?.gatt?.connected) throw new Error("Conecta primero la impresora Bluetooth.");
  if (!activeProfile) throw new Error("No hay un perfil Bluetooth validado para esta impresora.");
  ensureEscPosProfile(activeProfile);
  if (writing) throw new Error("Ya hay una impresión Bluetooth en curso.");
  const fingerprint = Array.from(payload.slice(0, 24)).join(",") + `:${payload.length}`;
  if (fingerprint === lastPayloadFingerprint && Date.now() - lastPayloadAt < 1500) {
    throw new Error("Se evitó una impresión Bluetooth duplicada.");
  }

  const write = typeof characteristic.writeValueWithoutResponse === "function"
    ? characteristic.writeValueWithoutResponse.bind(characteristic)
    : typeof characteristic.writeValueWithResponse === "function"
      ? characteristic.writeValueWithResponse.bind(characteristic)
      : typeof characteristic.writeValue === "function"
        ? characteristic.writeValue.bind(characteristic)
        : null;
  if (!write) throw new Error("La impresora no permite escritura Bluetooth en este navegador.");

  writing = true;
  try {
    for (let offset = 0; offset < payload.length; offset += activeProfile.chunkSize) {
      await write(payload.slice(offset, offset + activeProfile.chunkSize));
      if (activeProfile.writeDelayMs > 0) await pause(activeProfile.writeDelayMs);
    }
    lastPayloadFingerprint = fingerprint;
    lastPayloadAt = Date.now();
  } finally {
    writing = false;
  }
}

export async function printBleTest() {
  await writeBlePayload(buildBleTestPayload());
}

export async function printBleThermalDocuments(documents: HTMLElement[], options: BlePrintOptions = {}) {
  if ((!device?.gatt?.connected || !characteristic) && options.connectIfNeeded) await connectBlePrinter();
  await writeBlePayload(buildBleThermalPayload(documents, options));
  return `Datos enviados por Bluetooth a ${activeProfile?.name ?? "la impresora"}. Confirma la salida física.`;
}
