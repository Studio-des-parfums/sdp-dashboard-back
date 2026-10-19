# SDP Dashboard Back

Backend Express / TypeScript pour le Backoffice Dashboard du Studio des Parfums.
Gère les projets internes, la billetterie support, la messagerie, les notifications et le catalogue unifié (ingrédients, règles olfactives, coffrets, ateliers, options).

## Prérequis

- Node.js >= 18
- MySQL (base `sdp_dashboard`)

## Installation & Démarrage

```bash
npm install
npm run dev
```

Par défaut, l'application écoute sur le port `3001` (configurable via `PORT` dans `.env`).

---

## Tests Automatisés d’API avec Bruno (`/bruno`)

Une suite complète de 17 requêtes et 47 assertions automatisées couvre l'intégralité des routes de l'API.

Organisation des dossiers :
- `01-Consultation/` (11 requêtes) : **Lecture seule** (GET health, projets, ateliers, coffrets, ingrédients, règles d'ingrédients, options, tickets, notifications, conversations, utilisateurs). Garanti 0 écriture en base, 100 % sécurisé pour tester la **Production** ou le Local.
- `02-Creations-Modifications/` (6 requêtes) : **Cycles CRUD et mutations** (POST, PUT/PATCH, DELETE pour utilisateurs et coffrets).
- `03-Tous-Les-Tests/` (17 requêtes) : **Suite complète** regroupant l'ensemble des modules (Consultation + CRUD).

> ⚠️ **IMPORTANT — Nettoyage de la base de données :**
> Lorsque vous exécutez le dossier **`02-Creations-Modifications`** ou **`03-Tous-Les-Tests`**, des enregistrements de test temporaires peuvent persister en base (`*Bruno*`).
> **Il faut impérativement exécuter le script de nettoyage après chaque exécution du dossier 02 ou 03 :**
> ```bash
> npx tsx scripts/cleanup_test_data.ts
> ```

### Commandes d'exécution rapide (CLI)

1. **Tester la Production en toute sécurité (0 écriture) :**
```bash
cd bruno
bru run 01-Consultation -r --env prod
```

2. **Tester le Local en consultation seule :**
```bash
cd bruno
bru run 01-Consultation -r --env local
```

3. **Exécuter la suite complète en Local :**
```bash
cd bruno
bru run 03-Tous-Les-Tests -r --env local
# Toujours nettoyer la base après :
npx tsx ../scripts/cleanup_test_data.ts
```

4. **Exécuter uniquement les mutations CRUD en Local :**
```bash
cd bruno
bru run 02-Creations-Modifications -r --env local
# Toujours nettoyer la base après :
npx tsx ../scripts/cleanup_test_data.ts
```
