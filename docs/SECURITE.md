# Sécurité, RGPD, sauvegardes

État des mesures à l'issue des phases 1 à 3. Ce document distingue ce qui est **en place et testé** de ce qui
**reste à faire** : il ne constitue pas une attestation de conformité.

## Mesures en place

| Domaine | Mesure | Vérifiée par |
|---|---|---|
| Mots de passe | Argon2id ; 12 caractères minimum, quatre familles ; jamais journalisés | `tests/unit/security.test.ts`, `tests/integration/auth.test.ts` |
| Sessions | Jeton opaque 256 bits, empreinte SHA-256 en base, cookie `httpOnly` / `SameSite=Lax` / `Secure` + `__Host-` en HTTPS, expiration absolue et d'inactivité, révocation immédiate | intégration + `tests/e2e/securite.spec.ts` |
| Double authentification | TOTP, secret chiffré AES-256-GCM, codes de secours hachés à usage unique, session provisoire sans droits ; **anti-rejeu** : un code (pas de 30 s) n'est accepté qu'une fois | intégration + parcours e2e |
| Anti-énumération | Réponses identiques à l'inscription, à la connexion et à la réinitialisation, que le compte existe ou non | intégration |
| Force brute | Verrouillage 15 min après 5 échecs ; limitation de débit par IP et par adresse e-mail, stockée en base | intégration |
| CSRF | Contrôle de l'en-tête `Origin` sur toute requête mutatrice, corps JSON exigé, cookie `SameSite=Lax` | e2e |
| XSS | Échappement par React, aucun HTML utilisateur injecté, CSP restrictive, e-mails échappés | revue + e2e (en-têtes) |
| Injection SQL | Prisma et requêtes paramétrées uniquement (aucune concaténation) | revue |
| Validation | Schémas Zod côté serveur sur chaque entrée, erreurs par champ, aucune fuite technique | unitaires + e2e |
| Contrôle d'accès | RBAC en base, vérifié à chaque appel d'API et rendu de page ; 404 pour un non-membre | `tests/integration/tenancy.test.ts`, e2e |
| Isolation multi-entreprises | Client Prisma cloisonné : filtre imposé, écriture ou filtre inter-entreprises rejeté | intégration + e2e |
| En-têtes | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, pas de `X-Powered-By` | e2e |
| Intégrité des scripts | SRI (option expérimentale de Next.js) : empreinte SHA-256 sur les scripts d'amorçage — la version actuelle ne l'ajoute pas aux scripts chargés ensuite ; violations de CSP rapportées et consignées (`/api/v1/csp-report`) | e2e |
| Chiffrement | TLS par Caddy ; secrets MFA et IBAN chiffrés au repos ; jetons stockés hachés ; rotation de la clé outillée (`npm run keys:rotate`) | unitaires, `tests/integration/securite.test.ts` |
| Antivirus | Analyse ClamAV facultative et bloquante avant tout stockage de fichier (documents, logo) ; dépôt refusé si l'antivirus configuré ne répond pas | `tests/integration/securite.test.ts` |
| Droit à l'effacement | Suppression du compte en libre-service : anonymisation, résiliation, archivage des entreprises (conservation légale des pièces) | `tests/integration/rgpd.test.ts` |
| Conservation | Purges quotidiennes selon les durées publiées (jetons, erreurs, notifications, usage de l'IA, journaux) | `tests/integration/rgpd.test.ts` |
| Matrice des droits | Chaque rôle × chaque permission vérifié sur base réelle, y compris révocation, suspension et abonnement inactif | `tests/integration/permissions.test.ts` |
| Secrets côté client | Aucun secret dans les fichiers servis au navigateur, vérifié à chaque build en CI | `scripts/check-client-bundle.mjs` |
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
| Super administrateur | Double authentification obligatoire ; 404 pour les autres comptes (proxy, pages, API) | intégration, e2e |
| Données des clients | Aucun accès implicite : accès justifié, borné, notifié, révocable, chaque consultation journalisée | intégration, e2e |
| Suspension | Compte suspendu : sessions révoquées, connexion refusée ; entreprise suspendue : accès refusé | intégration |
| Webhooks Stripe | Signature vérifiée sur le corps brut, tolérance 5 min, idempotence, corps limité à 1 Mo | intégration |
| Assistant IA | Clé serveur uniquement ; consentement de l'entreprise ; outils en lecture seule, cloisonnés et filtrés par rôle ; aucune proposition appliquée sans validation ; quota et journal d'usage | intégration, e2e |
| Export du journal d'audit | Cellules neutralisées contre l'injection de formules (CSV) | intégration |

## Choix assumés et limites connues

- **CSP et scripts en ligne** : `script-src` autorise `'unsafe-inline'`. Une CSP par nonce est incompatible avec le
  prérendu partiel (`cacheComponents`) sur lequel repose l'application (documentation Next.js, « Content Security
  Policy »). Compensations : aucune source externe, aucun `eval` en production, échappement systématique par React,
  intégrité (SRI) des scripts d'amorçage — partielle, l'option étant expérimentale — et rapports de violation
  consignés et signalés dans l'alerte quotidienne.
- **Adresse IP du client** : lue dans `X-Forwarded-For`. L'application doit donc toujours être derrière le reverse
  proxy fourni, qui écrase cet en-tête.
- **Chiffrement au repos de la base** : à assurer au niveau du volume du VPS ou de MySQL (non configuré ici). Les
  secrets sensibles (TOTP, IBAN) et les documents sont, eux, chiffrés par l'application.
- **Rotation de la clé** : outillée, mais la clé reste unique pour toute la plateforme ; sa perte rend les documents
  illisibles. À conserver hors du serveur, avec la phrase secrète des sauvegardes.
- **Antivirus** : facultatif (≈ 1,5 Go de mémoire pour ClamAV) ; sans lui, les fichiers ne sont jamais exécutés ni
  interprétés par le serveur, mais un document déposé pourrait être malveillant pour le poste qui l'ouvre.
- **Suppression de compte** : refusée tant qu'une entreprise du titulaire compte d'autres membres (pas de transfert
  de propriété automatique) ; les super administrateurs ne se suppriment pas depuis l'application.
- **Super administrateurs** : désignés uniquement par le seed (`SEED_ADMIN_EMAIL`) ou en base.
- **Journalisation centralisée** : les journaux restent ceux des conteneurs ; l'alerte quotidienne par e-mail couvre
  erreurs, violations CSP, paiements en échec, demandes en souffrance et services en défaut.
- **Audit externe** : un test d'intrusion et une revue de code indépendants restent recommandés avant ouverture au
  public, ainsi que la validation des mécanismes comptables et fiscaux par un professionnel compétent.

### Rotation de la clé de chiffrement

1. Sauvegardez la base et les documents.
2. Générez une nouvelle clé (`openssl rand -base64 32`) ; dans `.env`, placez l'ancienne dans
   `APP_ENCRYPTION_KEY_PREVIOUS` et la nouvelle dans `APP_ENCRYPTION_KEY`, puis redémarrez : tout reste lisible.
3. Lancez `npm run keys:rotate` (ou `docker compose run --rm migrate npx tsx scripts/rotate-encryption-key.ts`) :
   secrets et documents sont rechiffrés ; la commande peut être relancée sans risque.
4. Retirez `APP_ENCRYPTION_KEY_PREVIOUS` et redémarrez. Conservez l'ancienne clé avec les sauvegardes antérieures.

## RGPD

- **Minimisation** : seules les données nécessaires au service sont collectées ; aucun traceur tiers, aucun cookie
  publicitaire ; polices servies localement (aucun appel à un CDN de polices).
- **Droit d'accès et portabilité** : export JSON des données personnelles depuis *Compte et sécurité*
  (`GET /api/v1/me/export`), journalisé.
- **Rôles** : l'éditeur est responsable de traitement pour les comptes, sous-traitant pour les données saisies dans
  les entreprises (clients, fournisseurs…). Un accord de sous-traitance est à joindre aux CGV.
- **Durées de conservation** : annoncées dans la politique de confidentialité et appliquées chaque jour par
  `src/server/modules/retention/service.ts` ; les pièces et écritures comptables sont conservées dix ans.
- **Droit à l'effacement** : suppression du compte depuis *Compte et sécurité* (mot de passe, code de double
  authentification, confirmation). Les données personnelles sont anonymisées ; les entreprises sans autre membre
  sont archivées et leurs pièces conservées pendant la durée légale, sans accès.
- **Registre des traitements, analyse d'impact, liste des sous-traitants** : documents à établir par l'éditeur.
- **IA** : Anthropic intervient comme sous-traitant lorsque l'entreprise active l'assistant (activation facultative,
  révocable, journalisée). Vérifier les conditions contractuelles (conservation des données, transferts hors UE) et
  les mentionner dans l'accord de sous-traitance. Les libellés transmis au modèle sont traités comme des données, pas
  comme des instructions ; les outils de l'assistant ne peuvent rien modifier.
- Les pages légales fournies sont des **modèles** à compléter (variables `NEXT_PUBLIC_LEGAL_*`) et à faire valider
  par un juriste.

## Sauvegardes et restauration

`scripts/backup-db.sh` produit un export complet de la base, compressé et chiffré en AES-256 (clé dérivée par
PBKDF2 d'une phrase secrète stockée dans un fichier protégé), accompagné d'une somme de contrôle, avec rotation.
`scripts/restore-db.sh` vérifie la somme de contrôle, contrôle l'intégrité complète du flux déchiffré (CRC gzip)
**avant** tout import, puis recharge l'export. `scripts/verify-restore.sh` automatise le test de restauration.

Test de restauration (au moins une fois par mois, et après chaque changement de schéma important), dans une base
dédiée créée une fois pour toutes :

```bash
mysql -uroot -p -e "CREATE DATABASE comptapro_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON comptapro_restore.* TO 'comptapro'@'%';"
```

```bash
cd /opt/comptapro && set -a && . ./backup.env && set +a && RESTORE_DATABASE_URL="mysql://comptapro:MOT_DE_PASSE@127.0.0.1:3306/comptapro_restore" ./scripts/verify-restore.sh
```

Le script restaure la sauvegarde la plus récente, vérifie le nombre de tables et de migrations, compare le nombre de
lignes de chaque table avec la production et contrôle l'équilibre de chaque écriture comptable. Il termine par
« RESTAURATION VÉRIFIÉE » ou échoue avec un code non nul.

Il est exécuté à chaque intégration continue (sauvegarde puis restauration de la base de test) et l'a été pendant
le développement sur la base de démonstration. Ont été vérifiés : restauration complète (54 tables, migrations,
écritures équilibrées), refus d'une sauvegarde altérée (somme de contrôle, puis contrôle d'intégrité même sans
somme) et refus d'une mauvaise phrase secrète, **sans rien importer** dans ces deux derniers cas.

À conserver **hors du serveur** : la phrase secrète des sauvegardes, la clé `APP_ENCRYPTION_KEY`, et une copie
récente des sauvegardes. Sans `APP_ENCRYPTION_KEY`, les secrets de double authentification et les IBAN d'une base
restaurée sont inutilisables.

## Signaler une vulnérabilité

Écrivez à l'adresse de contact de l'éditeur en décrivant le problème et les étapes pour le reproduire. Ne publiez
pas de détails avant correction.
