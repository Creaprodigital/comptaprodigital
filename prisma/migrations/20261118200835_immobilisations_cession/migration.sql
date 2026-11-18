-- AlterTable
ALTER TABLE `fixed_assets` ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `disposalPrice` DECIMAL(15, 2) NULL,
    ADD COLUMN `notes` TEXT NULL;
