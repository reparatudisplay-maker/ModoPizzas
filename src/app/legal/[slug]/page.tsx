import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type LegalPage = {
  slug: string;
  title: string;
  body: string;
  updated_at: string;
};

const fallbackBody =
  "Documento en preparacion. La administracion de la pizzeria podra completar este contenido desde el modulo correspondiente.";

export const dynamic = "force-dynamic";

export default async function LegalDocumentPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("legal_pages")
    .select("slug, title, body, updated_at")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<LegalPage>();

  if (error || !data) {
    notFound();
  }

  return (
    <main className="legal-page">
      <article className="legal-document">
        <Link className="ghost-button" href="/#legal">
          Volver
        </Link>
        <p className="eyebrow">ModoPizzas</p>
        <h1>{data.title}</h1>
        <p className="muted">Actualizado: {new Date(data.updated_at).toLocaleDateString("es-CO")}</p>
        <div className="legal-body">
          {(data.body || fallbackBody).split("\n").map((paragraph, index) => (
            <p key={`${data.slug}-${index}`}>{paragraph}</p>
          ))}
        </div>
      </article>
    </main>
  );
}
