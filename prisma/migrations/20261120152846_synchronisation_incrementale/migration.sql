-- AlterTable
ALTER TABLE `companies` ADD COLUMN `accountingBackfillAt` DATETIME(3) NULL,
    ADD COLUMN `accountingFullSyncAt` DATETIME(3) NULL,
    ADD COLUMN `accountingSyncedAt` DATETIME(3) NULL;
