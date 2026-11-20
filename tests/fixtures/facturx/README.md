# Schémas de validation Factur-X (profil EN 16931)

Utilisés uniquement par les tests (`tests/integration/facturx.test.ts`) :

- `Factur-X_1.09_EN16931*.xsd` : schémas XSD officiels Factur-X 1.09 (FNFE-MPE / FeRD), profil EN 16931 ;
- `FACTUR-X_EN16931.sef.json.gz` : règles métier officielles (schématron EN 16931 + Factur-X) compilées pour
  SaxonJS ; `FACTUR-X_EN16931_codedb.xml` : listes de codes utilisées par ces règles.

Provenance : paquet npm `@stafyniaksacha/facturx` 0.6.1 (licence MIT), qui redistribue les fichiers officiels.
