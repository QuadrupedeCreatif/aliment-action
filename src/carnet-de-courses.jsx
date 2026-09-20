import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MapPin,
  RefreshCw,
  Check,
  Loader2,
  ChevronRight,
  ShoppingBasket,
  Pin,
  PinOff,
  Pencil,
  Copy,
  ClipboardCheck,
  Plus,
  X,
  Settings,
  UtensilsCrossed,
  History,
} from "lucide-react";
import {
  MEALS_CONFIGS,
  DEFAULT_REPAS_PAR_JOUR,
  ACTIVITY_FACTORS,
  ACTIVITY_LABELS,
  calculerCibleFoyer,
  formatFoodTableForPrompt,
} from "./nutrition-data.js";

// Colle ici l'URL publique de ton Worker Cloudflare une fois déployé
// (résultat de `npx wrangler deploy` dans le dossier /worker), ex :
// "https://carnet-courses-worker.tonpseudo.workers.dev"
const WORKER_URL = "https://carnet-courses-worker.quentinchalono.workers.dev";

const GOALS = [
  { id: "masse", label: "Prise de masse", desc: "Plus de calories, protéines et féculents" },
  { id: "seche", label: "Perte de gras", desc: "Protéines maigres, légumes, féculents modérés" },
  { id: "equilibre", label: "Équilibré", desc: "Variété, portions standards" },
  { id: "recup", label: "Récupération intense", desc: "Grosse semaine de répétitions ou de spectacles" },
];

const BUDGET_OPTIONS = [
  { id: "serre", label: "Serré" },
  { id: "normal", label: "Normal" },
  { id: "large", label: "Large" },
];

const BUDGET_PROMPT_HINTS = {
  serre: "Budget serré : privilégie légumineuses, œufs, féculents et légumes/fruits de saison ; limite la viande rouge et les ingrédients hors-saison ou coûteux.",
  normal: "Budget normal : équilibre entre praticité et coût, sans contrainte particulière.",
  large: "Budget large : aucune contrainte de coût, varie librement les protéines et ingrédients même premium si pertinent.",
};

const REPAS_OPTIONS = [3, 4, 5];

const TABS = [
  { id: "reglages", label: "Réglages", Icon: Settings },
  { id: "menus", label: "Menus", Icon: UtensilsCrossed },
  { id: "courses", label: "Courses", Icon: ShoppingBasket },
  { id: "historique", label: "Historique", Icon: History },
];

const ACTIVITE_OPTIONS = Object.keys(ACTIVITY_FACTORS);
const SEXE_OPTIONS = ["H", "F"];

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// Calendrier de saisonnalité (climat tempéré France / hémisphère nord)
const SAISON_FR = [
  { legumes: ["Poireau", "Chou", "Carotte", "Endive", "Panais"], fruits: ["Pomme", "Poire", "Clémentine", "Kiwi"] }, // janvier
  { legumes: ["Poireau", "Chou", "Carotte", "Endive", "Céleri"], fruits: ["Pomme", "Poire", "Clémentine", "Orange"] }, // février
  { legumes: ["Poireau", "Épinard", "Carotte", "Radis", "Chou-fleur"], fruits: ["Pomme", "Poire", "Orange"] }, // mars
  { legumes: ["Asperge", "Radis", "Épinard", "Petit pois"], fruits: ["Pomme", "Poire", "Rhubarbe"] }, // avril
  { legumes: ["Asperge", "Radis", "Petit pois", "Fenouil"], fruits: ["Fraise", "Rhubarbe", "Cerise"] }, // mai
  { legumes: ["Courgette", "Concombre", "Tomate", "Haricot vert"], fruits: ["Fraise", "Cerise", "Abricot", "Pêche"] }, // juin
  { legumes: ["Courgette", "Tomate", "Poivron", "Aubergine"], fruits: ["Pêche", "Abricot", "Melon", "Framboise"] }, // juillet
  { legumes: ["Tomate", "Poivron", "Aubergine", "Courgette"], fruits: ["Pêche", "Melon", "Figue", "Prune"] }, // août
  { legumes: ["Tomate", "Poivron", "Courge", "Champignon"], fruits: ["Raisin", "Figue", "Prune", "Poire"] }, // septembre
  { legumes: ["Courge", "Champignon", "Chou", "Betterave"], fruits: ["Raisin", "Pomme", "Poire", "Coing"] }, // octobre
  { legumes: ["Courge", "Chou", "Poireau", "Betterave"], fruits: ["Pomme", "Poire", "Kiwi", "Clémentine"] }, // novembre
  { legumes: ["Chou", "Poireau", "Endive", "Panais"], fruits: ["Pomme", "Poire", "Clémentine", "Orange"] }, // décembre
];

const STORAGE_KEY = "liste-courante";

// Filet de sécurité : si le modèle donne quand même un poids cuit pour riz/pâtes
// (les deux cas les plus fréquents, ratio cuit→cru ~2.2-2.3), on le convertit en cru.
function crudifie(texte) {
  if (!texte) return texte;
  let t = texte;
  t = t.replace(/(\d+)\s*g(\s+de)?\s+riz([^+]*?)cuit(e?s?)/gi, (_, num, de, mid) => {
    const cru = Math.max(5, Math.round(parseInt(num, 10) / 2.3 / 5) * 5);
    return `${cru}g${de || ""} riz${mid}cru`;
  });
  t = t.replace(/(\d+)\s*g(\s+de)?\s+p[âa]tes([^+]*?)cuit(e?s?)/gi, (_, num, de, mid) => {
    const cru = Math.max(5, Math.round(parseInt(num, 10) / 2.2 / 5) * 5);
    return `${cru}g${de || ""} pâtes${mid}crues`;
  });
  // filet générique : au cas où "cuit(e)(s)" traîne ailleurs sans conversion possible
  t = t.replace(/\s+cuite?s?\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return t;
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function makeDefaultPersonne(id, nom) {
  return { id, nom, taille: "", poids: "", age: "", sexe: "", activite: "modere", objectifCalorique: "" };
}

const baseInputStyle = {
  width: "100%",
  background: "#26362C",
  border: "1px solid #3C4E40",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#F1EDE2",
  fontSize: 16,
  outline: "none",
  boxSizing: "border-box",
};

function PersonneCard({ personne, index, onChange, onRemove, canRemove }) {
  return (
    <div
      style={{
        background: "#26362C",
        border: "1px solid #2E3F33",
        borderRadius: 10,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input
          value={personne.nom}
          onChange={(e) => onChange(personne.id, "nom", e.target.value)}
          placeholder={`Personne ${index + 1}`}
          style={{ ...baseInputStyle, fontWeight: 600 }}
        />
        {canRemove && (
          <button
            onClick={() => onRemove(personne.id)}
            title="Retirer cette personne"
            style={{
              background: "none",
              border: "1px solid #3C4E40",
              borderRadius: 8,
              padding: 10,
              cursor: "pointer",
              color: "#C77B5F",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          type="number"
          inputMode="numeric"
          value={personne.taille}
          onChange={(e) => onChange(personne.id, "taille", e.target.value)}
          placeholder="Taille (cm)"
          style={baseInputStyle}
        />
        <input
          type="number"
          inputMode="numeric"
          value={personne.poids}
          onChange={(e) => onChange(personne.id, "poids", e.target.value)}
          placeholder="Poids (kg)"
          style={baseInputStyle}
        />
        <input
          type="number"
          inputMode="numeric"
          value={personne.age}
          onChange={(e) => onChange(personne.id, "age", e.target.value)}
          placeholder="Âge"
          style={baseInputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {SEXE_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onChange(personne.id, "sexe", s)}
            style={{
              flex: 1,
              padding: "10px 8px",
              borderRadius: 8,
              border: personne.sexe === s ? "1px solid #D9A441" : "1px solid #2E3F33",
              background: personne.sexe === s ? "#3C4E40" : "#1E2A22",
              color: "#F1EDE2",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {s === "H" ? "Homme" : "Femme"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {ACTIVITE_OPTIONS.map((a) => (
          <button
            key={a}
            onClick={() => onChange(personne.id, "activite", a)}
            style={{
              flex: 1,
              padding: "10px 6px",
              borderRadius: 8,
              border: personne.activite === a ? "1px solid #D9A441" : "1px solid #2E3F33",
              background: personne.activite === a ? "#3C4E40" : "#1E2A22",
              color: "#F1EDE2",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            {ACTIVITY_LABELS[a]}
          </button>
        ))}
      </div>

      <input
        type="number"
        inputMode="numeric"
        value={personne.objectifCalorique}
        onChange={(e) => onChange(personne.id, "objectifCalorique", e.target.value)}
        placeholder="Objectif calorique précis en kcal (optionnel, sinon calcul auto)"
        style={baseInputStyle}
      />
    </div>
  );
}

export default function CarnetDeCourses() {
  const now = new Date();
  const moisLabel = MOIS_FR[now.getMonth()];
  const semaineLabel = `S${getISOWeek(now)} · ${now.getFullYear()}`;
  const saisonMois = SAISON_FR[now.getMonth()];

  const [goalId, setGoalId] = useState(null);
  const [pays, setPays] = useState("France");
  const [exclusions, setExclusions] = useState("");
  const [personnes, setPersonnes] = useState([makeDefaultPersonne(1, "Toi")]);
  const [repasParJour, setRepasParJour] = useState(DEFAULT_REPAS_PAR_JOUR);
  const [budget, setBudget] = useState("normal");
  const [cuisine, setCuisine] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [checked, setChecked] = useState({});
  const [generatedAt, setGeneratedAt] = useState(null);
  const [contexteUtilise, setContexteUtilise] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [viewIndex, setViewIndex] = useState(null); // null = semaine actuelle, sinon index dans historique
  const [repasFixes, setRepasFixes] = useState({});
  const [editingKey, setEditingKey] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("reglages");
  const [fallbackPrompt, setFallbackPrompt] = useState(null);
  const [fallbackAnswer, setFallbackAnswer] = useState("");
  const [fallbackError, setFallbackError] = useState(null);
  const [fallbackCopied, setFallbackCopied] = useState(false);

  const nextPersonneId = useRef(2);

  // Load last saved state on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setGoalId(saved.goalId || null);
        setPays(saved.pays || "France");
        setExclusions(saved.exclusions || "");
        setData(saved.data || null);
        setActiveTab(saved.data ? "menus" : "reglages");
        setChecked(saved.checked || {});
        setGeneratedAt(saved.generatedAt || null);
        setContexteUtilise(saved.contexteUtilise || null);
        setHistorique(saved.historique || []);
        setRepasFixes(saved.repasFixes || {});
        setRepasParJour(saved.repasParJour || DEFAULT_REPAS_PAR_JOUR);
        setBudget(saved.budget || "normal");
        setCuisine(saved.cuisine || "");

        if (Array.isArray(saved.personnes) && saved.personnes.length > 0) {
          setPersonnes(saved.personnes);
          const maxId = Math.max(...saved.personnes.map((p) => (typeof p.id === "number" ? p.id : 0)));
          nextPersonneId.current = maxId + 1;
        } else if (saved.taille || saved.poids) {
          // Migration depuis l'ancien état à une seule personne (taille/poids au sommet)
          setPersonnes([{ ...makeDefaultPersonne(1, "Toi"), taille: saved.taille || "", poids: saved.poids || "" }]);
        }
      }
    } catch (e) {
      // rien de sauvegardé, écran vierge
    }
  }, []);

  const persist = useCallback(async (next) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // sauvegarde best-effort
    }
  }, []);

  const cibleFoyer = useMemo(() => calculerCibleFoyer(personnes, goalId), [personnes, goalId]);

  const mealsAtual = MEALS_CONFIGS[repasParJour] || MEALS_CONFIGS[DEFAULT_REPAS_PAR_JOUR];

  const addPersonne = () => {
    const id = nextPersonneId.current++;
    setPersonnes([...personnes, makeDefaultPersonne(id, `Personne ${personnes.length + 1}`)]);
  };

  const removePersonne = (id) => {
    if (personnes.length <= 1) return;
    setPersonnes(personnes.filter((p) => p.id !== id));
  };

  const updatePersonneField = (id, field, value) => {
    setPersonnes(personnes.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const callClaude = async (prompt) => {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Requête refusée (${response.status}) ${bodyText.slice(0, 200)}`);
    }
    const json = await response.json();
    const text = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse sans JSON exploitable.");
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new Error("JSON incomplet (réponse probablement tronquée).");
    }
  };

  // Construit le contexte partagé (foyer, objectif, saison, budget...) utilisé à la
  // fois par le flux automatique (Gemini) et par le prompt de secours (Claude manuel).
  const construireContexte = () => {
    const goal = GOALS.find((g) => g.id === goalId);
    const paysLabel = pays.trim() || "France";
    const exclusionsTrim = exclusions.trim();
    const cuisineTrim = cuisine.trim();
    const meals = mealsAtual;

    const semainePrecedente = data
      ? data.semaine.map((j) => meals.map((m) => j[m.key]).join("; ")).join(" | ")
      : null;

    const foyerTexte =
      cibleFoyer.parPersonne.length > 0
        ? `- Foyer : ${cibleFoyer.nbPersonnes} personne(s). Cibles quotidiennes calculées (Mifflin-St Jeor) — ${cibleFoyer.parPersonne
            .map((p) => `${p.nom || "personne"} : ≈${p.kcal}kcal/${p.prot}g prot`)
            .join(", ")}. Total foyer : ≈${cibleFoyer.kcal}kcal et ${cibleFoyer.prot}g protéines par jour.`
        : `- Foyer : ${cibleFoyer.nbPersonnes} personne(s), profils incomplets (taille/poids/âge non renseignés) — adapte des portions standards.`;

    const contexte = `- Mois actuel : ${moisLabel}\n- Pays : ${paysLabel}\n- Objectif : ${goal.label} — ${goal.desc}\n- Légumes de saison ce mois-ci : ${saisonMois.legumes.join(", ")}\n- Fruits de saison ce mois-ci : ${saisonMois.fruits.join(", ")} (cette liste part d'un climat tempéré ; adapte-la si le pays a un climat très différent)\n${foyerTexte}\n- ${BUDGET_PROMPT_HINTS[budget]}${
      cuisineTrim ? `\n- Type de cuisine souhaité : ${cuisineTrim}` : ""
    }${exclusionsTrim ? `\n- À éviter absolument (allergies/préférences) : ${exclusionsTrim}` : ""}${
      semainePrecedente ? `\n- Repas de la semaine précédente, à varier (évite de répéter les mêmes associations) : ${semainePrecedente}` : ""
    }\n- Table de référence nutritionnelle (kcal/protéines pour 100g, aliments courants — appuie-toi dessus pour tes choix) : ${formatFoodTableForPrompt()}`;

    return { goal, meals, contexte };
  };

  // Applique poids cru (crudifie) et les repas figés (repasFixes) à une semaine brute
  // — utilisé à la fois pour la réponse Gemini et pour la réponse collée manuellement.
  const nettoyerSemaine = (semaineBrute, meals) =>
    semaineBrute.map((j) => {
      const jour = { jour: j.jour, kcal: j.kcal, prot: j.prot };
      for (const m of meals) {
        jour[m.key] = repasFixes[m.key] || crudifie(j[m.key]);
      }
      return jour;
    });

  const nettoyerListeCourses = (listeCoursesBrute) =>
    listeCoursesBrute.map((cat) => ({
      categorie: cat.categorie,
      articles: (cat.articles || []).map(crudifie),
    }));

  // Enregistre le résultat final (semaine + liste de courses déjà nettoyées) et
  // l'affiche, que la génération vienne du Worker (Gemini) ou du mode de secours
  // (réponse Claude collée manuellement).
  const finaliserGeneration = async (semaineNettoyee, listeCoursesNettoyee, goalLabel) => {
    const parsed = { semaine: semaineNettoyee, liste_courses: listeCoursesNettoyee };
    const ts = new Date().toISOString();
    const ctx = {
      mois: moisLabel,
      localisation: pays.trim() || "France",
      objectif: goalLabel,
      repasParJour,
      cibleFoyer: { kcal: cibleFoyer.kcal, prot: cibleFoyer.prot, nbPersonnes: cibleFoyer.nbPersonnes },
    };

    // Historique : on range l'ancienne semaine actuelle avant de la remplacer (max 4 conservées)
    const nouvelHistorique = data
      ? [{ id: generatedAt || ts, contexteUtilise, data, checked }, ...historique].slice(0, 4)
      : historique;

    setData(parsed);
    setChecked({});
    setGeneratedAt(ts);
    setContexteUtilise(ctx);
    setHistorique(nouvelHistorique);
    setViewIndex(null);
    setActiveTab("menus");
    await persist({
      goalId,
      pays,
      exclusions,
      personnes,
      repasParJour,
      budget,
      cuisine,
      repasFixes,
      data: parsed,
      checked: {},
      generatedAt: ts,
      contexteUtilise: ctx,
      historique: nouvelHistorique,
    });
  };

  const genererListe = async () => {
    if (!goalId) return;
    setLoading(true);
    setError(null);
    setFallbackPrompt(null);
    setFallbackAnswer("");
    setFallbackError(null);

    const { goal, meals, contexte } = construireContexte();

    try {
      // Étape 1 — menus, scindée en 2 appels (début/fin de semaine) pour rester dans le budget de réponse
      const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
      const menusPromptPour = (joursSubset) => {
        const champsExemple = meals.map((m) => `"${m.key}": "..."`).join(", ");
        const exemple = joursSubset
          .map((j) => `  {"jour": "${j}", ${champsExemple}, "kcal": 2200, "prot": 140}`)
          .join(",\n");
        const listeRepasTexte = meals.map((m) => m.label.toLowerCase()).join(", ");
        return `Tu es un nutritionniste pragmatique qui aide un foyer à composer ses repas de la semaine.

Contexte :
${contexte}

Consigne stricte : ne donne AUCUNE recette, juste pour chaque repas (${listeRepasTexte}) une courte association d'aliments AVEC quantités précises AU NIVEAU DU FOYER (une seule quantité lisible par aliment pour tout le foyer, pas de détail par personne dans le texte), en priorisant les légumes/fruits de saison listés ci-dessus, la table de référence nutritionnelle, et en respectant les aliments à éviter le cas échéant. TOUTES les quantités sont en poids CRU, tel qu'acheté et pesé avant cuisson — n'écris JAMAIS le mot "cuit(es)" ni un poids cuit. C'est particulièrement important pour le riz et les pâtes, qui doublent de poids à la cuisson : utilise leur poids sec (ex: "80g riz cru", "90g pâtes crues"), jamais "180g riz cuit" ou "200g pâtes cuites". Format quantité : grammes pour le solide (ex: "100g flocons d'avoine"), cl pour le liquide (ex: "20cl lait entier"), pièces pour les fruits/légumes entiers (ex: "2 bananes"), cuillères pour les condiments. Exemple complet : "100g flocons d'avoine + 20cl lait entier + 2 bananes". Reste concis, 3 aliments max par repas. Ajoute aussi pour chaque jour une estimation approximative du total kcal ("kcal", nombre entier) et des protéines en grammes ("prot", nombre entier) sur l'ensemble de la journée, pour le foyer entier. Génère UNIQUEMENT les jours suivants : ${joursSubset.join(", ")}.

Réponds UNIQUEMENT avec ce JSON, rien d'autre, pas de \`\`\`, pas de phrase avant ou après :
{"semaine": [
${exemple}
]}`;
      };

      const premiereMoitie = JOURS.slice(0, 4);
      const secondeMoitie = JOURS.slice(4);

      setLoadingStep("Composition des menus (1/2)...");
      let menusData1;
      try {
        menusData1 = await callClaude(menusPromptPour(premiereMoitie));
      } catch (e) {
        throw new Error(`menus 1/2 — ${e.message}`);
      }

      setLoadingStep("Composition des menus (2/2)...");
      let menusData2;
      try {
        menusData2 = await callClaude(menusPromptPour(secondeMoitie));
      } catch (e) {
        throw new Error(`menus 2/2 — ${e.message}`);
      }

      const menusSemaine = nettoyerSemaine([...menusData1.semaine, ...menusData2.semaine], meals);

      // Étape 2 — liste de courses dérivée des menus ci-dessus
      setLoadingStep("Construction de la liste de courses...");
      const resumeMenus = menusSemaine
        .map((j) => `${j.jour}: ${meals.map((m) => `${m.label.toLowerCase()}: ${j[m.key]}`).join(" / ")}`)
        .join("\n");

      const foyerListeTexte =
        cibleFoyer.parPersonne.length > 0
          ? `Ce menu doit couvrir tout le foyer, soit ${cibleFoyer.nbPersonnes} personne(s) avec des besoins différents : ${cibleFoyer.parPersonne
              .map((p) => `${p.nom || "personne"} (≈${p.kcal}kcal/j, ${p.prot}g prot/j)`)
              .join(", ")}. Total foyer sur 7 jours : environ ${cibleFoyer.kcal * 7}kcal et ${cibleFoyer.prot * 7}g de protéines cumulés. Calcule les quantités totales de courses pour L'ENSEMBLE DU FOYER (pas une seule personne), en tenant compte du nombre de personnes et de leurs besoins caloriques respectifs.\n`
          : `Ce menu doit couvrir ${cibleFoyer.nbPersonnes} personne(s) du foyer (profils incomplets, utilise des portions standards).\n`;

      const promptListe = `Voici les repas prévus cette semaine pour le foyer (objectif : ${goal.label}) :
${resumeMenus}

${foyerListeTexte}${BUDGET_PROMPT_HINTS[budget]}
Construis la liste de courses correspondante pour 7 jours, pour tout le foyer, en cumulant les quantités déjà indiquées ci-dessus pour chaque ingrédient (évite les doublons, additionne). TOUTES les quantités sont en poids CRU, tel qu'acheté avant cuisson — n'écris JAMAIS "cuit(es)". Pour le riz et les pâtes en particulier, utilise le poids sec/cru (ex: "80g riz cru"), jamais un poids cuit. Maximum 5 catégories, maximum 6 articles par catégorie. Chaque article est une seule chaîne courte "nom + quantité totale" (ex: "Poulet 600g", "Riz basmati 1kg", "Brocolis 2 têtes").

Réponds UNIQUEMENT avec ce JSON, rien d'autre, pas de \`\`\`, pas de phrase avant ou après :
{"liste_courses": [
  {"categorie": "Fruits & légumes", "articles": ["...", "..."]},
  {"categorie": "Protéines", "articles": ["...", "..."]},
  {"categorie": "Féculents & céréales", "articles": ["...", "..."]},
  {"categorie": "Produits laitiers & œufs", "articles": ["...", "..."]},
  {"categorie": "Épicerie", "articles": ["...", "..."]}
]}`;
      let listeData;
      try {
        listeData = await callClaude(promptListe);
      } catch (e) {
        throw new Error(`liste de courses — ${e.message}`);
      }

      const listeCoursesNettoyee = nettoyerListeCourses(listeData.liste_courses);
      await finaliserGeneration(menusSemaine, listeCoursesNettoyee, goal.label);
    } catch (e) {
      setError(`La génération a échoué : ${e.message || "erreur inconnue"}. Réessaie.`);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const essayerViaClaude = () => {
    const { goal, meals, contexte } = construireContexte();
    const joursListe = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    const champsExemple = meals.map((m) => `"${m.key}": "..."`).join(", ");
    const exempleSemaine = joursListe
      .map((j) => `    {"jour": "${j}", ${champsExemple}, "kcal": 2200, "prot": 140}`)
      .join(",\n");
    const listeRepasTexte = meals.map((m) => m.label.toLowerCase()).join(", ");

    const prompt = `Tu es un nutritionniste pragmatique qui aide un foyer à composer ses repas ET sa liste de courses pour une semaine complète, en une seule réponse.

Contexte :
${contexte}

Étape 1 — Menus : pour chaque jour de la semaine (Lundi à Dimanche) et chaque repas (${listeRepasTexte}), donne une courte association d'aliments AVEC quantités précises AU NIVEAU DU FOYER (une seule quantité lisible par aliment pour tout le foyer, pas de détail par personne dans le texte), en priorisant les légumes/fruits de saison, la table de référence nutritionnelle, et en respectant les aliments à éviter le cas échéant. TOUTES les quantités sont en poids CRU, tel qu'acheté et pesé avant cuisson — n'écris JAMAIS le mot "cuit(es)" ni un poids cuit (particulièrement important pour le riz et les pâtes, qui doublent de poids à la cuisson : utilise leur poids sec, ex "80g riz cru", "90g pâtes crues"). Format quantité : grammes pour le solide, cl pour le liquide, pièces pour les fruits/légumes entiers, cuillères pour les condiments. Reste concis, 3 aliments max par repas. Ajoute pour chaque jour une estimation kcal et prot (nombres entiers) pour le foyer entier.

Étape 2 — Liste de courses : à partir de ces mêmes menus, construis la liste de courses cumulée pour les 7 jours et pour TOUT LE FOYER (pas une seule personne), en tenant compte du nombre de personnes et de leurs besoins caloriques respectifs indiqués ci-dessus. Additionne les quantités, évite les doublons. TOUJOURS en poids CRU, jamais "cuit(es)". Maximum 5 catégories, maximum 6 articles par catégorie. Chaque article est une seule chaîne courte "nom + quantité totale" (ex: "Poulet 600g", "Riz basmati 1kg", "Brocolis 2 têtes").

Réponds UNIQUEMENT avec ce JSON complet, rien d'autre, pas de \`\`\`, pas de phrase avant ou après :
{
  "semaine": [
${exempleSemaine}
  ],
  "liste_courses": [
    {"categorie": "Fruits & légumes", "articles": ["...", "..."]},
    {"categorie": "Protéines", "articles": ["...", "..."]},
    {"categorie": "Féculents & céréales", "articles": ["...", "..."]},
    {"categorie": "Produits laitiers & œufs", "articles": ["...", "..."]},
    {"categorie": "Épicerie", "articles": ["...", "..."]}
  ]
}`;

    setFallbackPrompt(prompt);
    setFallbackAnswer("");
    setFallbackError(null);
  };

  const copierPromptSecours = async () => {
    try {
      await navigator.clipboard.writeText(fallbackPrompt || "");
      setFallbackCopied(true);
      setTimeout(() => setFallbackCopied(false), 2000);
    } catch (e) {
      // best effort
    }
  };

  const validerReponseSecours = async () => {
    const match = fallbackAnswer.match(/\{[\s\S]*\}/);
    let parsedManual = null;
    if (match) {
      try {
        parsedManual = JSON.parse(match[0]);
      } catch (e) {
        parsedManual = null;
      }
    }
    if (!parsedManual || !Array.isArray(parsedManual.semaine) || !Array.isArray(parsedManual.liste_courses)) {
      setFallbackError("Le texte collé n'est pas un JSON valide, réessaie en collant toute la réponse de Claude.");
      return;
    }
    setFallbackError(null);
    const { goal, meals } = construireContexte();
    const semaineNettoyee = nettoyerSemaine(parsedManual.semaine, meals);
    const listeCoursesNettoyee = nettoyerListeCourses(parsedManual.liste_courses);
    await finaliserGeneration(semaineNettoyee, listeCoursesNettoyee, goal.label);
    setFallbackPrompt(null);
    setFallbackAnswer("");
    setError(null);
  };

  const persistState = useCallback(
    async (overrides = {}) => {
      await persist({
        goalId,
        pays,
        exclusions,
        personnes,
        repasParJour,
        budget,
        cuisine,
        repasFixes,
        data,
        checked,
        generatedAt,
        contexteUtilise,
        historique,
        ...overrides,
      });
    },
    [persist, goalId, pays, exclusions, personnes, repasParJour, budget, cuisine, repasFixes, data, checked, generatedAt, contexteUtilise, historique]
  );

  const toggleItem = async (key) => {
    if (viewIndex !== null) return; // lecture seule sur l'historique
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    await persistState({ checked: next });
  };

  const startEditMeal = (jourIdx, field, valeur) => {
    if (viewIndex !== null) return;
    setEditingKey(`meal-${jourIdx}-${field}`);
    setEditingValue(valeur || "");
  };

  const commitEditMeal = async (jourIdx, field) => {
    const val = editingValue.trim();
    setEditingKey(null);
    if (!val || !data) return;
    const nextData = {
      ...data,
      semaine: data.semaine.map((j, i) => (i === jourIdx ? { ...j, [field]: val } : j)),
    };
    setData(nextData);
    await persistState({ data: nextData });
  };

  const startEditArticle = (catIdx, itemIdx, valeur) => {
    if (viewIndex !== null) return;
    setEditingKey(`art-${catIdx}-${itemIdx}`);
    setEditingValue(valeur || "");
  };

  const commitEditArticle = async (catIdx, itemIdx) => {
    const val = editingValue.trim();
    setEditingKey(null);
    if (!val || !data) return;
    const nextData = {
      ...data,
      liste_courses: data.liste_courses.map((cat, ci) =>
        ci === catIdx ? { ...cat, articles: cat.articles.map((a, ai) => (ai === itemIdx ? val : a)) } : cat
      ),
    };
    setData(nextData);
    await persistState({ data: nextData });
  };

  const toggleFixe = async (field) => {
    if (viewIndex !== null || !data) return;
    if (repasFixes[field]) {
      const nextFixes = { ...repasFixes, [field]: null };
      setRepasFixes(nextFixes);
      await persistState({ repasFixes: nextFixes });
      return;
    }
    const valeur = data.semaine[0][field];
    const nextFixes = { ...repasFixes, [field]: valeur };
    const nextData = { ...data, semaine: data.semaine.map((j) => ({ ...j, [field]: valeur })) };
    setRepasFixes(nextFixes);
    setData(nextData);
    await persistState({ repasFixes: nextFixes, data: nextData });
  };

  const activeEntry =
    viewIndex === null
      ? { data, checked, contexteUtilise, editable: true }
      : {
          data: historique[viewIndex] ? historique[viewIndex].data : null,
          checked: historique[viewIndex] ? historique[viewIndex].checked || {} : {},
          contexteUtilise: historique[viewIndex] ? historique[viewIndex].contexteUtilise : null,
          editable: false,
        };

  // Les repas affichés dépendent du réglage utilisé au moment de la génération
  // de cette entrée précise (utile pour l'historique, généré avec un autre réglage).
  const mealsPourAffichage = MEALS_CONFIGS[activeEntry.contexteUtilise?.repasParJour] || mealsAtual;

  const resumeNutritionnel = useMemo(() => {
    if (!activeEntry.data) return null;
    const jours = activeEntry.data.semaine.filter((j) => Number.isFinite(j.kcal) && Number.isFinite(j.prot));
    if (jours.length === 0) return null;
    const moyenneKcal = Math.round(jours.reduce((s, j) => s + j.kcal, 0) / jours.length);
    const moyenneProt = Math.round(jours.reduce((s, j) => s + j.prot, 0) / jours.length);
    const cible = activeEntry.contexteUtilise?.cibleFoyer || null;
    return { moyenneKcal, moyenneProt, cible };
  }, [activeEntry.data, activeEntry.contexteUtilise]);

  const copierListe = async () => {
    if (!activeEntry.data) return;
    const lignes = [`🛒 Liste de courses${activeEntry.contexteUtilise ? " — " + activeEntry.contexteUtilise.objectif : ""}`];
    activeEntry.data.liste_courses.forEach((cat) => {
      lignes.push("");
      lignes.push(cat.categorie.toUpperCase());
      cat.articles.forEach((a) => lignes.push(`- ${a}`));
    });
    try {
      await navigator.clipboard.writeText(lignes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // best effort
    }
  };

  const totalItems = activeEntry.data
    ? activeEntry.data.liste_courses.reduce((n, cat) => n + cat.articles.length, 0)
    : 0;
  const checkedCount = Object.values(activeEntry.checked).filter(Boolean).length;

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, sans-serif",
        background: "#1E2A22",
        color: "#F1EDE2",
        minHeight: "100%",
        padding:
          "calc(20px + env(safe-area-inset-top, 0px)) 16px calc(100px + env(safe-area-inset-bottom, 0px)) 16px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap');
        .carnet-title { font-family: 'Fraunces', serif; }
        .chip { transition: background 120ms ease, border-color 120ms ease; }
        .item-row { transition: opacity 150ms ease; }
        ::-webkit-scrollbar { height: 6px; }
        ::-webkit-scrollbar-thumb { background: #3C4E40; border-radius: 3px; }
      `}</style>

      {/* En-tête */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9CAB9C", fontSize: 13, marginBottom: 4 }}>
          <ShoppingBasket size={15} />
          <span style={{ textTransform: "capitalize" }}>{moisLabel} · {semaineLabel}</span>
        </div>
        <h1 className="carnet-title" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 10px", lineHeight: 1.15 }}>
          Ton carnet de courses
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[...saisonMois.legumes.slice(0, 3), ...saisonMois.fruits.slice(0, 3)].map((item) => (
            <span
              key={item}
              style={{
                fontSize: 11,
                color: "#B7C6B8",
                background: "#26362C",
                border: "1px solid #2E3F33",
                borderRadius: 20,
                padding: "3px 9px",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {activeTab === "reglages" && (
      <>
      {/* Pays */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#9CAB9C", marginBottom: 6 }}>
          <MapPin size={13} />
          <span>Pays (pour la saisonnalité)</span>
        </div>
        <input
          value={pays}
          onChange={(e) => setPays(e.target.value)}
          placeholder="France"
          style={baseInputStyle}
        />
      </div>

      {/* Objectif */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>Ton objectif cette semaine</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {GOALS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGoalId(g.id)}
              className="chip"
              style={{
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: goalId === g.id ? "#3C4E40" : "#26362C",
                border: goalId === g.id ? "1px solid #D9A441" : "1px solid #2E3F33",
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#F1EDE2" }}>{g.label}</div>
                <div style={{ fontSize: 12, color: "#9CAB9C", marginTop: 2 }}>{g.desc}</div>
              </div>
              {goalId === g.id && <Check size={16} color="#D9A441" />}
            </button>
          ))}
        </div>
      </div>

      {/* Foyer / personnes */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>
          Qui mange cette semaine ? (besoins caloriques calculés automatiquement)
        </div>
        {personnes.map((p, i) => (
          <PersonneCard
            key={p.id}
            personne={p}
            index={i}
            onChange={updatePersonneField}
            onRemove={removePersonne}
            canRemove={personnes.length > 1}
          />
        ))}
        <button
          onClick={addPersonne}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "transparent",
            border: "1px dashed #3C4E40",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#9CAB9C",
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          <Plus size={15} /> Ajouter une personne
        </button>

        {cibleFoyer.parPersonne.length > 0 && (
          <div style={{ fontSize: 12, color: "#9CAB9C", marginTop: 10 }}>
            Cible foyer : <span style={{ color: "#D9A441" }}>≈{cibleFoyer.kcal} kcal</span> ·{" "}
            <span style={{ color: "#D9A441" }}>{cibleFoyer.prot}g protéines</span> / jour
            {cibleFoyer.incompletes > 0
              ? ` (${cibleFoyer.incompletes} profil${cibleFoyer.incompletes > 1 ? "s" : ""} incomplet${cibleFoyer.incompletes > 1 ? "s" : ""} exclu${cibleFoyer.incompletes > 1 ? "s" : ""} du calcul)`
              : ""}
          </div>
        )}
      </div>

      {/* Nombre de repas */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>Nombre de repas par jour</div>
        <div style={{ display: "flex", gap: 8 }}>
          {REPAS_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setRepasParJour(n)}
              style={{
                flex: 1,
                padding: "11px 8px",
                borderRadius: 8,
                border: repasParJour === n ? "1px solid #D9A441" : "1px solid #2E3F33",
                background: repasParJour === n ? "#3C4E40" : "#26362C",
                color: "#F1EDE2",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {n} repas
            </button>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>Budget courses</div>
        <div style={{ display: "flex", gap: 8 }}>
          {BUDGET_OPTIONS.map((b) => (
            <button
              key={b.id}
              onClick={() => setBudget(b.id)}
              style={{
                flex: 1,
                padding: "11px 8px",
                borderRadius: 8,
                border: budget === b.id ? "1px solid #D9A441" : "1px solid #2E3F33",
                background: budget === b.id ? "#3C4E40" : "#26362C",
                color: "#F1EDE2",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Type de cuisine */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>
          Type de cuisine (optionnel)
        </div>
        <input
          value={cuisine}
          onChange={(e) => setCuisine(e.target.value)}
          placeholder="ex: méditerranéenne, asiatique, classique..."
          style={baseInputStyle}
        />
      </div>

      {/* Aliments à éviter */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>
          Aliments à éviter (optionnel — allergies, ce que tu n'aimes pas)
        </div>
        <input
          value={exclusions}
          onChange={(e) => setExclusions(e.target.value)}
          placeholder="ex: poisson, lactose, coriandre"
          style={baseInputStyle}
        />
      </div>

      {/* CTA */}
      <button
        onClick={genererListe}
        disabled={!goalId || loading}
        style={{
          width: "100%",
          background: !goalId || loading ? "#3C4E40" : "#D9A441",
          color: !goalId || loading ? "#9CAB9C" : "#1E2A22",
          border: "none",
          borderRadius: 10,
          padding: "13px 16px",
          fontSize: 15,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: !goalId || loading ? "default" : "pointer",
        }}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="spin" /> {loadingStep || "Génération en cours..."}
          </>
        ) : data ? (
          <>
            <RefreshCw size={16} /> Régénérer ma semaine
          </>
        ) : (
          <>
            Générer ma semaine <ChevronRight size={16} />
          </>
        )}
      </button>

      {error && (
        <div style={{ marginTop: 10, fontSize: 13, color: "#C77B5F" }}>{error}</div>
      )}

      {error && (
        <button
          onClick={essayerViaClaude}
          style={{
            marginTop: 10,
            width: "100%",
            background: "transparent",
            border: "1px solid #D9A441",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#D9A441",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Essayer via Claude à la place
        </button>
      )}

      {fallbackPrompt && (
        <div
          style={{
            marginTop: 14,
            background: "#26362C",
            border: "1px solid #2E3F33",
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "#9CAB9C", marginBottom: 10, lineHeight: 1.6 }}>
            1. Copie ce texte
            <br />
            2. Colle-le dans l'appli Claude sur ton téléphone
            <br />
            3. Copie sa réponse en entier
            <br />
            4. Reviens ici et colle-la ci-dessous
          </div>

          <textarea
            readOnly
            value={fallbackPrompt}
            style={{
              width: "100%",
              minHeight: 140,
              background: "#1E2A22",
              border: "1px solid #3C4E40",
              borderRadius: 8,
              padding: 10,
              color: "#F1EDE2",
              fontSize: 16,
              boxSizing: "border-box",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={copierPromptSecours}
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: "1px solid #3C4E40",
              borderRadius: 7,
              padding: "10px 14px",
              color: fallbackCopied ? "#D9A441" : "#9CAB9C",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            {fallbackCopied ? <ClipboardCheck size={13} /> : <Copy size={13} />}
            {fallbackCopied ? "Copié" : "Copier le prompt"}
          </button>

          <div style={{ marginTop: 16, marginBottom: 6, fontSize: 13, color: "#9CAB9C" }}>
            Réponse de Claude
          </div>
          <textarea
            value={fallbackAnswer}
            onChange={(e) => setFallbackAnswer(e.target.value)}
            placeholder="Colle ici la réponse de Claude"
            style={{
              width: "100%",
              minHeight: 140,
              background: "#1E2A22",
              border: "1px solid #3C4E40",
              borderRadius: 8,
              padding: 10,
              color: "#F1EDE2",
              fontSize: 16,
              boxSizing: "border-box",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />

          {fallbackError && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#C77B5F" }}>{fallbackError}</div>
          )}

          <button
            onClick={validerReponseSecours}
            disabled={!fallbackAnswer.trim()}
            style={{
              marginTop: 10,
              width: "100%",
              background: fallbackAnswer.trim() ? "#D9A441" : "#3C4E40",
              color: fallbackAnswer.trim() ? "#1E2A22" : "#9CAB9C",
              border: "none",
              borderRadius: 10,
              padding: "13px 16px",
              fontSize: 15,
              fontWeight: 600,
              cursor: fallbackAnswer.trim() ? "pointer" : "default",
            }}
          >
            Valider cette réponse
          </button>
        </div>
      )}
      </>
      )}

      {activeTab === "menus" && (
        <div>
          {!activeEntry.data && (
            <div style={{ fontSize: 13, color: "#9CAB9C", textAlign: "center", padding: "40px 10px" }}>
              Aucun menu pour l'instant. Va dans l'onglet Réglages pour générer ta semaine.
            </div>
          )}

          {activeEntry.contexteUtilise && (
            <div
              style={{
                fontSize: 12,
                color: "#9CAB9C",
                marginBottom: 14,
                paddingBottom: 12,
                borderBottom: "1px solid #2E3F33",
              }}
            >
              Généré pour <span style={{ color: "#D9A441" }}>{activeEntry.contexteUtilise.objectif.toLowerCase()}</span> ·{" "}
              <span style={{ textTransform: "capitalize" }}>{activeEntry.contexteUtilise.mois}</span> ·{" "}
              {activeEntry.contexteUtilise.localisation}
              {viewIndex !== null ? " · lecture seule (historique)" : ""}
            </div>
          )}

          {activeEntry.data && (
            <>
              <div className="carnet-title" style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
                Associations de la semaine
              </div>

              {resumeNutritionnel && (
                <div style={{ fontSize: 12, color: "#9CAB9C", marginBottom: 14 }}>
                  Moyenne semaine : <span style={{ color: "#D9A441" }}>≈{resumeNutritionnel.moyenneKcal} kcal/jour</span> ·{" "}
                  <span style={{ color: "#D9A441" }}>{resumeNutritionnel.moyenneProt}g protéines</span>
                  {resumeNutritionnel.cible
                    ? ` — cible foyer : ${resumeNutritionnel.cible.kcal} kcal · ${resumeNutritionnel.cible.prot}g`
                    : ""}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                {activeEntry.data.semaine.map((jour, jourIdx) => (
                  <div
                    key={jour.jour}
                    style={{
                      flex: "0 0 190px",
                      background: "#26362C",
                      border: "1px solid #2E3F33",
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#D9A441", marginBottom: 8 }}>
                      {jour.jour}
                    </div>
                    {mealsPourAffichage.map(({ key: field, label }) => {
                      const val = jour[field];
                      const editKey = `meal-${jourIdx}-${field}`;
                      const estFige = !!repasFixes[field];
                      return (
                        <div key={field} style={{ marginBottom: 7 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: 10,
                              color: "#9CAB9C",
                              textTransform: "uppercase",
                              letterSpacing: 0.4,
                            }}
                          >
                            <span>{label}</span>
                            {activeEntry.editable && jourIdx === 0 && (
                              <button
                                onClick={() => toggleFixe(field)}
                                title={estFige ? "Libérer ce repas" : "Garder ce repas toute la semaine"}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 12,
                                  margin: -12,
                                  cursor: "pointer",
                                  color: estFige ? "#D9A441" : "#5A6E5E",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {estFige ? <Pin size={11} /> : <PinOff size={11} />}
                              </button>
                            )}
                          </div>
                          {editingKey === editKey ? (
                            <input
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => commitEditMeal(jourIdx, field)}
                              onKeyDown={(e) => e.key === "Enter" && commitEditMeal(jourIdx, field)}
                              style={{
                                width: "100%",
                                background: "#1E2A22",
                                border: "1px solid #D9A441",
                                borderRadius: 4,
                                padding: "3px 5px",
                                color: "#F1EDE2",
                                fontSize: 16,
                                outline: "none",
                                boxSizing: "border-box",
                              }}
                            />
                          ) : (
                            <div
                              onClick={() => activeEntry.editable && startEditMeal(jourIdx, field, val)}
                              style={{
                                fontSize: 12.5,
                                lineHeight: 1.4,
                                cursor: activeEntry.editable ? "text" : "default",
                              }}
                            >
                              {val}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(jour.kcal || jour.prot) && (
                      <div style={{ fontSize: 10.5, color: "#7C8C7E", marginTop: 4, paddingTop: 6, borderTop: "1px solid #2E3F33" }}>
                        {jour.kcal ? `≈${jour.kcal} kcal` : ""}
                        {jour.kcal && jour.prot ? " · " : ""}
                        {jour.prot ? `${jour.prot}g prot` : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "courses" && (
        <div>
          {!activeEntry.data && (
            <div style={{ fontSize: 13, color: "#9CAB9C", textAlign: "center", padding: "40px 10px" }}>
              Aucune liste de courses pour l'instant. Génère ta semaine depuis l'onglet Réglages.
            </div>
          )}
          {activeEntry.data && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div className="carnet-title" style={{ fontSize: 17, fontWeight: 600 }}>
                  Liste de courses
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={copierListe}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "transparent",
                      border: "1px solid #3C4E40",
                      borderRadius: 7,
                      padding: "10px 14px",
                      color: copied ? "#D9A441" : "#9CAB9C",
                      fontSize: 11.5,
                      cursor: "pointer",
                    }}
                  >
                    {copied ? <ClipboardCheck size={12} /> : <Copy size={12} />}
                    {copied ? "Copié" : "Copier"}
                  </button>
                  <div style={{ fontSize: 12, color: "#9CAB9C" }}>
                    {checkedCount}/{totalItems}
                  </div>
                </div>
              </div>

              {activeEntry.data.liste_courses.map((cat, catIdx) => (
                <div key={cat.categorie} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#D9A441", marginBottom: 6 }}>
                    {cat.categorie}
                  </div>
                  {cat.articles.map((art, itemIdx) => {
                    const key = `${cat.categorie}-${itemIdx}`;
                    const isChecked = !!activeEntry.checked[key];
                    const editKey = `art-${catIdx}-${itemIdx}`;
                    if (editingKey === editKey) {
                      return (
                        <input
                          key={key}
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => commitEditArticle(catIdx, itemIdx)}
                          onKeyDown={(e) => e.key === "Enter" && commitEditArticle(catIdx, itemIdx)}
                          style={{
                            width: "100%",
                            background: "#1E2A22",
                            border: "1px solid #D9A441",
                            borderRadius: 4,
                            padding: "6px 8px",
                            color: "#F1EDE2",
                            fontSize: 16,
                            outline: "none",
                            boxSizing: "border-box",
                            marginBottom: 2,
                          }}
                        />
                      );
                    }
                    return (
                      <div
                        key={key}
                        className="item-row"
                        onClick={() => toggleItem(key)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "11px 4px",
                          minHeight: 36,
                          cursor: "pointer",
                          opacity: isChecked ? 0.45 : 1,
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 4,
                            border: isChecked ? "none" : "1px solid #5A6E5E",
                            background: isChecked ? "#D9A441" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {isChecked && <Check size={11} color="#1E2A22" />}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            fontSize: 14,
                            textDecoration: isChecked ? "line-through" : "none",
                          }}
                        >
                          {art}
                        </div>
                        {activeEntry.editable && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditArticle(catIdx, itemIdx, art);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 12,
                              margin: "-12px 0",
                              cursor: "pointer",
                              color: "#5A6E5E",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === "historique" && (
        <div>
          {!data && historique.length === 0 && (
            <div style={{ fontSize: 13, color: "#9CAB9C", textAlign: "center", padding: "40px 10px" }}>
              Aucune semaine précédente pour l'instant.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data && (
              <button
                onClick={() => {
                  setViewIndex(null);
                  setActiveTab("menus");
                }}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: viewIndex === null ? "1px solid #D9A441" : "1px solid #2E3F33",
                  background: viewIndex === null ? "#3C4E40" : "#26362C",
                  color: "#F1EDE2",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Semaine actuelle
              </button>
            )}
            {historique.map((h, i) => (
              <button
                key={h.id}
                onClick={() => {
                  setViewIndex(i);
                  setActiveTab("menus");
                }}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: viewIndex === i ? "1px solid #D9A441" : "1px solid #2E3F33",
                  background: viewIndex === i ? "#3C4E40" : "#26362C",
                  color: "#F1EDE2",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {new Date(h.id).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                {h.contexteUtilise ? ` · ${h.contexteUtilise.objectif}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          background: "#26362C",
          borderTop: "1px solid #2E3F33",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          zIndex: 50,
        }}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              minHeight: 52,
              padding: "10px 4px",
              background: "none",
              border: "none",
              color: activeTab === id ? "#D9A441" : "#9CAB9C",
              cursor: "pointer",
            }}
          >
            <Icon size={20} />
            <span style={{ fontSize: 10.5 }}>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
