-- AlterTable
ALTER TABLE `ai_suggestions` ADD COLUMN `createdById` VARCHAR(191) NULL,
    MODIFY `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'OBSOLETE') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `companies` ADD COLUMN `aiEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `aiEnabledById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ai_usage` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `feature` ENUM('DOCUMENT_EXTRACTION', 'CATEGORIZATION', 'ASSISTANT') NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `status` ENUM('OK', 'REFUSED', 'ERROR') NOT NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheReadTokens` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_usage_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `ai_usage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_usage` ADD CONSTRAINT `ai_usage_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Assistant IA : module « ai » et quota mensuel de requêtes dans les formules Pro et Business existantes
-- (les formules restent modifiables depuis l'administration).
UPDATE `subscription_plans`
SET `limits` = JSON_SET(JSON_ARRAY_APPEND(`limits`, '$.modules', 'ai'), '$.aiRequestsPerMonth', 300)
WHERE `key` = 'PRO' AND NOT JSON_CONTAINS(JSON_EXTRACT(`limits`, '$.modules'), '"ai"');
UPDATE `subscription_plans`
SET `limits` = JSON_SET(JSON_ARRAY_APPEND(`limits`, '$.modules', 'ai'), '$.aiRequestsPerMonth', 1500)
WHERE `key` = 'BUSINESS' AND NOT JSON_CONTAINS(JSON_EXTRACT(`limits`, '$.modules'), '"ai"');
