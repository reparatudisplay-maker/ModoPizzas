"use client";

export const JP58W_BLE_SERVICE_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
export const JP58W_BLE_WRITE_CHARACTERISTIC_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
const BLE_CHUNK_SIZE = 20;
const BLE_WRITE_DELAY_MS = 24;
const DEVICE_PRINT_METHOD_KEY = "modo-pizzas:thermal-print-method";

export type DevicePrintMethod = "auto" | "bluetooth" | "browser";

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

export type BlePrinterStatus = {
  connected: boolean;
  supported: boolean;
  deviceName: string | null;
  message: string;
};

let device: BleDevice | null = null;
let characteristic: WritableBleCharacteristic | null = null;
let disconnectListener: ((event: Event) => void) | null = null;
let writing = false;
let lastPayloadFingerprint = "";
let lastPayloadAt = 0;
const statusListeners = new Set<(status: BlePrinterStatus) => void>();

function getWebBluetooth(): WebBluetooth | null {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) return null;
  return (navigator as Navigator & { bluetooth?: WebBluetooth }).bluetooth ?? null;
}

export function supportsWebBluetooth() {
  return getWebBluetooth() !== null;
}

function isLikelyMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
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
  if (method === "bluetooth") return supportsWebBluetooth();
  return supportsWebBluetooth() && isLikelyMobileBrowser();
}

function currentStatus(): BlePrinterStatus {
  const connected = Boolean(device?.gatt?.connected && characteristic);
  return {
    supported: supportsWebBluetooth(),
    connected,
    deviceName: connected ? device?.name ?? "JP58W" : null,
    message: connected
      ? `Conectada a ${device?.name ?? "JP58W"}. Característica de escritura lista.`
      : supportsWebBluetooth()
        ? "Sin impresora Bluetooth conectada."
        : "Web Bluetooth no está disponible en este navegador."
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
  if (error instanceof Error) return error.message;
  return "No se pudo completar la operación Bluetooth.";
}

export function getBleErrorMessage(error: unknown) {
  return describeBleError(error);
}

export async function connectBlePrinter() {
  const bluetooth = getWebBluetooth();
  if (!bluetooth) throw new Error("Este navegador no ofrece Web Bluetooth. Usa el método de impresión original.");
  if (device?.gatt?.connected && characteristic) return currentStatus();

  const nextDevice = await bluetooth.requestDevice({
    filters: [{ services: [JP58W_BLE_SERVICE_UUID] }],
    optionalServices: [JP58W_BLE_SERVICE_UUID]
  });
  const server = await nextDevice.gatt?.connect();
  if (!server) throw new Error("La impresora no permitió una conexión GATT.");
  const service = await server.getPrimaryService(JP58W_BLE_SERVICE_UUID);
  const nextCharacteristic = await service.getCharacteristic(JP58W_BLE_WRITE_CHARACTERISTIC_UUID);

  if (device && disconnectListener) device.removeEventListener("gattserverdisconnected", disconnectListener);
  device = nextDevice;
  characteristic = nextCharacteristic;
  disconnectListener = () => {
    characteristic = null;
    device = null;
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

export function buildBleThermalPayload(documents: HTMLElement[]) {
  const body = documents
    .flatMap((document) => toPrinterAscii(document.innerText).split(/\r?\n/).flatMap((line) => wrapThermalLine(line)))
    .join("\n");
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00, ...new TextEncoder().encode(`${body}\n\n\n`), 0x1b, 0x64, 0x03]);
}

export function buildBleTestPayload() {
  const text = new TextEncoder().encode("MODO PIZZAS - PRUEBA BLUETOOTH\nJP58W / 58 mm\n\n");
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, ...text, 0x1b, 0x45, 0x00, 0x1b, 0x61, 0x00, 0x1b, 0x64, 0x03]);
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function writeBlePayload(payload: Uint8Array) {
  if (!characteristic || !device?.gatt?.connected) throw new Error("Conecta primero la impresora Bluetooth.");
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
  if (!write) throw new Error("La característica BLE no admite escritura en este navegador.");

  writing = true;
  try {
    for (let offset = 0; offset < payload.length; offset += BLE_CHUNK_SIZE) {
      await write(payload.slice(offset, offset + BLE_CHUNK_SIZE));
      await pause(BLE_WRITE_DELAY_MS);
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

export async function printBleThermalDocuments(documents: HTMLElement[], options: { connectIfNeeded?: boolean } = {}) {
  if ((!device?.gatt?.connected || !characteristic) && options.connectIfNeeded) await connectBlePrinter();
  await writeBlePayload(buildBleThermalPayload(documents));
  return "Datos enviados por Bluetooth. Confirma la salida física en la JP58W.";
}
