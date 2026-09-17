export type PublicLegalBusiness = {
  business_name?: string | null;
  public_address?: string | null;
  public_neighborhood?: string | null;
  public_city?: string | null;
  public_phone?: string | null;
  whatsapp_number?: string | null;
  public_email?: string | null;
  legal_contact_email?: string | null;
  public_maps_url?: string | null;
  public_opening_hours?: Array<{ day: string; is_open: boolean; opens_at: string; closes_at: string }> | null;
};

export type PublicLegalDocument = {
  title: string;
  summary: string;
  updatedAt: string;
  sections: Array<{
    heading: string;
    body: string[];
    action?: { label: string; href: string; external?: boolean };
    actions?: Array<{ label: string; href: string; external?: boolean }>;
  }>;
};

export const publicLegalSlugs = ["informacion", "tratamiento-datos", "terminos", "reversion-pagos", "alergenos", "sugerencias-reclamos", "privacidad", "sic"] as const;

const updatedAt = "17 de septiembre de 2026";
const knownEmail = "modopizzasmedellin@gmail.com";
const knownAddress = "Cl. 49 #41-90, La Candelaria, Medellín, Antioquia";

function clean(value?: string | null) {
  return value?.trim() || "";
}

function businessName(business: PublicLegalBusiness) {
  return clean(business.business_name).replace(/\bModoPizzas\b/gi, "Modo Pizzas") || "Modo Pizzas";
}

function address(business: PublicLegalBusiness) {
  const configured = [business.public_address, business.public_neighborhood, business.public_city].map(clean).filter(Boolean).join(", ");
  return configured || knownAddress;
}

function phone(business: PublicLegalBusiness) {
  return clean(business.public_phone) || clean(business.whatsapp_number) || "+57 317 0135775";
}

function email(business: PublicLegalBusiness) {
  return clean(business.legal_contact_email) || clean(business.public_email) || knownEmail;
}

function contactLine(business: PublicLegalBusiness) {
  return `Correo: ${email(business)} · WhatsApp: ${phone(business)} · Dirección: ${address(business)}.`;
}

function whatsappUrl(business: PublicLegalBusiness) {
  const digits = phone(business).replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function hoursText(business: PublicLegalBusiness) {
  const hours = business.public_opening_hours ?? [];
  if (!hours.length) return "Horarios por confirmar.";
  return hours.map((hour) => `${hour.day}: ${hour.is_open ? `${hour.opens_at} a ${hour.closes_at}` : "cerrado"}`).join(" · ");
}

export function buildPublicLegalDocument(slug: string, business: PublicLegalBusiness): PublicLegalDocument | null {
  const name = businessName(business);
  const commonIdentity = `${name}. ${contactLine(business)}`;

  const documents: Record<string, PublicLegalDocument> = {
    informacion: {
      title: "INFORMACIÓN DEL ESTABLECIMIENTO",
      summary: "Datos públicos de atención, ubicación y contacto de Modo Pizzas.",
      updatedAt,
      sections: [
        {
          heading: name.toUpperCase(),
          body: [`Dirección: ${address(business)}`, `WhatsApp: ${phone(business)}`, `Correo: ${email(business)}`, `Horarios: ${hoursText(business)}`],
          actions: [
            ...(clean(business.public_maps_url) ? [{ label: "Cómo llegar", href: clean(business.public_maps_url), external: true }] : []),
            ...(whatsappUrl(business) ? [{ label: "Escribir por WhatsApp", href: whatsappUrl(business), external: true }] : []),
            { label: "Enviar correo", href: `mailto:${email(business)}` }
          ]
        },
        { heading: "Canales oficiales", body: [contactLine(business)] }
      ]
    },
    "tratamiento-datos": {
      title: "POLÍTICA DE TRATAMIENTO DE DATOS PERSONALES",
      summary: `${name} adopta esta política para informar el tratamiento de datos personales en sus actividades comerciales y digitales, conforme al régimen colombiano de protección de datos personales.`,
      updatedAt,
      sections: [
        { heading: "Responsable", body: [commonIdentity] },
        { heading: "Objeto", body: [`${name} informa cómo recolecta, usa, conserva y protege los datos personales necesarios para gestionar pedidos, atención al cliente y obligaciones legales.`] },
        { heading: "Datos que podemos tratar", body: ["Nombre, teléfono, correo electrónico, dirección de entrega, información asociada al pedido, historial de pedidos o reclamaciones, comunicaciones con el establecimiento e información estrictamente necesaria para gestionar pagos cuando corresponda. No almacenamos números completos de tarjetas si el pago no es procesado directamente por nosotros."] },
        { heading: "Finalidades", body: ["Recibir, confirmar y preparar pedidos; coordinar recogida o domicilio; contactar al cliente sobre su pedido; atender solicitudes, reclamaciones y PQRS; gestionar garantías, devoluciones o reversión cuando proceda; cumplir obligaciones contables, fiscales y legales; prevenir fraude o uso indebido; mejorar el servicio y mantener trazabilidad comercial. Las comunicaciones comerciales se enviarán solo cuando exista una base jurídica o autorización válida, sin condicionar la compra a aceptar publicidad."] },
        { heading: "Autorización y derechos del titular", body: ["Cuando la ley lo requiera, se solicitará autorización previa, expresa e informada, salvo excepciones legales. El titular puede conocer, actualizar, rectificar, solicitar prueba de autorización, conocer el uso de sus datos, presentar consultas y reclamos, solicitar supresión cuando proceda, revocar la autorización cuando legalmente sea posible, acceder gratuitamente a sus datos y acudir ante la SIC cuando corresponda."] },
        { heading: "Procedimiento", body: [`Las consultas o reclamos pueden enviarse a ${email(business)} indicando nombre, identificación suficiente del titular, descripción de la solicitud, datos de contacto y soportes si existen. Responderemos dentro de los términos establecidos por la legislación colombiana aplicable.`] },
        { heading: "Encargados, seguridad y conservación", body: ["Podemos utilizar proveedores tecnológicos necesarios para alojamiento, comunicaciones, procesamiento del pedido y operación del servicio, sujetos a medidas apropiadas. Aplicamos medidas administrativas, técnicas y organizacionales razonables, sin prometer seguridad absoluta. Los datos se conservarán durante el tiempo necesario para las finalidades informadas y obligaciones legales aplicables."] },
        { heading: "Contacto y vigencia", body: [contactLine(business), "Las modificaciones sustanciales serán informadas por los medios legalmente aplicables."] }
      ]
    },
    terminos: {
      title: "TÉRMINOS Y CONDICIONES DE USO Y COMPRA",
      summary: "Condiciones aplicables al uso de la web pública y a las solicitudes de pedido realizadas por canales digitales.",
      updatedAt,
      sections: [
        { heading: "Identificación y alcance", body: [commonIdentity, "La web permite consultar menú, precios, productos y preparar una solicitud de pedido."] },
        { heading: "Pedidos por WhatsApp", body: ["El envío del carrito a WhatsApp constituye una solicitud de pedido. La venta se entiende confirmada cuando Modo Pizzas acepta o confirma el pedido por el canal correspondiente, después de verificar disponibilidad, cobertura, dirección, forma de pago, capacidad operativa y condiciones especiales."] },
        { heading: "Precios, disponibilidad y promociones", body: ["Los precios se expresan en pesos colombianos (COP). El domicilio, cuando aplique, debe informarse separadamente y no se aplicarán cargos ocultos. Los pedidos están sujetos a disponibilidad real de ingredientes y productos. Si se detecta indisponibilidad, contactaremos al cliente para ofrecer alternativa, modificación o cancelación/reembolso cuando corresponda. Las promociones se sujetan a vigencia, cobertura, disponibilidad y condiciones específicas anunciadas."] },
        { heading: "Fotografías y personalizaciones", body: ["Las fotografías son representación del producto; puede existir variación razonable por preparación artesanal, sin limitar derechos por falta de calidad, idoneidad o producto diferente al solicitado. Las modificaciones solicitadas quedan sujetas a viabilidad y disponibilidad."] },
        { heading: "Entrega y datos del cliente", body: ["Los tiempos informados son estimados y pueden variar por demanda, tráfico, clima, disponibilidad o situaciones operativas. El cliente debe suministrar información suficiente y correcta para entrega y contacto."] },
        { heading: "Cancelación y retracto", body: ["Mientras el pedido no haya iniciado preparación, se podrá gestionar la solicitud de cancelación. Cuando el alimento ya haya comenzado a prepararse o sea personalizado/perecedero, aplicarán las reglas legales correspondientes. La legislación colombiana contempla excepciones al retracto para bienes personalizados, perecederos o que pueden deteriorarse rápidamente; esto no elimina derechos cuando el producto no corresponde al pedido, presenta problemas de calidad/idoneidad/seguridad o se configura otra obligación legal."] },
        { heading: "Propiedad intelectual, responsabilidad y ley aplicable", body: ["Marca, material gráfico y contenidos de Modo Pizzas no pueden reproducirse comercialmente sin autorización, salvo usos permitidos por ley. Modo Pizzas no responde por información incorrecta suministrada por el cliente ni por hechos externos demostrables fuera de su control, en la medida permitida por ley. Aplica la ley de la República de Colombia."] }
      ]
    },
    "reversion-pagos": {
      title: "REVERSIÓN DE PAGOS",
      summary: "Procedimiento para solicitar reversión cuando se cumplan los presupuestos previstos por la legislación colombiana.",
      updatedAt,
      sections: [
        { heading: "Alcance", body: ["La reversión legal aplica cuando se cumplen los presupuestos previstos para operaciones realizadas mediante mecanismos de comercio electrónico y utilizando un instrumento de pago electrónico. Puede proceder por fraude, operación no solicitada, producto no recibido, producto distinto a lo solicitado o producto defectuoso, incluso de forma parcial cuando corresponda."] },
        { heading: "Procedimiento", body: [`Para eventos regulados por el artículo 51 de la Ley 1480 y el Decreto 587 de 2016, el consumidor debe presentar la reclamación dentro del término legal aplicable de cinco (5) días hábiles, contado según la causal, ante el proveedor y notificar al emisor del instrumento de pago cuando la norma lo exige. Canal Modo Pizzas: ${email(business)}.`] },
        { heading: "Información sugerida", body: ["Nombre, número o código de pedido, fecha, causal, valor reclamado, medio de pago, descripción de los hechos y evidencia si existe. Modo Pizzas emitirá constancia de recepción de la reclamación."] },
        { heading: "Aclaraciones", body: ["La reversión legal involucra también al emisor y participantes del instrumento de pago. Los pagos presenciales no se presentan como sujetos al mismo procedimiento si la regulación no aplica. Ninguna condición de esta página reduce derechos legales del consumidor."] }
      ]
    },
    alergenos: {
      title: "INFORMACIÓN SOBRE ALÉRGENOS",
      summary: "Información para clientes con alergias, sensibilidades o restricciones alimentarias.",
      updatedAt,
      sections: [
        { heading: "Ingredientes y contacto cruzado", body: ["Los productos pueden contener o haber estado en contacto con ingredientes que contienen alérgenos, incluyendo gluten/trigo, leche y derivados, y otros alérgenos que estén presentes en ingredientes, salsas, embutidos o productos utilizados."] },
        { heading: "Cocina compartida", body: ["Los alimentos son preparados en una cocina compartida, por lo que, aunque se adopten prácticas de manipulación razonables, no podemos garantizar ausencia absoluta de trazas o contaminación cruzada. Solicitar quitar un ingrediente no garantiza eliminar trazas."] },
        { heading: "Recomendación", body: ["Si tienes una alergia alimentaria, comunícala antes de confirmar el pedido. Para alergias graves, consulta antes de consumir si existe duda sobre composición o riesgo de contacto cruzado. Esta información no exonera deberes legales de seguridad alimentaria."] }
      ]
    },
    "sugerencias-reclamos": {
      title: "SUGERENCIAS, PETICIONES Y RECLAMOS",
      summary: "Queremos conocer tu experiencia. Si tienes una sugerencia, inconformidad o reclamo relacionado con un pedido, puedes escribirnos.",
      updatedAt,
      sections: [
        { heading: "Canales", body: [`Correo principal: ${email(business)}`, `WhatsApp: ${phone(business)}`], action: { label: "Enviar correo", href: `mailto:${email(business)}` } },
        { heading: "Información útil para reclamos", body: ["Nombre, código de pedido, fecha, teléfono o correo, descripción y fotografías o soportes cuando resulten relevantes. La solicitud será atendida dentro de los términos legalmente aplicables y no se exigirán pruebas imposibles como condición para recibir el reclamo."] }
      ]
    },
    privacidad: {
      title: "AVISO DE PRIVACIDAD",
      summary: `${name} informa que los datos personales suministrados al realizar pedidos, comunicarse con nosotros o utilizar nuestros canales serán tratados para gestionar pedidos, entregas, atención al cliente, reclamaciones y obligaciones legales.`,
      updatedAt,
      sections: [
        { heading: "Responsable y finalidades", body: [commonIdentity, "Los datos se tratan para gestionar pedidos, entregas, atención al cliente, reclamaciones y obligaciones legales."] },
        { heading: "Derechos y canal", body: [`El titular puede conocer, actualizar, rectificar, solicitar supresión o revocar autorización cuando proceda y ejercer los demás derechos legales por medio de ${email(business)}.`], action: { label: "Consultar Política de Tratamiento de Datos", href: "/legal/tratamiento-datos" } },
        { heading: "Comunicaciones promocionales", body: ["Cuando exista una opción de comunicaciones promocionales, debe ser independiente y no preseleccionada."] }
      ]
    },
    sic: {
      title: "SUPERINTENDENCIA DE INDUSTRIA Y COMERCIO - SIC",
      summary: "La Superintendencia de Industria y Comercio es la autoridad nacional que ejerce funciones en materia de protección al consumidor y protección de datos personales, entre otras.",
      updatedAt,
      sections: [
        { heading: "Sitio oficial", body: ["Este enlace dirige al portal oficial de la SIC. No corresponde a una página propia de Modo Pizzas."], action: { label: "Visitar sitio oficial de la SIC", href: "https://www.sic.gov.co/", external: true } }
      ]
    }
  };

  return documents[slug] ?? null;
}
