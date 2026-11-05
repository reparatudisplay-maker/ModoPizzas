"use client";

import { useActionState } from "react";
import { regularizePendingInventoryDebts, type FormActionState } from "@/app/admin/actions";

const initialState: FormActionState = { status: "idle", message: "" };

export function PendingInventoryRegularizationAction({ pendingCount }: { pendingCount: number }) {
  const [state, formAction, isPending] = useActionState(regularizePendingInventoryDebts, initialState);
  if (!pendingCount && state.status !== "success") return null;

  return (
    <form action={formAction} className="pending-inventory-regularization-action">
      {pendingCount ? <small>{pendingCount} faltantes pendientes</small> : null}
      <button className="secondary-button" disabled={isPending || !pendingCount} type="submit">
        {isPending ? "Regularizando..." : "Regularizar faltantes"}
      </button>
      {state.message ? <p className={state.status === "error" ? "alert" : "success-message"}>{state.message}</p> : null}
    </form>
  );
}
