-- CreateTable
CREATE TABLE `Message` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `address` VARCHAR(191) NOT NULL,
    `cost` DOUBLE NOT NULL,
    `topic_id` INTEGER NULL,
    `victory` BOOLEAN NOT NULL DEFAULT false,
    `content` TEXT NULL,
    `response` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Topic` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `short_desc` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `Topic`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
