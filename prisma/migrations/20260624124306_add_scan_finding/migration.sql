-- CreateTable
CREATE TABLE `scan_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `repoFullName` VARCHAR(255) NOT NULL,
    `repoOwner` VARCHAR(64) NOT NULL,
    `repoName` VARCHAR(128) NOT NULL,
    `branch` VARCHAR(128) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `triggeredBy` VARCHAR(255) NOT NULL,
    `trigger` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `durationMs` INTEGER NULL,
    `commitSha` VARCHAR(40) NULL,
    `errorMessage` TEXT NULL,
    `scannerMeta` TEXT NULL,

    INDEX `scan_job_repoFullName_startedAt_idx`(`repoFullName`, `startedAt`),
    INDEX `scan_job_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `finding` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scanJobId` INTEGER NOT NULL,
    `scanner` VARCHAR(32) NOT NULL,
    `severity` VARCHAR(8) NOT NULL,
    `category` VARCHAR(16) NOT NULL,
    `ruleId` VARCHAR(128) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `description` TEXT NULL,
    `file` VARCHAR(500) NULL,
    `line` INTEGER NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `repoFullName` VARCHAR(255) NOT NULL,
    `branch` VARCHAR(128) NOT NULL,
    `suppressedAt` DATETIME(3) NULL,
    `suppressedBy` VARCHAR(255) NULL,
    `suppressedReason` TEXT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `finding_repoFullName_severity_idx`(`repoFullName`, `severity`),
    INDEX `finding_scanner_idx`(`scanner`),
    INDEX `finding_severity_suppressedAt_idx`(`severity`, `suppressedAt`),
    UNIQUE INDEX `finding_repoFullName_fingerprint_key`(`repoFullName`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `finding` ADD CONSTRAINT `finding_scanJobId_fkey` FOREIGN KEY (`scanJobId`) REFERENCES `scan_job`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

