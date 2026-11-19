-- Index de performance des opérations bancaires (mesurés sur 20 000 opérations, voir tests/perf).
-- Écrite à la main : la clé étrangère companyId doit rester couverte à tout instant par un index
-- commençant par companyId. Le nouvel index est donc créé AVANT la suppression de l'ancien, et
-- aucune clé étrangère n'est supprimée.

-- Liste paginée triée par date, création et identifiant (remplace l'index companyId + date).
CREATE INDEX `bank_transactions_companyId_date_createdAt_id_idx` ON `bank_transactions`(`companyId`, `date`, `createdAt`, `id`);
DROP INDEX `bank_transactions_companyId_date_idx` ON `bank_transactions`;

-- Totaux encaissements / décaissements (index couvrant).
CREATE INDEX `bank_transactions_companyId_amount_idx` ON `bank_transactions`(`companyId`, `amount`);

-- Compteurs « sans justificatif » et « non catégorisées », doublons possibles.
CREATE INDEX `bank_transactions_companyId_documentCount_purchaseId_amount_idx` ON `bank_transactions`(`companyId`, `documentCount`, `purchaseId`, `amount`);
CREATE INDEX `bank_transactions_companyId_categoryId_date_idx` ON `bank_transactions`(`companyId`, `categoryId`, `date`);
CREATE INDEX `bank_transactions_companyId_isDuplicateSuspect_idx` ON `bank_transactions`(`companyId`, `isDuplicateSuspect`);
