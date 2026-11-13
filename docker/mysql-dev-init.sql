-- Bases supplémentaires pour les tests (intégration et bout en bout).
CREATE DATABASE IF NOT EXISTS comptapro_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS comptapro_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Prisma Migrate a besoin de créer une base temporaire (« shadow database ») en développement.
GRANT ALL PRIVILEGES ON *.* TO 'comptapro'@'%';
FLUSH PRIVILEGES;
