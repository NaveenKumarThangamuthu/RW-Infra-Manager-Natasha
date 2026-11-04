-- CreateTable
CREATE TABLE `seo_target` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(500) NOT NULL,
    `label` VARCHAR(255) NULL,
    `device` VARCHAR(16) NOT NULL DEFAULT 'both',
    `runPsi` BOOLEAN NOT NULL DEFAULT true,
    `runGtmetrix` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `seo_target_active_idx`(`active`),
    UNIQUE INDEX `seo_target_url_device_key`(`url`, `device`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `targetId` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `device` VARCHAR(16) NOT NULL,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `runLabel` VARCHAR(16) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'success',
    `perfScore` DECIMAL(5, 2) NULL,
    `lcpMs` INTEGER NULL,
    `fcpMs` INTEGER NULL,
    `ttfbMs` INTEGER NULL,
    `tbtMs` INTEGER NULL,
    `cls` DECIMAL(6, 4) NULL,
    `inpMs` INTEGER NULL,
    `speedIndexMs` INTEGER NULL,
    `totalBytes` BIGINT NULL,
    `requests` INTEGER NULL,
    `gtmetrixGrade` VARCHAR(4) NULL,
    `structureScore` DECIMAL(5, 2) NULL,
    `testId` VARCHAR(128) NULL,
    `raw` LONGTEXT NULL,
    `errorMessage` TEXT NULL,

    INDEX `seo_report_targetId_runAt_idx`(`targetId`, `runAt`),
    INDEX `seo_report_source_runAt_idx`(`source`, `runAt`),
    INDEX `seo_report_runAt_idx`(`runAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `seo_report` ADD CONSTRAINT `seo_report_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `seo_target`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
