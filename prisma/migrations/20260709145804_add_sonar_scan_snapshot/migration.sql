-- CreateTable
CREATE TABLE `sonar_scan_snapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `repo` VARCHAR(128) NOT NULL,
    `branch` VARCHAR(64) NOT NULL,
    `sonarProject` VARCHAR(128) NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bugs` INTEGER NOT NULL DEFAULT 0,
    `vulns` INTEGER NOT NULL DEFAULT 0,
    `hotspots` INTEGER NOT NULL DEFAULT 0,
    `smells` INTEGER NOT NULL DEFAULT 0,
    `blockers` INTEGER NOT NULL DEFAULT 0,
    `criticals` INTEGER NOT NULL DEFAULT 0,
    `ncloc` INTEGER NOT NULL DEFAULT 0,
    `coverage` DOUBLE NULL,
    `gate` VARCHAR(16) NULL,
    `healthKey` VARCHAR(16) NULL,

    INDEX `sonar_scan_snapshot_repo_branch_capturedAt_idx`(`repo`, `branch`, `capturedAt`),
    INDEX `sonar_scan_snapshot_capturedAt_idx`(`capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

