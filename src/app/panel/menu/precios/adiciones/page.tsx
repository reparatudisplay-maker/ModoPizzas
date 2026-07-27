import { MenuPizzasModule } from "../../pizzas/page";

export const dynamic = "force-dynamic";

export default async function MenuPreciosAdicionesPage() {
  return <MenuPizzasModule mode="adiciones" />;
}
