"use client";

import { useEffect } from "react";

function canDragModal() {
  return window.innerWidth >= 768 && window.matchMedia("(pointer: fine)").matches;
}

function shouldIgnoreDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  return Boolean(target.closest("button, input, select, textarea, a, label, [data-modal-drag-ignore='true']"));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ModalDragController() {
  useEffect(() => {
    let panel: HTMLElement | null = null;
    let captureTarget: HTMLElement | null = null;
    let pointerId: number | null = null;
    let offsetX = 0;
    let offsetY = 0;

    function stopDragging() {
      if (panel) {
        panel.classList.remove("is-dragging-modal");
        if (pointerId !== null && captureTarget?.hasPointerCapture?.(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      }
      panel = null;
      captureTarget = null;
      pointerId = null;
    }

    function onPointerMove(event: PointerEvent) {
      if (!panel || pointerId !== event.pointerId) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
      panel.style.left = `${clamp(event.clientX - offsetX, margin, maxLeft)}px`;
      panel.style.top = `${clamp(event.clientY - offsetY, margin, maxTop)}px`;
    }

    function onPointerDown(event: PointerEvent) {
      if (!canDragModal() || event.button !== 0 || shouldIgnoreDrag(event.target)) return;
      const header = (event.target as HTMLElement).closest<HTMLElement>(".modal-header");
      const modalPanel = header?.closest<HTMLElement>(".modal-panel");
      if (!header || !modalPanel) return;

      const rect = modalPanel.getBoundingClientRect();
      panel = modalPanel;
      captureTarget = event.target instanceof HTMLElement ? event.target : modalPanel;
      pointerId = event.pointerId;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;

      modalPanel.style.position = "fixed";
      modalPanel.style.left = `${rect.left}px`;
      modalPanel.style.top = `${rect.top}px`;
      modalPanel.style.margin = "0";
      modalPanel.style.transform = "none";
      modalPanel.classList.add("is-draggable-modal", "is-dragging-modal");
      captureTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  return null;
}
