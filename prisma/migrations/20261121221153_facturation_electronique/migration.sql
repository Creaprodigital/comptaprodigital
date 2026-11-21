-- AlterTable
ALTER TABLE `invoices` MODIFY `eInvoiceStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'DEPOSITED', 'REJECTED', 'ACCEPTED', 'DISPUTED', 'REFUSED', 'PAID') NOT NULL DEFAULT 'NOT_APPLICABLE';

-- CreateTable
CREATE TABLE `einvoice_transmissions` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(40) NOT NULL,
    `format` ENUM('FACTUR_X', 'UBL', 'CII') NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` VARCHAR(500) NULL,
    `platformRef` VARCHAR(191) NULL,
    `fileChecksum` CHAR(64) NULL,
    `requestedById` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `einvoice_transmissions_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `einvoice_transmissions_companyId_invoiceId_idx`(`companyId`, `invoiceId`),
    INDEX `einvoice_transmissions_platform_platformRef_idx`(`platform`, `platformRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `einvoice_incoming` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(40) NOT NULL,
    `platformRef` VARCHAR(191) NOT NULL,
    `format` ENUM('FACTUR_X', 'UBL', 'CII') NOT NULL,
    `sellerName` VARCHAR(191) NOT NULL,
    `sellerSiren` CHAR(9) NULL,
    `sellerVatNumber` VARCHAR(20) NULL,
    `number` VARCHAR(100) NOT NULL,
    `issueDate` DATE NOT NULL,
    `dueDate` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `totalExclTax` DECIMAL(15, 2) NOT NULL,
    `totalVat` DECIMAL(15, 2) NOT NULL,
    `totalInclTax` DECIMAL(15, 2) NOT NULL,
    `xmlStorageKey` VARCHAR(512) NOT NULL,
    `xmlChecksum` CHAR(64) NOT NULL,
    `documentId` VARCHAR(191) NULL,
    `status` ENUM('RECEIVED', 'PURCHASE_CREATED', 'REFUSED') NOT NULL DEFAULT 'RECEIVED',
    `lastStatusCode` INTEGER NULL,
    `purchaseId` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `einvoice_incoming_companyId_status_idx`(`companyId`, `status`),
    INDEX `einvoice_incoming_documentId_idx`(`documentId`),
    INDEX `einvoice_incoming_purchaseId_idx`(`purchaseId`),
    UNIQUE INDEX `einvoice_incoming_platform_platformRef_key`(`platform`, `platformRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `einvoice_lifecycle_events` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `transmissionId` VARCHAR(191) NULL,
    `incomingId` VARCHAR(191) NULL,
    `code` INTEGER NOT NULL,
    `reason` VARCHAR(500) NULL,
    `source` VARCHAR(20) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `dedupKey` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `einvoice_lifecycle_events_dedupKey_key`(`dedupKey`),
    INDEX `einvoice_lifecycle_events_companyId_idx`(`companyId`),
    INDEX `einvoice_lifecycle_events_transmissionId_idx`(`transmissionId`),
    INDEX `einvoice_lifecycle_events_incomingId_idx`(`incomingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `einvoice_transmissions` ADD CONSTRAINT `einvoice_transmissions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_transmissions` ADD CONSTRAINT `einvoice_transmissions_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_incoming` ADD CONSTRAINT `einvoice_incoming_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_incoming` ADD CONSTRAINT `einvoice_incoming_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_incoming` ADD CONSTRAINT `einvoice_incoming_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_lifecycle_events` ADD CONSTRAINT `einvoice_lifecycle_events_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_lifecycle_events` ADD CONSTRAINT `einvoice_lifecycle_events_transmissionId_fkey` FOREIGN KEY (`transmissionId`) REFERENCES `einvoice_transmissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `einvoice_lifecycle_events` ADD CONSTRAINT `einvoice_lifecycle_events_incomingId_fkey` FOREIGN KEY (`incomingId`) REFERENCES `einvoice_incoming`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `companies` ADD COLUMN `einvoicingActivatedAt` DATETIME(3) NULL,
    ADD COLUMN `einvoicingActivatedById` VARCHAR(191) NULL;

