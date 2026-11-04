-- CreateTable
CREATE TABLE `allowed_user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `allowed_user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `server_tag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matchKey` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `region` VARCHAR(191) NULL,
    `instanceType` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'Other',
    `services` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `server_tag_matchKey_key`(`matchKey`),
    INDEX `server_tag_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monthly_cost` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `month` VARCHAR(191) NOT NULL,
    `dimension` VARCHAR(191) NOT NULL,
    `costKey` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `monthly_cost_dimension_idx`(`dimension`),
    UNIQUE INDEX `monthly_cost_month_dimension_costKey_key`(`month`, `dimension`, `costKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `resource_cost_snapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `runLabel` VARCHAR(191) NOT NULL,
    `service` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(512) NOT NULL,
    `region` VARCHAR(191) NULL,
    `usageType` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `rangeStart` VARCHAR(191) NOT NULL,
    `rangeEnd` VARCHAR(191) NOT NULL,

    INDEX `resource_cost_snapshot_snapshotAt_idx`(`snapshotAt`),
    INDEX `resource_cost_snapshot_service_snapshotAt_idx`(`service`, `snapshotAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tag_cost_snapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `runLabel` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'USD',

    INDEX `tag_cost_snapshot_snapshotAt_idx`(`snapshotAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_run` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(191) NOT NULL,
    `runLabel` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'running',
    `message` TEXT NULL,

    INDEX `refresh_run_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
