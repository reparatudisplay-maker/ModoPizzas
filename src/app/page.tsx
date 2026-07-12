import { OperationsDashboard } from "@/components/operations-dashboard";
import { PublicOrderingApp } from "@/components/public-ordering-app";

export default function Home() {
  return (
    <main>
      <PublicOrderingApp />
      <OperationsDashboard />
    </main>
  );
}
