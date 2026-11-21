-- AlterTable
ALTER TABLE `bank_accounts` ADD COLUMN `connectionId` VARCHAR(191) NULL,
    ADD COLUMN `openingFromProvider` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `providerBalance` DECIMAL(15, 2) NULL,
    ADD COLUMN `providerCursor` VARCHAR(40) NULL;

-- CreateTable
CREATE TABLE `bank_connections` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `providerUserRef` VARCHAR(191) NOT NULL,
    `providerItemRef` VARCHAR(191) NOT NULL,
    `status` ENUM('SYNCING', 'ACTIVE', 'ACTION_REQUIRED', 'ERROR', 'REVOKED') NOT NULL DEFAULT 'SYNCING',
    `statusCode` INTEGER NULL,
    `statusInfo` VARCHAR(100) NULL,
    `statusDescription` VARCHAR(500) NULL,
    `authenticationExpiresAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `createdById` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bank_connections_companyId_idx`(`companyId`),
    INDEX `bank_connections_provider_providerUserRef_idx`(`provider`, `providerUserRef`),
    UNIQUE INDEX `bank_connections_provider_providerItemRef_key`(`provider`, `providerItemRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_connect_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `stateHash` CHAR(64) NOT NULL,
    `connectionId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bank_connect_sessions_stateHash_key`(`stateHash`),
    INDEX `bank_connect_sessions_companyId_idx`(`companyId`),
    INDEX `bank_connect_sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `bank_accounts_companyId_providerAccountRef_idx` ON `bank_accounts`(`companyId`, `providerAccountRef`);

-- CreateIndex
CREATE INDEX `bank_accounts_connectionId_idx` ON `bank_accounts`(`connectionId`);

-- AddForeignKey
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `bank_connections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_connections` ADD CONSTRAINT `bank_connections_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_connect_sessions` ADD CONSTRAINT `bank_connect_sessions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `bank_accounts` ADD COLUMN `providerSyncFrom` DATE NULL;

