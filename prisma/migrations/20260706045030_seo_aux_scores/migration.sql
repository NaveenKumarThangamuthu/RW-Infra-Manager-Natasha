-- AlterTable: add Lighthouse category scores (accessibility, best-practices, seo)
ALTER TABLE `seo_report`
  ADD COLUMN `accessibilityScore` DECIMAL(5, 2) NULL AFTER `perfScore`,
  ADD COLUMN `bestPracticesScore` DECIMAL(5, 2) NULL AFTER `accessibilityScore`,
  ADD COLUMN `seoScore`           DECIMAL(5, 2) NULL AFTER `bestPracticesScore`;
