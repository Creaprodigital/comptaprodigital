-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `locale` VARCHAR(10) NOT NULL DEFAULT 'fr-FR',
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `isSuperAdmin` BOOLEAN NOT NULL DEFAULT false,
    `emailVerifiedAt` DATETIME(3) NULL,
    `termsAcceptedAt` DATETIME(3) NULL,
    `mfaSecretEncrypted` VARCHAR(512) NULL,
    `mfaEnabledAt` DATETIME(3) NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `mfaPending` BOOLEAN NOT NULL DEFAULT false,
    `activeCompanyId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_userId_idx`(`userId`),
    INDEX `sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET') NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `verification_tokens_tokenHash_key`(`tokenHash`),
    INDEX `verification_tokens_userId_type_idx`(`userId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mfa_recovery_codes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mfa_recovery_codes_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `scope` ENUM('COMPANY', 'PLATFORM') NOT NULL DEFAULT 'COMPANY',
    `isSystem` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `module` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    INDEX `permissions_module_idx`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `tradeName` VARCHAR(191) NULL,
    `siren` CHAR(9) NULL,
    `siret` CHAR(14) NULL,
    `vatNumber` VARCHAR(20) NULL,
    `nafCode` VARCHAR(10) NULL,
    `rcsCity` VARCHAR(100) NULL,
    `shareCapital` DECIMAL(15, 2) NULL,
    `legalForm` ENUM('MICRO_ENTREPRISE', 'EI', 'EURL', 'SARL', 'SASU', 'SAS', 'SA', 'SCI', 'ASSOCIATION', 'OTHER') NOT NULL,
    `taxRegime` ENUM('MICRO_BIC', 'MICRO_BNC', 'BNC_DECLARATION_CONTROLEE', 'IR_REEL_SIMPLIFIE', 'IR_REEL_NORMAL', 'IS_REEL_SIMPLIFIE', 'IS_REEL_NORMAL') NOT NULL,
    `vatRegime` ENUM('FRANCHISE', 'REEL_SIMPLIFIE', 'REEL_NORMAL_MENSUEL', 'REEL_NORMAL_TRIMESTRIEL') NOT NULL,
    `vatExigibility` ENUM('DEBITS', 'ENCAISSEMENTS') NOT NULL DEFAULT 'ENCAISSEMENTS',
    `accountingMode` ENUM('CASH_BOOK', 'DOUBLE_ENTRY') NOT NULL DEFAULT 'DOUBLE_ENTRY',
    `fiscalYearStartMonth` TINYINT NOT NULL DEFAULT 1,
    `registrationDate` DATE NULL,
    `addressLine1` VARCHAR(191) NULL,
    `addressLine2` VARCHAR(191) NULL,
    `postalCode` VARCHAR(10) NULL,
    `city` VARCHAR(100) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'FR',
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(30) NULL,
    `website` VARCHAR(191) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `invoicePrefix` VARCHAR(10) NOT NULL DEFAULT 'F',
    `quotePrefix` VARCHAR(10) NOT NULL DEFAULT 'D',
    `creditNotePrefix` VARCHAR(10) NOT NULL DEFAULT 'A',
    `defaultPaymentTermDays` INTEGER NOT NULL DEFAULT 30,
    `latePenaltyRate` DECIMAL(5, 2) NULL,
    `invoiceFooter` TEXT NULL,
    `ibanEncrypted` VARCHAR(512) NULL,
    `bic` VARCHAR(11) NULL,
    `logoDocumentId` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `suspendedAt` DATETIME(3) NULL,
    `suspendedReason` VARCHAR(255) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `companies_siren_idx`(`siren`),
    INDEX `companies_status_idx`(`status`),
    INDEX `companies_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_users` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `company_users_userId_idx`(`userId`),
    INDEX `company_users_roleId_idx`(`roleId`),
    UNIQUE INDEX `company_users_companyId_userId_key`(`companyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_invitations` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `invitedById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `company_invitations_tokenHash_key`(`tokenHash`),
    INDEX `company_invitations_companyId_idx`(`companyId`),
    INDEX `company_invitations_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(30) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `tagline` VARCHAR(191) NULL,
    `monthlyPrice` DECIMAL(10, 2) NOT NULL,
    `yearlyPrice` DECIMAL(10, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `trialDays` INTEGER NOT NULL DEFAULT 14,
    `features` JSON NOT NULL,
    `limits` JSON NOT NULL,
    `stripeProductId` VARCHAR(100) NULL,
    `stripeMonthlyPriceId` VARCHAR(100) NULL,
    `stripeYearlyPriceId` VARCHAR(100) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscription_plans_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'INCOMPLETE', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'TRIALING',
    `billingInterval` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'MONTHLY',
    `trialEndsAt` DATETIME(3) NULL,
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    `canceledAt` DATETIME(3) NULL,
    `stripeCustomerId` VARCHAR(100) NULL,
    `stripeSubscriptionId` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscriptions_userId_key`(`userId`),
    UNIQUE INDEX `subscriptions_stripeCustomerId_key`(`stripeCustomerId`),
    UNIQUE INDEX `subscriptions_stripeSubscriptionId_key`(`stripeSubscriptionId`),
    INDEX `subscriptions_planId_idx`(`planId`),
    INDEX `subscriptions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_payments` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `stripeInvoiceId` VARCHAR(100) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `status` VARCHAR(30) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `hostedInvoiceUrl` VARCHAR(512) NULL,
    `invoicePdfUrl` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `subscription_payments_stripeInvoiceId_key`(`stripeInvoiceId`),
    INDEX `subscription_payments_subscriptionId_idx`(`subscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_events` (
    `id` VARCHAR(100) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `type` ENUM('COMPANY', 'INDIVIDUAL') NOT NULL DEFAULT 'COMPANY',
    `name` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(30) NULL,
    `siren` CHAR(9) NULL,
    `siret` CHAR(14) NULL,
    `vatNumber` VARCHAR(20) NULL,
    `addressLine1` VARCHAR(191) NULL,
    `addressLine2` VARCHAR(191) NULL,
    `postalCode` VARCHAR(10) NULL,
    `city` VARCHAR(100) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'FR',
    `paymentTermDays` INTEGER NULL,
    `accountNumber` VARCHAR(20) NULL,
    `notes` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customers_companyId_name_idx`(`companyId`, `name`),
    INDEX `customers_companyId_email_idx`(`companyId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(30) NULL,
    `siren` CHAR(9) NULL,
    `siret` CHAR(14) NULL,
    `vatNumber` VARCHAR(20) NULL,
    `addressLine1` VARCHAR(191) NULL,
    `addressLine2` VARCHAR(191) NULL,
    `postalCode` VARCHAR(10) NULL,
    `city` VARCHAR(100) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'FR',
    `accountNumber` VARCHAR(20) NULL,
    `notes` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `suppliers_companyId_name_idx`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `type` ENUM('SERVICE', 'GOOD') NOT NULL DEFAULT 'SERVICE',
    `reference` VARCHAR(60) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `unit` VARCHAR(30) NULL,
    `unitPriceExclTax` DECIMAL(15, 4) NOT NULL,
    `vatRate` DECIMAL(5, 2) NOT NULL,
    `accountNumber` VARCHAR(20) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `products_companyId_name_idx`(`companyId`, `name`),
    INDEX `products_companyId_reference_idx`(`companyId`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vat_rates` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `label` VARCHAR(100) NOT NULL,
    `rate` DECIMAL(5, 2) NOT NULL,
    `legalNote` VARCHAR(255) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vat_rates_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotes` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED') NOT NULL DEFAULT 'DRAFT',
    `issueDate` DATE NOT NULL,
    `validUntil` DATE NULL,
    `subject` VARCHAR(255) NULL,
    `notes` TEXT NULL,
    `terms` TEXT NULL,
    `discountType` ENUM('NONE', 'PERCENT', 'AMOUNT') NOT NULL DEFAULT 'NONE',
    `discountValue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalExclTax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalVat` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalInclTax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `sentAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `quotes_companyId_status_idx`(`companyId`, `status`),
    INDEX `quotes_companyId_issueDate_idx`(`companyId`, `issueDate`),
    INDEX `quotes_customerId_idx`(`customerId`),
    UNIQUE INDEX `quotes_companyId_number_key`(`companyId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quote_items` (
    `id` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `quantity` DECIMAL(15, 4) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `unitPriceExclTax` DECIMAL(15, 4) NOT NULL,
    `discountRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `vatRate` DECIMAL(5, 2) NOT NULL,
    `totalExclTax` DECIMAL(15, 2) NOT NULL,
    `totalVat` DECIMAL(15, 2) NOT NULL,
    `totalInclTax` DECIMAL(15, 2) NOT NULL,

    INDEX `quote_items_quoteId_idx`(`quoteId`),
    INDEX `quote_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` ENUM('INVOICE', 'DEPOSIT', 'CREDIT_NOTE') NOT NULL DEFAULT 'INVOICE',
    `status` ENUM('DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `number` VARCHAR(40) NULL,
    `issueDate` DATE NULL,
    `dueDate` DATE NULL,
    `serviceDate` DATE NULL,
    `quoteId` VARCHAR(191) NULL,
    `originalInvoiceId` VARCHAR(191) NULL,
    `recurringInvoiceId` VARCHAR(191) NULL,
    `subject` VARCHAR(255) NULL,
    `notes` TEXT NULL,
    `paymentTerms` TEXT NULL,
    `operationCategory` ENUM('GOODS', 'SERVICES', 'MIXED') NOT NULL DEFAULT 'SERVICES',
    `vatExigibility` ENUM('DEBITS', 'ENCAISSEMENTS') NOT NULL DEFAULT 'ENCAISSEMENTS',
    `discountType` ENUM('NONE', 'PERCENT', 'AMOUNT') NOT NULL DEFAULT 'NONE',
    `discountValue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalExclTax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalVat` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalInclTax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amountPaid` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `partiesSnapshot` JSON NULL,
    `issuedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `reminderCount` INTEGER NOT NULL DEFAULT 0,
    `lastReminderAt` DATETIME(3) NULL,
    `pdfDocumentId` VARCHAR(191) NULL,
    `eInvoiceFormat` ENUM('FACTUR_X', 'UBL', 'CII') NULL,
    `eInvoiceStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'DEPOSITED', 'REJECTED', 'ACCEPTED') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `eInvoicePlatformRef` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `invoices_companyId_status_idx`(`companyId`, `status`),
    INDEX `invoices_companyId_issueDate_idx`(`companyId`, `issueDate`),
    INDEX `invoices_companyId_dueDate_idx`(`companyId`, `dueDate`),
    INDEX `invoices_customerId_idx`(`customerId`),
    INDEX `invoices_quoteId_idx`(`quoteId`),
    INDEX `invoices_originalInvoiceId_idx`(`originalInvoiceId`),
    INDEX `invoices_recurringInvoiceId_idx`(`recurringInvoiceId`),
    UNIQUE INDEX `invoices_companyId_number_key`(`companyId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_items` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `quantity` DECIMAL(15, 4) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `unitPriceExclTax` DECIMAL(15, 4) NOT NULL,
    `discountRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `vatRate` DECIMAL(5, 2) NOT NULL,
    `totalExclTax` DECIMAL(15, 2) NOT NULL,
    `totalVat` DECIMAL(15, 2) NOT NULL,
    `totalInclTax` DECIMAL(15, 2) NOT NULL,

    INDEX `invoice_items_invoiceId_idx`(`invoiceId`),
    INDEX `invoice_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `number_sequences` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `type` ENUM('INVOICE', 'CREDIT_NOTE', 'QUOTE') NOT NULL,
    `year` INTEGER NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `number_sequences_companyId_type_year_key`(`companyId`, `type`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recurring_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `frequency` ENUM('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY') NOT NULL,
    `nextRunDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `template` JSON NOT NULL,
    `autoIssue` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'PAUSED', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `lastRunAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `recurring_invoices_companyId_status_nextRunDate_idx`(`companyId`, `status`, `nextRunDate`),
    INDEX `recurring_invoices_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paidAt` DATE NOT NULL,
    `method` ENUM('TRANSFER', 'CARD', 'CHECK', 'CASH', 'DIRECT_DEBIT', 'OTHER') NOT NULL DEFAULT 'TRANSFER',
    `reference` VARCHAR(191) NULL,
    `note` VARCHAR(255) NULL,
    `bankTransactionId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_companyId_paidAt_idx`(`companyId`, `paidAt`),
    INDEX `payments_invoiceId_idx`(`invoiceId`),
    INDEX `payments_bankTransactionId_idx`(`bankTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NULL,
    `reference` VARCHAR(100) NULL,
    `label` VARCHAR(255) NOT NULL,
    `issueDate` DATE NOT NULL,
    `dueDate` DATE NULL,
    `status` ENUM('DRAFT', 'TO_PAY', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'TO_PAY',
    `categoryId` VARCHAR(191) NULL,
    `totalExclTax` DECIMAL(15, 2) NOT NULL,
    `totalVat` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalInclTax` DECIMAL(15, 2) NOT NULL,
    `amountPaid` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAt` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `purchases_companyId_issueDate_idx`(`companyId`, `issueDate`),
    INDEX `purchases_companyId_status_idx`(`companyId`, `status`),
    INDEX `purchases_supplierId_idx`(`supplierId`),
    INDEX `purchases_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `bankName` VARCHAR(100) NULL,
    `ibanEncrypted` VARCHAR(512) NULL,
    `ibanLast4` CHAR(4) NULL,
    `bic` VARCHAR(11) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `openingBalance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `openingBalanceDate` DATE NULL,
    `accountNumber` VARCHAR(20) NULL,
    `provider` ENUM('MANUAL', 'AGGREGATOR') NOT NULL DEFAULT 'MANUAL',
    `providerAccountRef` VARCHAR(191) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bank_accounts_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transaction_categories` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `name` VARCHAR(100) NOT NULL,
    `kind` ENUM('INCOME', 'EXPENSE', 'TRANSFER', 'TAX', 'PAYROLL', 'OTHER') NOT NULL,
    `accountNumber` VARCHAR(20) NULL,
    `color` VARCHAR(9) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transaction_categories_companyId_kind_idx`(`companyId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `valueDate` DATE NULL,
    `label` VARCHAR(255) NOT NULL,
    `rawLabel` VARCHAR(512) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
    `status` ENUM('TO_REVIEW', 'CATEGORIZED', 'RECONCILED') NOT NULL DEFAULT 'TO_REVIEW',
    `categoryId` VARCHAR(191) NULL,
    `vatRate` DECIMAL(5, 2) NULL,
    `vatAmount` DECIMAL(15, 2) NULL,
    `purchaseId` VARCHAR(191) NULL,
    `importId` VARCHAR(191) NULL,
    `externalId` VARCHAR(191) NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `isDuplicateSuspect` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `reconciledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bank_transactions_companyId_date_idx`(`companyId`, `date`),
    INDEX `bank_transactions_bankAccountId_date_idx`(`bankAccountId`, `date`),
    INDEX `bank_transactions_bankAccountId_fingerprint_idx`(`bankAccountId`, `fingerprint`),
    INDEX `bank_transactions_companyId_status_idx`(`companyId`, `status`),
    INDEX `bank_transactions_categoryId_idx`(`categoryId`),
    INDEX `bank_transactions_purchaseId_idx`(`purchaseId`),
    INDEX `bank_transactions_importId_idx`(`importId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_imports` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NOT NULL,
    `format` ENUM('CSV', 'OFX', 'CAMT053') NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `importedCount` INTEGER NOT NULL DEFAULT 0,
    `duplicateCount` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bank_imports_companyId_idx`(`companyId`),
    INDEX `bank_imports_bankAccountId_idx`(`bankAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categorization_rules` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `matchType` ENUM('CONTAINS', 'STARTS_WITH', 'EQUALS', 'REGEX') NOT NULL DEFAULT 'CONTAINS',
    `pattern` VARCHAR(255) NOT NULL,
    `direction` VARCHAR(3) NULL,
    `amountMin` DECIMAL(15, 2) NULL,
    `amountMax` DECIMAL(15, 2) NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `vatRate` DECIMAL(5, 2) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `categorization_rules_companyId_isActive_priority_idx`(`companyId`, `isActive`, `priority`),
    INDEX `categorization_rules_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fiscal_years` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `lockedThrough` DATE NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fiscal_years_companyId_endDate_idx`(`companyId`, `endDate`),
    UNIQUE INDEX `fiscal_years_companyId_startDate_key`(`companyId`, `startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounting_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(20) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `type` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounting_accounts_companyId_number_key`(`companyId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounting_journals` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `type` ENUM('SALES', 'PURCHASES', 'BANK', 'MISC', 'OPENING') NOT NULL,
    `bankAccountId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `accounting_journals_bankAccountId_idx`(`bankAccountId`),
    UNIQUE INDEX `accounting_journals_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounting_entries` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `journalId` VARCHAR(191) NOT NULL,
    `fiscalYearId` VARCHAR(191) NOT NULL,
    `entryNumber` INTEGER NULL,
    `date` DATE NOT NULL,
    `pieceRef` VARCHAR(100) NULL,
    `pieceDate` DATE NULL,
    `label` VARCHAR(255) NOT NULL,
    `status` ENUM('DRAFT', 'VALIDATED') NOT NULL DEFAULT 'DRAFT',
    `validatedAt` DATETIME(3) NULL,
    `validatedById` VARCHAR(191) NULL,
    `reversalOfId` VARCHAR(191) NULL,
    `sourceType` ENUM('MANUAL', 'INVOICE', 'PAYMENT', 'PURCHASE', 'BANK_TRANSACTION', 'DEPRECIATION', 'CLOSING', 'OPENING') NOT NULL DEFAULT 'MANUAL',
    `sourceId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounting_entries_reversalOfId_key`(`reversalOfId`),
    INDEX `accounting_entries_companyId_date_idx`(`companyId`, `date`),
    INDEX `accounting_entries_journalId_date_idx`(`journalId`, `date`),
    INDEX `accounting_entries_companyId_sourceType_sourceId_idx`(`companyId`, `sourceType`, `sourceId`),
    UNIQUE INDEX `accounting_entries_fiscalYearId_entryNumber_key`(`fiscalYearId`, `entryNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounting_entry_lines` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `debit` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `auxiliaryNumber` VARCHAR(20) NULL,
    `auxiliaryLabel` VARCHAR(191) NULL,
    `letter` VARCHAR(10) NULL,
    `letteredAt` DATE NULL,
    `foreignAmount` DECIMAL(15, 2) NULL,
    `foreignCurrency` CHAR(3) NULL,

    INDEX `accounting_entry_lines_entryId_idx`(`entryId`),
    INDEX `accounting_entry_lines_companyId_accountId_idx`(`companyId`, `accountId`),
    INDEX `accounting_entry_lines_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_assets` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `acquisitionDate` DATE NOT NULL,
    `serviceDate` DATE NOT NULL,
    `cost` DECIMAL(15, 2) NOT NULL,
    `residualValue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `method` ENUM('LINEAR', 'DECLINING') NOT NULL DEFAULT 'LINEAR',
    `durationMonths` INTEGER NOT NULL,
    `assetAccountNumber` VARCHAR(20) NOT NULL,
    `depreciationAccountNumber` VARCHAR(20) NOT NULL,
    `expenseAccountNumber` VARCHAR(20) NOT NULL,
    `status` ENUM('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED') NOT NULL DEFAULT 'ACTIVE',
    `disposedAt` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fixed_assets_companyId_status_idx`(`companyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_asset_depreciations` (
    `id` VARCHAR(191) NOT NULL,
    `fixedAssetId` VARCHAR(191) NOT NULL,
    `fiscalYearId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `cumulativeAmount` DECIMAL(15, 2) NOT NULL,
    `entryId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fixed_asset_depreciations_fiscalYearId_idx`(`fiscalYearId`),
    UNIQUE INDEX `fixed_asset_depreciations_fixedAssetId_fiscalYearId_key`(`fixedAssetId`, `fiscalYearId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vat_periods` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `regime` ENUM('FRANCHISE', 'REEL_SIMPLIFIE', 'REEL_NORMAL_MENSUEL', 'REEL_NORMAL_TRIMESTRIEL') NOT NULL,
    `formType` VARCHAR(10) NOT NULL,
    `status` ENUM('OPEN', 'PREPARED', 'VALIDATED', 'DECLARED') NOT NULL DEFAULT 'OPEN',
    `dueDate` DATE NULL,
    `collectedVat` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `deductibleVat` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `deductibleVatAssets` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `creditCarriedOver` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netVatDue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `breakdown` JSON NULL,
    `validatedAt` DATETIME(3) NULL,
    `validatedById` VARCHAR(191) NULL,
    `declaredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `vat_periods_companyId_status_idx`(`companyId`, `status`),
    UNIQUE INDEX `vat_periods_companyId_startDate_endDate_key`(`companyId`, `startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `originalFileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `checksumSha256` CHAR(64) NOT NULL,
    `category` ENUM('SALES_INVOICE', 'PURCHASE_INVOICE', 'RECEIPT', 'BANK_STATEMENT', 'TAX', 'LEGAL', 'PAYROLL', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `documentDate` DATE NULL,
    `ocrStatus` ENUM('NONE', 'PENDING', 'DONE', 'FAILED') NOT NULL DEFAULT 'NONE',
    `ocrData` JSON NULL,
    `ocrVerifiedAt` DATETIME(3) NULL,
    `suggestedCategory` ENUM('SALES_INVOICE', 'PURCHASE_INVOICE', 'RECEIPT', 'BANK_STATEMENT', 'TAX', 'LEGAL', 'PAYROLL', 'OTHER') NULL,
    `uploadedById` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `documents_storageKey_key`(`storageKey`),
    INDEX `documents_companyId_category_idx`(`companyId`, `category`),
    INDEX `documents_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `documents_companyId_checksumSha256_idx`(`companyId`, `checksumSha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_links` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `entityType` ENUM('BANK_TRANSACTION', 'INVOICE', 'QUOTE', 'PURCHASE', 'ACCOUNTING_ENTRY', 'FIXED_ASSET') NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_links_companyId_entityType_entityId_idx`(`companyId`, `entityType`, `entityId`),
    UNIQUE INDEX `document_links_documentId_entityType_entityId_key`(`documentId`, `entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_suggestions` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(50) NOT NULL,
    `entityType` VARCHAR(50) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `confidence` DECIMAL(4, 3) NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_suggestions_companyId_status_idx`(`companyId`, `status`),
    INDEX `ai_suggestions_companyId_entityType_entityId_idx`(`companyId`, `entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(255) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    INDEX `notifications_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `actorType` ENUM('USER', 'SUPER_ADMIN', 'SYSTEM') NOT NULL DEFAULT 'USER',
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(50) NULL,
    `entityId` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `audit_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_data_access_grants` (
    `id` VARCHAR(191) NOT NULL,
    `adminUserId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_data_access_grants_adminUserId_expiresAt_idx`(`adminUserId`, `expiresAt`),
    INDEX `admin_data_access_grants_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(20) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `source` ENUM('APP', 'CONTACT_FORM', 'EMAIL') NOT NULL DEFAULT 'APP',
    `contactName` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,

    UNIQUE INDEX `support_tickets_reference_key`(`reference`),
    INDEX `support_tickets_status_priority_idx`(`status`, `priority`),
    INDEX `support_tickets_userId_idx`(`userId`),
    INDEX `support_tickets_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_ticket_messages` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `isStaff` BOOLEAN NOT NULL DEFAULT false,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_ticket_messages_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `application_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(255) NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_announcements` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `level` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `system_announcements_isActive_startsAt_idx`(`isActive`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `application_errors` (
    `id` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `path` VARCHAR(255) NULL,
    `method` VARCHAR(10) NULL,
    `userId` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `application_errors_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limit_counters` (
    `key` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `windowStart` DATETIME(3) NOT NULL,

    INDEX `rate_limit_counters_windowStart_idx`(`windowStart`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verification_tokens` ADD CONSTRAINT `verification_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mfa_recovery_codes` ADD CONSTRAINT `mfa_recovery_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_users` ADD CONSTRAINT `company_users_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_users` ADD CONSTRAINT `company_users_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_users` ADD CONSTRAINT `company_users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_invitations` ADD CONSTRAINT `company_invitations_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_invitations` ADD CONSTRAINT `company_invitations_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_invitations` ADD CONSTRAINT `company_invitations_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `subscription_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_payments` ADD CONSTRAINT `subscription_payments_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vat_rates` ADD CONSTRAINT `vat_rates_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_items` ADD CONSTRAINT `quote_items_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `quotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_items` ADD CONSTRAINT `quote_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_originalInvoiceId_fkey` FOREIGN KEY (`originalInvoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_recurringInvoiceId_fkey` FOREIGN KEY (`recurringInvoiceId`) REFERENCES `recurring_invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_items` ADD CONSTRAINT `invoice_items_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_items` ADD CONSTRAINT `invoice_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `number_sequences` ADD CONSTRAINT `number_sequences_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurring_invoices` ADD CONSTRAINT `recurring_invoices_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurring_invoices` ADD CONSTRAINT `recurring_invoices_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_bankTransactionId_fkey` FOREIGN KEY (`bankTransactionId`) REFERENCES `bank_transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `transaction_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_categories` ADD CONSTRAINT `transaction_categories_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `transaction_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `bank_imports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_imports` ADD CONSTRAINT `bank_imports_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_imports` ADD CONSTRAINT `bank_imports_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categorization_rules` ADD CONSTRAINT `categorization_rules_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categorization_rules` ADD CONSTRAINT `categorization_rules_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `transaction_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fiscal_years` ADD CONSTRAINT `fiscal_years_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_accounts` ADD CONSTRAINT `accounting_accounts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_journals` ADD CONSTRAINT `accounting_journals_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_journals` ADD CONSTRAINT `accounting_journals_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entries` ADD CONSTRAINT `accounting_entries_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entries` ADD CONSTRAINT `accounting_entries_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `accounting_journals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entries` ADD CONSTRAINT `accounting_entries_fiscalYearId_fkey` FOREIGN KEY (`fiscalYearId`) REFERENCES `fiscal_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entries` ADD CONSTRAINT `accounting_entries_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `accounting_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entry_lines` ADD CONSTRAINT `accounting_entry_lines_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entry_lines` ADD CONSTRAINT `accounting_entry_lines_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `accounting_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_entry_lines` ADD CONSTRAINT `accounting_entry_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounting_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_asset_depreciations` ADD CONSTRAINT `fixed_asset_depreciations_fixedAssetId_fkey` FOREIGN KEY (`fixedAssetId`) REFERENCES `fixed_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_asset_depreciations` ADD CONSTRAINT `fixed_asset_depreciations_fiscalYearId_fkey` FOREIGN KEY (`fiscalYearId`) REFERENCES `fiscal_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vat_periods` ADD CONSTRAINT `vat_periods_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_links` ADD CONSTRAINT `document_links_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_links` ADD CONSTRAINT `document_links_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_suggestions` ADD CONSTRAINT `ai_suggestions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_data_access_grants` ADD CONSTRAINT `admin_data_access_grants_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_data_access_grants` ADD CONSTRAINT `admin_data_access_grants_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
