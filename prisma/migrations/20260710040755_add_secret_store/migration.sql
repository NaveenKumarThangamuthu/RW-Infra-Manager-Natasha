-- CreateTable
CREATE TABLE `secret_store` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `ciphertext` TEXT NOT NULL,
    `iv` VARCHAR(32) NOT NULL,
    `authTag` VARCHAR(32) NOT NULL,
    `description` VARCHAR(255) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedBy` VARCHAR(128) NOT NULL DEFAULT 'system',

    UNIQUE INDEX `secret_store_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

