-- AlterTable
ALTER TABLE `admin_data_access_grants` ADD COLUMN `revokedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `subscriptions` ADD COLUMN `paymentFailedAt` DATETIME(3) NULL,
    ADD COLUMN `priceAmount` DECIMAL(10, 2) NULL,
    ADD COLUMN `trialReminderSentAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `suspendedAt` DATETIME(3) NULL,
    ADD COLUMN `suspendedReason` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `subscription_payments_status_paidAt_idx` ON `subscription_payments`(`status`, `paidAt`);
