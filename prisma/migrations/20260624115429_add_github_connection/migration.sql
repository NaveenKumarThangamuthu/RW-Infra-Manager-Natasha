-- CreateTable
CREATE TABLE `github_connection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userEmail` VARCHAR(255) NOT NULL,
    `githubLogin` VARCHAR(64) NULL,
    `cipher` LONGBLOB NOT NULL,
    `iv` LONGBLOB NOT NULL,
    `authTag` LONGBLOB NOT NULL,
    `scopes` VARCHAR(255) NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `tokenPrefix` VARCHAR(8) NULL,
    `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `github_connection_userEmail_key`(`userEmail`),
    INDEX `github_connection_userEmail_idx`(`userEmail`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

