export type PublicLegalDocument = {
  title: string;
  summary: string;
  sections: Array<{ heading: string; body: string }>;
};

const pendingReview = "Este contenido base debe revisarse y ajustarse jurídicamente antes de considerarse una política definitiva.";

export const publicLegalDocuments: Record<string, PublicLegalDocument> = {
  "tratamiento-datos": { title: "Politica de Tratamiento de Datos", summary: pendingReview, sections: [{ heading: "Finalidad", body: "ModoPizzas utiliza los datos de contacto que la persona comparte para atender pedidos, responder solicitudes y prestar el servicio solicitado." }, { heading: "Consultas", body: "Para solicitudes relacionadas con datos personales, utiliza los canales de contacto publicados en esta web." }] },
  terminos: { title: "Terminos y Condiciones", summary: pendingReview, sections: [{ heading: "Pedidos", body: "La disponibilidad, los precios y los tiempos de atención se confirman al gestionar cada pedido." }, { heading: "Contacto", body: "Al enviar un pedido por WhatsApp, la información se comparte para que ModoPizzas pueda continuar la atención." }] },
  "reversion-pagos": { title: "Reversion de Pagos", summary: pendingReview, sections: [{ heading: "Solicitudes", body: "Las solicitudes relacionadas con reversión de pagos se revisarán según el medio de pago utilizado y la normativa aplicable." }, { heading: "Canal", body: "Para iniciar una solicitud, comunícate por los canales de contacto publicados por ModoPizzas." }] },
  alergenos: { title: "Politica de Alergenos", summary: pendingReview, sections: [{ heading: "Ingredientes", body: "Los productos se preparan en un entorno donde pueden manipularse ingredientes con potencial alergénico." }, { heading: "Recomendación", body: "Antes de pedir, informa cualquier alergia o restricción alimentaria para recibir orientación sobre el producto." }] },
  "sugerencias-reclamos": { title: "Sugerencias y Reclamos", summary: pendingReview, sections: [{ heading: "Atención", body: "ModoPizzas recibe sugerencias, peticiones, quejas y reclamos por los canales de contacto publicados en esta página." }] },
  privacidad: { title: "Aviso de Privacidad", summary: pendingReview, sections: [{ heading: "Información compartida", body: "Los datos que se suministran durante una consulta o pedido se tratan para gestionar la solicitud realizada." }] }
};
