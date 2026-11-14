-- AlterTable
ALTER TABLE `bank_imports` ADD COLUMN `fileChecksum` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `createdFromBank` BOOLEAN NOT NULL DEFAULT false;
