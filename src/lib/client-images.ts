"use client";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const originalImageMaxBytes = 4 * 1024 * 1024;
const optimizedImageMaxBytes = 400 * 1024;
const maxImageSide = 512;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function optimizedFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "imagen";
  return `${baseName}.webp`;
}

function assignFileToInput(input: HTMLInputElement, file: File) {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
}

async function readImage(file: File) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

export async function optimizeImageInput(input: HTMLInputElement) {
  const file = input.files?.[0] ?? null;
  if (!file) return { file: null, previewUrl: "", error: "" };

  if (!allowedImageTypes.has(file.type)) {
    input.value = "";
    return { file: null, previewUrl: "", error: "No se puede cargar la imagen. Usa JPG, JPEG, PNG o WebP." };
  }

  if (file.size > originalImageMaxBytes) {
    input.value = "";
    return { file: null, previewUrl: "", error: "La imagen supera el máximo permitido de 4 MB." };
  }

  const bitmap = await readImage(file);
  const scale = Math.min(1, maxImageSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    input.value = "";
    return { file: null, previewUrl: "", error: "No fue posible procesar la imagen." };
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let optimizedBlob: Blob | null = null;
  for (let quality = 0.8; quality >= 0.55; quality -= 0.05) {
    const blob = await canvasToBlob(canvas, Number(quality.toFixed(2)));
    if (!blob) continue;
    optimizedBlob = blob;
    if (blob.size <= optimizedImageMaxBytes) break;
  }

  if (!optimizedBlob || optimizedBlob.size > optimizedImageMaxBytes) {
    input.value = "";
    return {
      file: null,
      previewUrl: "",
      error: "No fue posible optimizar la imagen por debajo de 400 KB. Selecciona una imagen más pequeña."
    };
  }

  const optimizedFile = new File([optimizedBlob], optimizedFileName(file.name), { type: "image/webp" });
  assignFileToInput(input, optimizedFile);
  return { file: optimizedFile, previewUrl: URL.createObjectURL(optimizedFile), error: "" };
}
