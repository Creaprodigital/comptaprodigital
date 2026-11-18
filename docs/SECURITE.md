# Sécurité, RGPD, sauvegardes

État des mesures à l'issue des phases 1 à 3. Ce document distingue ce qui est **en place et testé** de ce qui
**reste à faire** : il ne constitue pas une attestation de conformité.

## Mesures en place

| Domaine | Mesure | Vérifiée par |
|---|---|---|
| Mots de passe | Argon2id ; 12 caractères minimum, quatre familles ; jamais journalisés | `tests/unit/security.test.ts`, `tests/integration/auth.test.ts` |
| Sessions | Jeton opaque 256 bits, empreinte SHA-256 en base, cookie `httpOnly` / `SameSite=Lax` / `Secure` + `__Host-` en HTTPS, expiration absolue et d'inactivité, révocation immédiate | intégration + `tests/e2e/securite.spec.ts` |
| Double authentification | TOTP, secret chiffré AES-256-GCM, codes de secours hachés à usage unique, session provisoire sans droits | intégration + parcours e2e |
| Anti-énumération | Réponses identiques à l'inscription, à la connexion et à la réinitialisation, que le compte existe ou non | intégration |
| Force brute | Verrouillage 15 min après 5 échecs ; limitation de débit par IP et par adresse e-mail, stockée en base | intégration |
| CSRF | Contrôle de l'en-tête `Origin` sur toute requête mutatrice, corps JSON exigé, cookie `SameSite=Lax` | e2e |
| XSS | Échappement par React, aucun HTML utilisateur injecté, CSP restrictive, e-mails échappés | revue + e2e (en-têtes) |
| Injection SQL | Prisma et requêtes paramétrées uniquement (aucune concaténation) | revue |
| Validation | Schémas Zod côté serveur sur chaque entrée, erreurs par champ, aucune fuite technique | unitaires + e2e |
| Contrôle d'accès | RBAC en base, vérifié à chaque appel d'API et rendu de page ; 404 pour un non-membre | `tests/integration/tenancy.test.ts`, e2e |
| Isolation multi-entreprises | Client Prisma cloisonné : filtre imposé, écriture ou filtre inter-entreprises rejeté | intégration + e2e |
| En-têtes | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, pas de `X-Powered-By` | e2e |
| Chiffrement | TLS par Caddy ; secrets MFA et IBAN chiffrés au repos ; jetons stockés hachés | unitaires |
| Audit | Journal en ajout seul des actions sensibles (connexions, MFA, membres, entreprise), sans secret | intégration |
| Secrets | Variables d'environnement validées au démarrage, jamais envoyées au navigateur, `.env` ignoré par Git | revue |
| Formulaires | Méthode POST explicite : un envoi avant le chargement du JavaScript ne place jamais un mot de passe dans l'URL | revue |
| Factures | Émission atomique et verrouillage : aucune modification silencieuse d'une facture émise (409) ; historique dans le journal d'audit | `tests/integration/invoicing.test.ts`, e2e |
| Fichiers | Logo accepté uniquement en PNG/JPEG vérifié par signature binaire, 500 Ko maximum, servi avec `nosniff` | intégration |
| Exports CSV | Cellules commençant par `=`, `+`, `-`, `@` neutralisées (injection de formules) | intégration |
| Données bancaires de l'entreprise | IBAN chiffré au repos, jamais renvoyé en entier au navigateur | intégration |
| Banque | Aucun identifiant bancaire demandé ni stocké ; date et montant d'une opération importée non modifiables ; toute modification tracée | conception, `tests/integration/bank.test.ts` |
| Écritures comptables | Validation numérotée en continu ; aucune écriture validée n'est modifiée ni supprimée (contre-passation) ; périodes verrouillées et exercices clôturés fermés à toute écriture ; journalisation | `tests/integration/accounting.test.ts`, e2e |
| Déclarations de TVA | Préparation et validation par des droits distincts (`vat:write`, `vat:validate`) ; montants figés ; aucune transmission automatique | `tests/integration/vat.test.ts` |
| Exports comptables | Droit `exports:run`, limitation de débit, FEC limité aux écritures validées, export journalisé | intégration, e2e |
| Relevés importés | Taille bornée, analyse sans résolution d'entités XML externes, règles sans expressions régulières | `tests/unit/bank-parsers.test.ts` |
| Documents | Type vérifié par signature (PDF, JPEG, PNG), 10 Mo maximum, chiffrement applicatif AES-256-GCM avant stockage, accès uniquement par l'API après contrôle des droits, téléchargements journalisés | intégration, e2e |
| Aperçu des documents | Servi avec `nosniff` et une CSP `default-src 'none'`, affichable uniquement dans un cadre de la même origine | e2e |
| Super administrateur | Aucun accès implicite aux données des entreprises | intégration |

## Limites connues et travaux restants (phase 8)

- **CSP** : `script-src` autorise encore `'unsafe-inline'` (hydratation). Passage à une CSP par nonce à prévoir.
- **Adresse IP du client** : lue dans `X-Forwarded-For`. L'application doit donc toujours être derrière le reverse
  proxy fourni, qui écrase cet en-tête.
- **TOTP** : un code reste réutilisable pendant sa fenêtre de validité (30 s, ± 1 pas) ; la limitation de débit en
  réduit l'intérêt, un anti-rejeu strict reste à ajouter.
- **Chiffrement au repos de la base** : à assurer au niveau du volume du VPS ou de MySQL (non configuré ici).
- **Purge planifiée** : assurée par la tâche quotidienne (`jobs`), à condition de la planifier (voir le guide de
  déploiement). Les jetons de vérification expirés ne sont pas encore purgés.
- **Clé de chiffrement** : `APP_ENCRYPTION_KEY` protège les secrets en base et les documents. Sa rotation n'est
  pas outillée ; sa perte rend les documents illisibles. À conserver hors du serveur.
- **Documents sur disque local** : le dossier de stockage doit être sauvegardé en plus de la base (voir le guide
  de déploiement). Avec S3, activez le versionnage et la réplication chez le fournisseur.
- **Suppression de compte en libre-service** : non livrée (l'export des données l'est). Les demandes d'effacement
  sont à traiter manuellement en attendant, en respectant les durées de conservation légales.
- **Audit externe** : test d'intrusion et revue de code indépendants recommandés avant ouverture au public.
- **Antivirus des pièces jointes** : non intégré. Les fichiers ne sont jamais exécutés ni interprétés par le
  serveur, mais un document téléchargé par un utilisateur peut contenir un contenu malveillant pour son poste.
- **Journalisation centralisée, alertes** : à traiter avec la supervision.

## RGPD

- **Minimisation** : seules les données nécessaires au service sont collectées ; aucun traceur tiers, aucun cookie
  publicitaire ; polices servies localement (aucun appel à un CDN de polices).
- **Droit d'accès et portabilité** : export JSON des données personnelles depuis *Compte et sécurité*
  (`GET /api/v1/me/export`), journalisé.
- **Rôles** : l'éditeur est responsable de traitement pour les comptes, sous-traitant pour les données saisies dans
  les entreprises (clients, fournisseurs…). Un accord de sous-traitance est à joindre aux CGV.
- **Durées de conservation** : annoncées dans la politique de confidentialité (pièces comptables : dix ans). Leur
  application automatique (purges, anonymisation) reste à implémenter.
- **Registre des traitements, analyse d'impact, liste des sous-traitants** : documents à établir par l'éditeur.
- Les pages légales fournies sont des **modèles** à compléter (variables `NEXT_PUBLIC_LEGAL_*`) et à faire valider
  par un juriste.

## Sauvegardes et restauration

`scripts/backup-db.sh` produit un export complet de la base, compressé et chiffré en AES-256 (clé dérivée par
PBKDF2 d'une phrase secrète stockée dans un fichier protégé), accompagné d'une somme de contrôle, avec rotation.
`scripts/restore-db.sh` vérifie la somme de contrôle, déchiffre et recharge l'export.

Procédure de test de restauration (à rejouer au moins une fois par trimestre et après chaque changement de schéma
important) :

```bash
mysql -uroot -p -e "CREATE DATABASE comptapro_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

```bash
DATABASE_URL="mysql://comptapro:MOT_DE_PASSE@127.0.0.1:3306/comptapro_restore" BACKUP_PASSPHRASE_FILE=/etc/comptapro/backup.key ./scripts/restore-db.sh /var/backups/comptapro/<fichier>.sql.gz.enc --yes
```

Comparez ensuite quelques volumes entre la production et la base restaurée (nombre d'utilisateurs, d'entreprises,
de factures, somme des montants facturés), puis supprimez la base de test.

Cette procédure a été exécutée pendant le développement : sauvegarde de la base de démonstration, restauration dans
une base vide, comptages et totaux identiques ; une mauvaise phrase secrète fait échouer la restauration sans rien
écrire.

À conserver **hors du serveur** : la phrase secrète des sauvegardes, la clé `APP_ENCRYPTION_KEY`, et une copie
récente des sauvegardes. Sans `APP_ENCRYPTION_KEY`, les secrets de double authentification et les IBAN d'une base
restaurée sont inutilisables.

## Signaler une vulnérabilité

Écrivez à l'adresse de contact de l'éditeur en décrivant le problème et les étapes pour le reproduire. Ne publiez
pas de détails avant correction.
