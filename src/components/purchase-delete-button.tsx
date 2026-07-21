"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deletePurchase, type FormActionState } from "@/app/admin/actions";

const initialFormActionState: FormActionState = {
  status: "idle",
  message: ""
};

export function PurchaseDeleteButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(deletePurchase, initialFormActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <form
      action={formAction}
      className="inline-form product-delete-form"
      onSubmit={(event) => {
        if (!window.confirm("Eliminar esta compra? Solo se eliminara si no tiene historial, stock, costos ni relaciones.")) {
          event.preventDefault();
        }
      }}
    >
      <input name="purchase_id" type="hidden" value={id} />
      <PurchaseDeleteSubmitButton />
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}

function PurchaseDeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="icon-button danger-button" disabled={pending} title={pending ? "Eliminando..." : "Eliminar compra"} type="submit">
      <Trash2 size={16} />
    </button>
  );
}
