# Performances

Mesures réalisées avec `tests/perf/run.mts` sur une base dédiée (`comptapro_perf`), MySQL 8 et Node 22 sur la
même machine, pour **une entreprise** de volume élevé : 20 000 opérations bancaires, 3 000 factures d'achat,
1 000 factures de vente émises, soit environ 24 000 écritures comptables. Médiane de cinq exécutions.

```bash
PERF_DATABASE_URL=mysql://…/comptapro_perf npx tsx tests/perf/run.mts --seed   # création du jeu de données
PERF_DATABASE_URL=mysql://…/comptapro_perf npx tsx tests/perf/run.mts          # mesures
PERF_DATABASE_URL=mysql://…/comptapro_perf npx tsx tests/perf/run.mts --from-scratch  # + reprise complète
```

| Opération | Avant | Après | Changement |
|---|---:|---:|---|
| Synchronisation comptable, rien à modifier (tâche quotidienne) | 169 s | 20 s | cache de lectures par transaction, préchargement par lot |
| Reprise complète de l'historique (24 000 écritures créées) | 351 s | 82 s | idem |
| Liste des opérations bancaires (page 1) | 127 ms | 78 ms | index de tri et index couvrants |
| Contrôles automatiques | 597 ms | 248 ms | comptages en base, seuls les éléments affichés sont chargés |
| Factures, achats (page 1) | 9 / 16 ms | 9 / 16 ms | — |
| Tableau de bord (exercice) | 375 ms | 340 ms | — |
| Balance générale | 269 ms | 393 ms* | — |
| Grand livre d'un compte (≈ 20 000 lignes) | 399 ms | 616 ms* | — |

\* Écarts dus au bruit de mesure et au nombre d'écritures légèrement supérieur après la reprise complète ; ces
deux états agrègent l'ensemble des lignes de l'exercice et n'ont pas été modifiés.

## Optimisations

- **Synchronisation comptable** (`src/server/modules/accounting/sync.ts`) : pour chaque lot de 100 pièces, les
  écritures existantes et les pièces elles-mêmes sont chargées en une requête par type, et les lectures stables
  pendant la synchronisation (journaux, comptes, exercices, comptes bancaires, comptes auxiliaires attribués) sont
  mises en cache **pour la seule durée de la transaction**, qui détient le verrou de l'entreprise. Le résultat est
  identique (110 tests de comptabilité, TVA, banque et facturation inchangés).
- **Index** (`prisma/migrations/20261119102416_index_performance`) : tri de la liste des opérations sans tri en
  mémoire (47 ms → 0,07 ms), doublons (35 ms → 0,01 ms), opérations sans justificatif (46 ms → 22 ms).

## Gros volumes

- **Reprise de l'historique** : à la première activation de la comptabilité, une entreprise de moins de
  1 000 pièces est reprise immédiatement ; au-delà, la reprise s'exécute après la réponse (`after()`), un bandeau
  « Reprise de l'historique comptable en cours » prévient les membres, et une reprise interrompue (redémarrage) est
  refaite intégralement par la tâche quotidienne.
- **Synchronisation incrémentale** : la tâche quotidienne ne reprend que les pièces modifiées depuis la dernière
  passe (marge d'une heure). Une passe complète est faite au moins une fois par semaine, après un échec de
  synchronisation enregistré, ou si une reprise est en attente.
- **Grand livre paginé** : 500 lignes par page, calculées en base (fonctions de fenêtre MySQL) : soldes
  progressifs et totaux du compte restent exacts d'une page à l'autre. L'export CSV reste complet.

## Limites connues

- La passe complète hebdomadaire reste proportionnelle au nombre de pièces (environ 1 ms par pièce).

