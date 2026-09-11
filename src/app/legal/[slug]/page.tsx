import Link from "next/link";
import { notFound } from "next/navigation";
import { publicLegalDocuments } from "@/lib/public-legal";

export const dynamic = "force-static";

export function generateStaticParams() { return Object.keys(publicLegalDocuments).map((slug) => ({ slug })); }

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const document = publicLegalDocuments[slug];
  if (!document) notFound();
  return <main className="public-legal-page"><Link href="/" className="public-legal-back">← Volver a ModoPizzas</Link><article><span>INFORMACION PUBLICA</span><h1>{document.title}</h1><p className="public-legal-summary">{document.summary}</p>{document.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</article></main>;
}
