import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerCibleFoyer, construireLigneFoyer, calculerCiblePersonne, FIBRES_PAR_1000KCAL, rechercherAliment, FOOD_TABLE } from "./nutrition-data.js";

test("la ligne de contexte foyer liste chaque personne et somme les deux cibles (pas la valeur d'une seule)", () => {
  const personnes = [
    { id: 1, nom: "Quentin", taille: "178", poids: "75", age: "30", sexe: "H", activite: "modere", objectifCalorique: "" },
    { id: 2, nom: "Léa", taille: "165", poids: "60", age: "28", sexe: "F", activite: "sedentaire", objectifCalorique: "" },
  ];

  const cible = calculerCibleFoyer(personnes, "equilibre");
  assert.equal(cible.incompletes, 0, "les 2 profils sont complets, aucun ne doit être exclu");
  assert.equal(cible.parPersonne.length, 2, "les 2 profils complets doivent contribuer au calcul");

  const totalAttendu = cible.parPersonne.reduce((s, p) => s + p.kcal, 0);
  const protAttendu = cible.parPersonne.reduce((s, p) => s + p.prot, 0);
  const fibresAttendu = cible.parPersonne.reduce((s, p) => s + p.fibres, 0);
  assert.equal(cible.kcal, totalAttendu, "le total kcal doit être la somme des deux profils, pas la valeur d'un seul");
  assert.equal(cible.prot, protAttendu, "le total protéines doit être la somme des deux profils");
  assert.equal(cible.fibres, fibresAttendu, "le total fibres doit être la somme des deux profils");
  assert.ok(cible.kcal > cible.parPersonne[0].kcal, "le total foyer doit dépasser la cible d'une seule personne");

  const ligne = construireLigneFoyer(cible);
  assert.ok(ligne.includes("Quentin"), `le prénom du premier profil doit apparaître dans : "${ligne}"`);
  assert.ok(ligne.includes("Léa"), `le prénom du second profil doit apparaître dans : "${ligne}"`);
  assert.ok(ligne.includes(`${cible.kcal}kcal`), "le total affiché doit correspondre à la somme calculée");
});

test("un profil incomplet (sexe manquant) est bien exclu et signalé, sans faire disparaître le profil complet", () => {
  const personnes = [
    { id: 1, nom: "Quentin", taille: "178", poids: "75", age: "30", sexe: "H", activite: "modere", objectifCalorique: "" },
    { id: 2, nom: "Léa", taille: "165", poids: "60", age: "28", sexe: "", activite: "sedentaire", objectifCalorique: "" },
  ];

  const cible = calculerCibleFoyer(personnes, "equilibre");
  assert.equal(cible.parPersonne.length, 1);
  assert.equal(cible.incompletes, 1);
  assert.equal(cible.nbPersonnes, 2);

  const ligne = construireLigneFoyer(cible);
  assert.ok(ligne.includes("Quentin"), "le profil complet doit rester listé");
  assert.ok(!ligne.includes("Léa"), "le profil incomplet ne doit pas apparaître avec des chiffres inventés");
});

test("3 profils complets : les trois noms apparaissent et le total est la somme des trois", () => {
  const personnes = [
    { id: 1, nom: "A", taille: "180", poids: "80", age: "25", sexe: "H", activite: "modere", objectifCalorique: "" },
    { id: 2, nom: "B", taille: "170", poids: "65", age: "35", sexe: "F", activite: "sedentaire", objectifCalorique: "" },
    { id: 3, nom: "C", taille: "175", poids: "70", age: "40", sexe: "H", activite: "intensif", objectifCalorique: "" },
  ];

  const cible = calculerCibleFoyer(personnes, "masse");
  assert.equal(cible.parPersonne.length, 3);

  const ligne = construireLigneFoyer(cible);
  for (const nom of ["A", "B", "C"]) {
    assert.ok(ligne.includes(nom), `"${nom}" doit apparaître dans : "${ligne}"`);
  }
  const totalAttendu = cible.parPersonne.reduce((s, p) => s + p.kcal, 0);
  assert.equal(cible.kcal, totalAttendu);
});

test("cible fibres = 14g pour 1000 kcal de la cible retenue (calculée ou manuelle)", () => {
  const personneCalculee = { id: 1, nom: "A", taille: "178", poids: "75", age: "30", sexe: "H", activite: "modere", objectifCalorique: "" };
  const cibleA = calculerCiblePersonne(personneCalculee, "equilibre");
  assert.equal(cibleA.fibres, Math.round((cibleA.kcal / 1000) * FIBRES_PAR_1000KCAL));

  const personneManuelle = { id: 2, nom: "B", taille: "178", poids: "75", age: "30", sexe: "H", activite: "modere", objectifCalorique: "2000" };
  const cibleB = calculerCiblePersonne(personneManuelle, "equilibre");
  assert.equal(cibleB.kcal, 2000, "l'objectif calorique manuel doit être respecté");
  assert.equal(cibleB.fibres, Math.round((2000 / 1000) * 14), "les fibres doivent suivre le kcal manuel, pas le kcal calculé");
});

test("chaque aliment de la table a une valeur fibres définie (>= 0, pas undefined/NaN)", () => {
  for (const f of FOOD_TABLE) {
    assert.ok(Number.isFinite(f.fibres) && f.fibres >= 0, `${f.nom} doit avoir des fibres numériques >= 0, reçu : ${f.fibres}`);
  }
});

test("rechercherAliment trouve un aliment connu indépendamment de la casse/accents, et rien pour une requête vide", () => {
  const resultatsPoulet = rechercherAliment("POULET");
  assert.ok(resultatsPoulet.length >= 2, "doit trouver au moins Poulet blanc et Poulet cuisse");
  assert.ok(resultatsPoulet.every((f) => f.nom.toLowerCase().includes("poulet")));

  const resultatsAccent = rechercherAliment("cafe"); // pas d'accent, ne doit pas planter
  assert.ok(Array.isArray(resultatsAccent));

  assert.deepEqual(rechercherAliment(""), []);
  assert.deepEqual(rechercherAliment("   "), []);
});
