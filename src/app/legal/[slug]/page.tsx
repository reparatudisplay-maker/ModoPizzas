import Link from "next/link";
import { notFound } from "next/navigation";
import { buildPublicLegalDocument, publicLegalSlugs, type PublicLegalBusiness } from "@/lib/public-legal";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export function generateStaticParams() { return publicLegalSlugs.map((slug) => ({ slug })); }

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("site_settings").select("*").eq("id", true).single();
  const document = buildPublicLegalDocument(slug, (data ?? {}) as PublicLegalBusiness);
  if (!document) notFound();
  return (
    <main className="public-legal-page">
      <Link href="/" className="public-legal-back">← Volver a Modo Pizzas</Link>
      <article>
        <header className="public-legal-header">
          <span>INFORMACIÓN PÚBLICA</span>
          <h1>{document.title}</h1>
          <p className="public-legal-summary">{document.summary}</p>
          <small>Última actualización: {document.updatedAt}</small>
        </header>
        <nav aria-label="Contenido" className="public-legal-index">
          {document.sections.map((section) => <a href={`#${encodeURIComponent(section.heading)}`} key={section.heading}>{section.heading}</a>)}
        </nav>
        <div className="public-legal-sections">
          {document.sections.map((section) => (
            <section id={encodeURIComponent(section.heading)} key={section.heading}>
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.action || section.actions?.length ? (
                <div className="public-legal-actions">
                  {[...(section.actions ?? []), ...(section.action ? [section.action] : [])].map((action) => (
                    <a className="public-legal-action" href={action.href} key={`${action.label}-${action.href}`} rel={action.external ? "noopener noreferrer" : undefined} target={action.external ? "_blank" : undefined}>{action.label}</a>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
