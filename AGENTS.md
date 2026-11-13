<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Conventions du projet

- Interface, messages d'erreur, commentaires et documentation en **français**.
- La logique métier vit dans `src/server/modules/*` ; les routes `/api/v1` passent par `publicRoute` / `authRoute`.
- Toute donnée d'entreprise passe par `authorizeCompany()` et le client cloisonné `tenantDb(companyId)`.
- Montants : `DECIMAL` en base, `decimal.js` dans le code (`src/lib/money.ts`), jamais de `number` pour un calcul.
- Une fonctionnalité n'est exposée dans l'interface que lorsqu'elle fonctionne réellement ; aucune donnée fictive
  hors de l'entreprise de démonstration.
- Avant de livrer : `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`.
- Chaque page de `src/app/app/*` a son `loading.tsx` (frontière Suspense exigée par Cache Components).
