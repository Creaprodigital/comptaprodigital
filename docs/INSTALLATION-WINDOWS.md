# Installation locale sous Windows

Testé avec Windows 10/11, PowerShell. Comptez une quinzaine de minutes.

## 1. Prérequis

| Outil | Version | Installation |
|---|---|---|
| Git | récente | `winget install Git.Git` |
| Node.js | 22 LTS | `winget install OpenJS.NodeJS.LTS` |
| Docker Desktop | récente | `winget install Docker.DockerDesktop` (redémarrage requis) |

Docker fournit MySQL 8 et une boîte e-mail de test sans rien installer d'autre. Si vous préférez ne pas utiliser
Docker, voir [Sans Docker](#sans-docker) plus bas.

Vérifiez l'installation dans un nouveau terminal PowerShell :

```powershell
node --version; npm --version; git --version; docker --version
```

## 2. Récupérer le projet

```powershell
git clone https://github.com/Creaprodigital/comptaprodigital.git
```

```powershell
cd comptaprodigital
```

## 3. Démarrer MySQL et la boîte e-mail de test

Lancez Docker Desktop, puis :

```powershell
docker compose -f docker-compose.dev.yml up -d
```

- MySQL écoute sur `localhost:3306` (base `comptapro`, utilisateur `comptapro`, mot de passe `comptapro_dev`).
- Mailpit affiche les e-mails envoyés par l'application sur <http://localhost:8025>.

## 4. Configurer l'environnement

```powershell
Copy-Item .env.example .env
```

Générez la clé de chiffrement :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Ouvrez `.env` (par exemple avec `notepad .env`) et renseignez :

```dotenv
APP_ENCRYPTION_KEY="<la clé générée ci-dessus>"
SMTP_HOST="localhost"
SMTP_PORT=1025
```

Les autres valeurs par défaut conviennent au développement.

## 5. Installer, migrer, initialiser

```powershell
npm install
```

```powershell
npm run db:deploy
```

```powershell
npm run db:seed:demo
```

`db:seed:demo` crée les données de référence (rôles, formules, taux de TVA) ainsi qu'un compte de démonstration :
`demo@comptaprodigital.fr` / `Demo-ComptaPro-2026!`. Pour une base sans données d'exemple, utilisez
`npm run db:seed`.

## 6. Lancer l'application

```powershell
npm run dev
```

Ouvrez <http://localhost:3000>. Pour créer votre propre compte, inscrivez-vous puis ouvrez l'e-mail de
confirmation dans Mailpit (<http://localhost:8025>).

## 7. Lancer les tests

```powershell
npm test
```

```powershell
npx playwright install chromium
```

```powershell
npm run test:e2e
```

Les tests utilisent les bases `comptapro_test` et `comptapro_e2e`, créées automatiquement par le conteneur MySQL.

## Sans Docker

1. Installez MySQL 8 : `winget install Oracle.MySQL`, puis créez la base et l'utilisateur :

   ```sql
   CREATE DATABASE comptapro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE comptapro_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE comptapro_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'comptapro'@'localhost' IDENTIFIED BY 'comptapro_dev';
   GRANT ALL PRIVILEGES ON *.* TO 'comptapro'@'localhost';
   ```

2. Laissez `SMTP_HOST` vide dans `.env` : en développement, les e-mails (dont le lien de confirmation) sont alors
   affichés dans le terminal où tourne `npm run dev`.

## Problèmes fréquents

| Symptôme | Solution |
|---|---|
| `Configuration invalide : APP_ENCRYPTION_KEY…` | La clé doit faire 32 octets en base64 : régénérez-la (étape 4). |
| `Can't reach database server at 127.0.0.1:3306` | Docker Desktop n'est pas démarré, ou le port 3306 est pris par un autre MySQL (arrêtez-le ou changez le port dans `docker-compose.dev.yml` et `DATABASE_URL`). |
| `EPERM` ou erreur de script PowerShell avec `npm` | Exécutez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, puis rouvrez le terminal. |
| Erreur à l'installation d'un module natif | Vérifiez que Node.js est en 64 bits et en version 22 ; supprimez `node_modules` puis relancez `npm install`. |
| Le port 3000 est occupé | `npm run dev -- -p 3001`, et mettez `APP_URL="http://localhost:3001"` dans `.env`. |
