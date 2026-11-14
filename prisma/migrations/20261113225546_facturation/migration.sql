/*
  Warnings:

  - You are about to drop the column `logoDocumentId` on the `companies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `companies` DROP COLUMN `logoDocumentId`,
    ADD COLUMN `earlyPaymentDiscountNote` VARCHAR(255) NULL,
    ADD COLUMN `invoiceAccentColor` VARCHAR(7) NOT NULL DEFAULT '#2563EB',
    ADD COLUMN `quoteValidityDays` INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN `reminderDelaysDays` JSON NULL,
    ADD COLUMN `remindersEnabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `creditedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `recurring_invoices` ADD COLUMN `autoSend` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `company_logos` (
    `companyId` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(50) NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `company_logos` ADD CONSTRAINT `company_logos_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Les factures d'acompte et récurrentes font partie des formules Pro et Business.
UPDATE `subscription_plans`
SET `limits` = JSON_ARRAY_APPEND(`limits`, '$.modules', 'invoicing-advanced')
WHERE `key` IN ('PRO', 'BUSINESS')
  AND JSON_CONTAINS(`limits`, '"invoicing-advanced"', '$.modules') = 0;
