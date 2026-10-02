// Calcul scientifique du besoin calorique (formule de Mifflin-St Jeor) et
// table de référence nutritionnelle. Aucun appel IA ici : tout est déterministe.

export const ACTIVITY_FACTORS = {
  sedentaire: 1.2,
  modere: 1.55,
  intensif: 1.8,
};

export const ACTIVITY_LABELS = {
  sedentaire: "Sédentaire",
  modere: "Modéré",
  intensif: "Intensif",
};

// Ajustement kcal/jour appliqué au TDEE selon l'objectif commun du foyer.
export const OBJECTIVE_KCAL_ADJUST = {
  masse: 400,
  seche: -400,
  equilibre: 0,
  recup: 250,
};

// Cible protéines en g/kg de poids corporel selon l'objectif.
export const OBJECTIVE_PROTEIN_PER_KG = {
  masse: 2,
  seche: 1.8,
  equilibre: 1.6,
  recup: 2,
};

// Cible fibres : règle courante ~14g de fibres pour 1000 kcal consommées.
export const FIBRES_PAR_1000KCAL = 14;

export function personneEstComplete(p) {
  return !!(Number(p.taille) > 0 && Number(p.poids) > 0 && Number(p.age) > 0 && (p.sexe === "H" || p.sexe === "F"));
}

// Métabolisme de base (Mifflin-St Jeor).
function calculerBMR({ poids, taille, age, sexe }) {
  const base = 10 * Number(poids) + 6.25 * Number(taille) - 5 * Number(age);
  return sexe === "F" ? base - 161 : base + 5;
}

// Cible kcal/protéines/fibres pour une personne, selon l'objectif commun du
// foyer. Si `objectifCalorique` (manuel) est renseigné sur la personne, il
// remplace le calcul automatique pour le kcal (les protéines et les fibres
// restent calculées à partir du poids / du kcal retenu, indépendamment de ce
// recouvrement).
export function calculerCiblePersonne(personne, objectifId) {
  if (!personneEstComplete(personne)) return null;

  const facteurActivite = ACTIVITY_FACTORS[personne.activite] || ACTIVITY_FACTORS.modere;
  const tdee = calculerBMR(personne) * facteurActivite;
  const ajustement = OBJECTIVE_KCAL_ADJUST[objectifId] ?? 0;
  const kcalCalcule = Math.round(tdee + ajustement);

  const manuel = parseInt(personne.objectifCalorique, 10);
  const utiliseManuel = Number.isFinite(manuel) && manuel > 0;
  const kcal = utiliseManuel ? manuel : kcalCalcule;

  const proteinesParKg = OBJECTIVE_PROTEIN_PER_KG[objectifId] ?? 1.6;
  const prot = Math.round(Number(personne.poids) * proteinesParKg);

  const fibres = Math.round((kcal / 1000) * FIBRES_PAR_1000KCAL);

  return { kcal, prot, fibres, kcalCalcule, source: utiliseManuel ? "manuel" : "calcule" };
}

// Agrège les cibles de toutes les personnes du foyer. Les personnes dont le
// profil est incomplet (taille/poids/âge/sexe manquants) sont ignorées et
// comptées dans `incompletes`.
export function calculerCibleFoyer(personnes, objectifId) {
  const parPersonne = [];
  let incompletes = 0;

  for (const p of personnes) {
    const cible = calculerCiblePersonne(p, objectifId);
    if (cible) {
      parPersonne.push({ id: p.id, nom: p.nom, ...cible });
    } else {
      incompletes += 1;
    }
  }

  const kcal = parPersonne.reduce((s, p) => s + p.kcal, 0);
  const prot = parPersonne.reduce((s, p) => s + p.prot, 0);
  const fibres = parPersonne.reduce((s, p) => s + p.fibres, 0);

  return { kcal, prot, fibres, parPersonne, incompletes, nbPersonnes: personnes.length };
}

// Construit la ligne de contexte "- Foyer : ..." envoyée au prompt, à partir
// du résultat de calculerCibleFoyer(). Boucle sur TOUT parPersonne (jamais un
// seul profil) pour lister chaque personne puis un total qui est la somme
// réelle de toutes les cibles (cibleFoyer.kcal/prot/fibres sont déjà la
// somme, calculée dans calculerCibleFoyer — cette fonction ne fait qu'assembler
// le texte, aucun recalcul ici).
export function construireLigneFoyer(cibleFoyer) {
  if (cibleFoyer.parPersonne.length === 0) {
    return `- Foyer : ${cibleFoyer.nbPersonnes} personne(s), profils incomplets (taille/poids/âge non renseignés) — adapte des portions standards.`;
  }
  const detail = cibleFoyer.parPersonne
    .map((p) => `${p.nom || "personne"} : ≈${p.kcal}kcal/${p.prot}g prot/${p.fibres}g fibres`)
    .join(", ");
  return `- Foyer : ${cibleFoyer.nbPersonnes} personne(s). Cibles quotidiennes calculées (Mifflin-St Jeor) — ${detail}. Total foyer : ≈${cibleFoyer.kcal}kcal, ${cibleFoyer.prot}g protéines et ${cibleFoyer.fibres}g fibres par jour.`;
}

// Configurations de repas disponibles (point 4). Une seule source de vérité
// pour le prompt, l'exemple JSON, le rendu des cartes et le résumé texte.
export const MEALS_CONFIGS = {
  3: [
    { key: "petit_dej", label: "Matin" },
    { key: "dejeuner", label: "Midi" },
    { key: "diner", label: "Soir" },
  ],
  4: [
    { key: "petit_dej", label: "Matin" },
    { key: "collation", label: "Collation" },
    { key: "dejeuner", label: "Midi" },
    { key: "diner", label: "Soir" },
  ],
  5: [
    { key: "petit_dej", label: "Matin" },
    { key: "collation_matin", label: "Collation matin" },
    { key: "dejeuner", label: "Midi" },
    { key: "collation_apresmidi", label: "Collation après-midi" },
    { key: "diner", label: "Soir" },
  ],
};

export const DEFAULT_REPAS_PAR_JOUR = 4;

// Table de référence nutritionnelle (kcal, protéines et fibres pour 100g).
// Valeurs APPROXIMATIVES de type USDA/Ciqual, pour orienter le modèle — pas
// des données diététiques certifiées. Féculents/légumineuses secs en poids
// cru (cohérent avec crudifie() : l'appli raisonne toujours en poids cru).
// Fibres à 0 pour tous les produits d'origine animale (viande, poisson,
// œufs, laitages) : ils n'en contiennent pas.
export const FOOD_TABLE = [
  // Protéines animales
  { nom: "Poulet blanc", kcal: 110, prot: 23, fibres: 0 },
  { nom: "Poulet cuisse", kcal: 140, prot: 18, fibres: 0 },
  { nom: "Dinde blanc", kcal: 105, prot: 24, fibres: 0 },
  { nom: "Bœuf haché 5%", kcal: 130, prot: 21, fibres: 0 },
  { nom: "Bœuf haché 15%", kcal: 215, prot: 19, fibres: 0 },
  { nom: "Bœuf steak", kcal: 190, prot: 21, fibres: 0 },
  { nom: "Porc filet", kcal: 143, prot: 21, fibres: 0 },
  { nom: "Agneau", kcal: 200, prot: 18, fibres: 0 },
  { nom: "Jambon blanc", kcal: 110, prot: 20, fibres: 0 },
  { nom: "Lardons", kcal: 280, prot: 17, fibres: 0 },
  { nom: "Chorizo", kcal: 380, prot: 24, fibres: 0 },
  { nom: "Saumon", kcal: 200, prot: 20, fibres: 0 },
  { nom: "Saumon fumé", kcal: 117, prot: 18, fibres: 0 },
  { nom: "Thon frais", kcal: 130, prot: 24, fibres: 0 },
  { nom: "Thon conserve égoutté", kcal: 116, prot: 26, fibres: 0 },
  { nom: "Cabillaud", kcal: 82, prot: 18, fibres: 0 },
  { nom: "Maquereau", kcal: 205, prot: 19, fibres: 0 },
  { nom: "Sardine", kcal: 170, prot: 21, fibres: 0 },
  { nom: "Sardines à l'huile égouttées", kcal: 210, prot: 24, fibres: 0 },
  { nom: "Crevettes", kcal: 85, prot: 20, fibres: 0 },
  { nom: "Œuf entier", kcal: 155, prot: 13, fibres: 0 },

  // Légumineuses et alternatives végétales
  { nom: "Lentilles sèches", kcal: 350, prot: 25, fibres: 17 },
  { nom: "Pois chiches secs", kcal: 360, prot: 19, fibres: 17 },
  { nom: "Haricots rouges secs", kcal: 330, prot: 24, fibres: 15 },
  { nom: "Haricots blancs secs", kcal: 330, prot: 21, fibres: 15 },
  { nom: "Tofu", kcal: 145, prot: 15, fibres: 1.5 },
  { nom: "Tempeh", kcal: 190, prot: 20, fibres: 6 },
  { nom: "Edamame", kcal: 120, prot: 11, fibres: 5 },
  { nom: "Seitan", kcal: 370, prot: 75, fibres: 1 },
  { nom: "Protéine de soja texturée sèche", kcal: 330, prot: 50, fibres: 14 },
  { nom: "Houmous", kcal: 170, prot: 8, fibres: 6 },

  // Féculents et céréales (poids cru)
  { nom: "Riz blanc cru", kcal: 360, prot: 7, fibres: 1.3 },
  { nom: "Riz complet cru", kcal: 360, prot: 8, fibres: 3.5 },
  { nom: "Riz basmati cru", kcal: 350, prot: 8, fibres: 1.5 },
  { nom: "Riz sauvage cru", kcal: 360, prot: 15, fibres: 6 },
  { nom: "Pâtes crues", kcal: 350, prot: 12, fibres: 3 },
  { nom: "Pâtes complètes crues", kcal: 340, prot: 13, fibres: 8 },
  { nom: "Quinoa cru", kcal: 370, prot: 14, fibres: 7 },
  { nom: "Semoule crue", kcal: 360, prot: 12, fibres: 3.5 },
  { nom: "Boulgour cru", kcal: 340, prot: 12, fibres: 8 },
  { nom: "Flocons d'avoine", kcal: 375, prot: 13, fibres: 10 },
  { nom: "Pain blanc", kcal: 265, prot: 9, fibres: 2.5 },
  { nom: "Pain complet", kcal: 245, prot: 10, fibres: 7 },
  { nom: "Pain de mie", kcal: 250, prot: 8, fibres: 3 },
  { nom: "Pomme de terre crue", kcal: 77, prot: 2, fibres: 2 },
  { nom: "Patate douce crue", kcal: 86, prot: 1.6, fibres: 3 },
  { nom: "Farine de blé", kcal: 340, prot: 10, fibres: 3 },

  // Produits laitiers et œufs
  { nom: "Lait entier", kcal: 65, prot: 3.2, fibres: 0 },
  { nom: "Lait demi-écrémé", kcal: 46, prot: 3.3, fibres: 0 },
  { nom: "Lait de coco", kcal: 230, prot: 2.3, fibres: 0 },
  { nom: "Yaourt nature", kcal: 60, prot: 4, fibres: 0 },
  { nom: "Yaourt grec", kcal: 95, prot: 8, fibres: 0 },
  { nom: "Skyr", kcal: 65, prot: 11, fibres: 0 },
  { nom: "Fromage blanc 0%", kcal: 45, prot: 8, fibres: 0 },
  { nom: "Cottage cheese", kcal: 98, prot: 11, fibres: 0 },
  { nom: "Ricotta", kcal: 174, prot: 11, fibres: 0 },
  { nom: "Emmental", kcal: 380, prot: 28, fibres: 0 },
  { nom: "Comté", kcal: 400, prot: 27, fibres: 0 },
  { nom: "Mozzarella", kcal: 280, prot: 22, fibres: 0 },
  { nom: "Feta", kcal: 265, prot: 14, fibres: 0 },
  { nom: "Parmesan", kcal: 400, prot: 36, fibres: 0 },
  { nom: "Beurre", kcal: 750, prot: 0.8, fibres: 0 },
  { nom: "Crème fraîche", kcal: 300, prot: 2.5, fibres: 0 },

  // Fruits
  { nom: "Pomme", kcal: 52, prot: 0.3, fibres: 2.4 },
  { nom: "Poire", kcal: 57, prot: 0.4, fibres: 3.1 },
  { nom: "Banane", kcal: 89, prot: 1.1, fibres: 2.6 },
  { nom: "Orange", kcal: 47, prot: 0.9, fibres: 2.4 },
  { nom: "Clémentine", kcal: 47, prot: 0.8, fibres: 1.7 },
  { nom: "Kiwi", kcal: 61, prot: 1.1, fibres: 3 },
  { nom: "Fraise", kcal: 32, prot: 0.7, fibres: 2 },
  { nom: "Framboise", kcal: 52, prot: 1.2, fibres: 6.5 },
  { nom: "Cerise", kcal: 63, prot: 1.1, fibres: 1.6 },
  { nom: "Abricot", kcal: 48, prot: 1.4, fibres: 2 },
  { nom: "Pêche", kcal: 39, prot: 0.9, fibres: 1.5 },
  { nom: "Prune", kcal: 46, prot: 0.7, fibres: 1.4 },
  { nom: "Raisin", kcal: 69, prot: 0.6, fibres: 0.9 },
  { nom: "Melon", kcal: 34, prot: 0.8, fibres: 0.9 },
  { nom: "Figue", kcal: 74, prot: 0.8, fibres: 2.9 },
  { nom: "Rhubarbe", kcal: 21, prot: 0.9, fibres: 1.8 },
  { nom: "Coing", kcal: 57, prot: 0.4, fibres: 1.9 },
  { nom: "Ananas", kcal: 50, prot: 0.5, fibres: 1.4 },
  { nom: "Mangue", kcal: 60, prot: 0.8, fibres: 1.6 },
  { nom: "Avocat", kcal: 160, prot: 2, fibres: 7 },

  // Légumes
  { nom: "Poireau", kcal: 29, prot: 1.5, fibres: 1.8 },
  { nom: "Chou blanc", kcal: 25, prot: 1.3, fibres: 2.5 },
  { nom: "Carotte", kcal: 41, prot: 0.9, fibres: 2.8 },
  { nom: "Endive", kcal: 17, prot: 1, fibres: 3.1 },
  { nom: "Panais", kcal: 75, prot: 1.2, fibres: 4.9 },
  { nom: "Céleri", kcal: 16, prot: 0.7, fibres: 1.6 },
  { nom: "Épinard", kcal: 23, prot: 2.9, fibres: 2.2 },
  { nom: "Radis", kcal: 16, prot: 0.7, fibres: 1.6 },
  { nom: "Chou-fleur", kcal: 25, prot: 1.9, fibres: 2 },
  { nom: "Asperge", kcal: 20, prot: 2.2, fibres: 2.1 },
  { nom: "Petit pois", kcal: 81, prot: 5.4, fibres: 5.1 },
  { nom: "Fenouil", kcal: 31, prot: 1.2, fibres: 3.1 },
  { nom: "Courgette", kcal: 17, prot: 1.2, fibres: 1 },
  { nom: "Concombre", kcal: 15, prot: 0.7, fibres: 0.5 },
  { nom: "Tomate", kcal: 18, prot: 0.9, fibres: 1.2 },
  { nom: "Haricot vert", kcal: 31, prot: 1.8, fibres: 3.4 },
  { nom: "Poivron", kcal: 31, prot: 1, fibres: 2.1 },
  { nom: "Aubergine", kcal: 25, prot: 1, fibres: 3 },
  { nom: "Courge butternut", kcal: 45, prot: 1, fibres: 2 },
  { nom: "Champignon de Paris", kcal: 22, prot: 3.1, fibres: 1 },
  { nom: "Betterave", kcal: 43, prot: 1.6, fibres: 2.8 },
  { nom: "Brocoli", kcal: 34, prot: 2.8, fibres: 2.6 },
  { nom: "Salade verte", kcal: 15, prot: 1.4, fibres: 1.3 },
  { nom: "Oignon", kcal: 40, prot: 1.1, fibres: 1.7 },
  { nom: "Ail", kcal: 149, prot: 6.4, fibres: 2.1 },
  { nom: "Maïs grains", kcal: 86, prot: 3.2, fibres: 2.7 },
  { nom: "Olives", kcal: 145, prot: 1, fibres: 3.2 },

  // Matières grasses, graines, épicerie
  { nom: "Huile d'olive", kcal: 900, prot: 0, fibres: 0 },
  { nom: "Huile de colza", kcal: 900, prot: 0, fibres: 0 },
  { nom: "Amandes", kcal: 580, prot: 21, fibres: 12.5 },
  { nom: "Noix", kcal: 650, prot: 15, fibres: 6.7 },
  { nom: "Noisettes", kcal: 630, prot: 15, fibres: 9.7 },
  { nom: "Cacahuètes", kcal: 570, prot: 25, fibres: 8 },
  { nom: "Beurre de cacahuète", kcal: 590, prot: 25, fibres: 6 },
  { nom: "Graines de tournesol", kcal: 580, prot: 21, fibres: 8.6 },
  { nom: "Graines de courge", kcal: 560, prot: 30, fibres: 6 },
  { nom: "Graines de chia", kcal: 490, prot: 17, fibres: 34 },
  { nom: "Graines de lin", kcal: 530, prot: 18, fibres: 27 },
  { nom: "Miel", kcal: 305, prot: 0.3, fibres: 0.2 },
  { nom: "Sucre", kcal: 400, prot: 0, fibres: 0 },
  { nom: "Chocolat noir 70%", kcal: 550, prot: 8, fibres: 10.9 },
];

// Format compact pour injection dans le prompt (évite le coût d'un gros JSON).
export function formatFoodTableForPrompt() {
  return FOOD_TABLE.map((f) => `${f.nom} ${f.kcal}kcal/${f.prot}p/${f.fibres}fib`).join(", ");
}

// Recherche simple (sous-chaîne, insensible à la casse/accents) dans la
// table de référence — utilisée par l'autocomplétion du Journal.
export function rechercherAliment(texte, limite = 8) {
  const q = texte
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (!q) return [];
  return FOOD_TABLE.filter((f) =>
    f.nom
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .includes(q)
  ).slice(0, limite);
}
