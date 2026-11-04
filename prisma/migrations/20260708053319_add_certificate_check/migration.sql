-- CreateTable
CREATE TABLE `certificate_check` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `distributor` VARCHAR(128) NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `driveFileId` VARCHAR(64) NOT NULL,
    `driveModifiedTime` DATETIME(3) NULL,
    `owner` VARCHAR(16) NOT NULL,
    `subject` TEXT NOT NULL,
    `issuer` TEXT NOT NULL,
    `notBefore` DATETIME(3) NOT NULL,
    `notAfter` DATETIME(3) NOT NULL,
    `fingerprintSha256` VARCHAR(64) NOT NULL,
    `parsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(16) NOT NULL DEFAULT 'success',
    `errorMessage` TEXT NULL,
    `alertedAt` DATETIME(3) NULL,

    INDEX `certificate_check_notAfter_idx`(`notAfter`),
    INDEX `certificate_check_distributor_idx`(`distributor`),
    UNIQUE INDEX `certificate_check_distributor_filename_key`(`distributor`, `filename`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

