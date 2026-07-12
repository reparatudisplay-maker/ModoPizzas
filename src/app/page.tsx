import { OperationsDashboard } from "@/components/operations-dashboard";
import { PublicOrderingApp } from "@/components/public-ordering-app";
import { getPublicCatalog } from "@/lib/public-catalog";

export const revalidate = 60;

export default async function Home() {
  const catalog = await getPublicCatalog();

  return (
    <main>
      <PublicOrderingApp catalog={catalog} />
      <OperationsDashboard />
    </main>
  );
}
