import { Badge } from "@/components/ui/badge";

export const VAT_STATUS = {
  NOT_STARTED: ["À préparer", "outline"],
  OPEN: ["À préparer", "outline"],
  PREPARED: ["Préparée", "accent"],
  VALIDATED: ["Validée, à déposer", "warning"],
  DECLARED: ["Déposée", "success"],
} as const;

export function VatStatusBadge({ status, ended, current }: { status: keyof typeof VAT_STATUS; ended: boolean; current: boolean }) {
  if (current) return <Badge variant="secondary">En cours</Badge>;
  if (!ended) return <Badge variant="outline">À venir</Badge>;
  return <Badge variant={VAT_STATUS[status][1]}>{VAT_STATUS[status][0]}</Badge>;
}
