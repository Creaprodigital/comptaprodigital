-- AlterTable
ALTER TABLE `accounting_entries` MODIFY `sourceType` ENUM('MANUAL', 'INVOICE', 'PAYMENT', 'PURCHASE', 'BANK_TRANSACTION', 'DEPRECIATION', 'CLOSING', 'OPENING', 'VAT_RETURN', 'ASSET_DISPOSAL') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `purchases` ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `operationCategory` ENUM('GOODS', 'SERVICES', 'MIXED') NOT NULL DEFAULT 'SERVICES',
    ADD COLUMN `supplierVatOnDebits` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `accounting_entries_companyId_status_date_idx` ON `accounting_entries`(`companyId`, `status`, `date`);

-- CreateIndex
CREATE INDEX `accounting_entry_lines_companyId_accountId_letter_idx` ON `accounting_entry_lines`(`companyId`, `accountId`, `letter`);

-- CreateIndex
CREATE INDEX `purchases_companyId_reference_idx` ON `purchases`(`companyId`, `reference`);
