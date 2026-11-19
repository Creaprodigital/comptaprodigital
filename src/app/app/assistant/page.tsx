import type { Metadata } from "next";
import { requireCompany } from "@/server/auth/guards";
import { aiStatus } from "@/server/ai/service";
import { PageHeader } from "@/components/app/page-header";
import { AiUnavailable } from "@/components/app/ai/ai-unavailable";
import { AssistantChat } from "@/components/app/ai/assistant-chat";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const { access } = await requireCompany("dashboard:read");
  const ai = await aiStatus(access.company);
  return (
    <>
      <PageHeader
        title="Assistant"
        description="Questions sur vos chiffres, recherche d'opérations, explications. Les réponses s'appuient sur vos données mais peuvent comporter des erreurs : vérifiez-les, et consultez votre expert-comptable pour toute décision engageante."
      />
      {ai.usable ? <AssistantChat companyId={access.company.id} /> : <AiUnavailable status={ai} />}
    </>
  );
}
