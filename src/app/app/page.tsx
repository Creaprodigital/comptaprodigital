import { redirect } from "next/navigation";
import { getAppContext } from "@/server/auth/guards";

export default async function AppIndexPage() {
  const { access } = await getAppContext();
  redirect(access ? "/app/tableau-de-bord" : "/app/entreprises");
}
