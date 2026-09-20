import React, { useState, useEffect, useCallback } from "react";
import { MapPin, RefreshCw, Check, Loader2, ChevronRight, ShoppingBasket, Pin, PinOff, Pencil, Copy, ClipboardCheck } from "lucide-react";

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

export default function CarnetDeCourses() {
  const now = new Date();
  const moisLabel = MOIS_FR[now.getMonth()];
  const semaineLabel = `S${getISOWeek(now)} · ${now.getFullYear()}`;
  const saisonMois = SAISON_FR[now.getMonth()];

  const [goalId, setGoalId] = useState(null);
  const [taille, setTaille] = useState("");
  const [poids, setPoids] = useState("");
  const [pays, setPays] = useState("France");
  const [exclusions, setExclusions] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [checked, setChecked] = useState({});
  const [generatedAt, setGeneratedAt] = useState(null);
  const [contexteUtilise, setContexteUtilise] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [viewIndex, setViewIndex] = useState(null); // null = semaine actuelle, sinon index dans historique
  const [repasFixes, setRepasFixes] = useState({ petit_dej: null, collation: null, dejeuner: null, diner: null });
  const [editingKey, setEditingKey] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [copied, setCopied] = useState(false);

  // Load last saved list on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setGoalId(saved.goalId || null);
        setTaille(saved.taille || "");
        setPoids(saved.poids || "");
        setPays(saved.pays || "France");
        setExclusions(saved.exclusions || "");
        setData(saved.data || null);
        setChecked(saved.checked || {});
        setGeneratedAt(saved.generatedAt || null);
        setContexteUtilise(saved.contexteUtilise || null);
        setHistorique(saved.historique || []);
        setRepasFixes(saved.repasFixes || { petit_dej: null, collation: null, dejeuner: null, diner: null });
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

  const genererListe = async () => {
    if (!goalId) return;
    setLoading(true);
    setError(null);

    const goal = GOALS.find((g) => g.id === goalId);
    const paysLabel = pays.trim() || "France";
    const localisationLabel = paysLabel;
    const exclusionsTrim = exclusions.trim();

    const semainePrecedente = data
      ? data.semaine.map((j) => `${j.petit_dej}; ${j.collation}; ${j.dejeuner}; ${j.diner}`).join(" | ")
      : null;

    const contexte = `- Mois actuel : ${moisLabel}\n- Pays : ${paysLabel}\n- Objectif : ${goal.label} — ${goal.desc}\n- Légumes de saison ce mois-ci : ${saisonMois.legumes.join(", ")}\n- Fruits de saison ce mois-ci : ${saisonMois.fruits.join(", ")} (cette liste part d'un climat tempéré ; adapte-la si le pays a un climat très différent)${
      taille || poids
        ? `\n- Corpulence : ${taille ? `${taille}cm` : "taille non précisée"}, ${poids ? `${poids}kg` : "poids non précisé"} (ajuste les quantités et apports en conséquence)`
        : ""
    }${exclusionsTrim ? `\n- À éviter absolument (allergies/préférences) : ${exclusionsTrim}` : ""}${
      semainePrecedente ? `\n- Repas de la semaine précédente, à varier (évite de répéter les mêmes associations) : ${semainePrecedente}` : ""
    }`;

    try {
      // Étape 1 — menus, scindée en 2 appels (début/fin de semaine) pour rester dans le budget de réponse
      const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
      const menusPromptPour = (joursSubset) => {
        const exemple = joursSubset
          .map((j) => `  {"jour": "${j}", "petit_dej": "...", "collation": "...", "dejeuner": "...", "diner": "...", "kcal": 2200, "prot": 140}`)
          .join(",\n");
        return `Tu es un nutritionniste pragmatique qui aide quelqu'un à composer ses repas de la semaine.

Contexte :
${contexte}

Consigne stricte : ne donne AUCUNE recette, juste pour chaque repas (dont la collation) une courte association d'aliments AVEC quantités précises pour une personne, en priorisant les légumes/fruits de saison listés ci-dessus et en respectant les aliments à éviter le cas échéant. TOUTES les quantités sont en poids CRU, tel qu'acheté et pesé avant cuisson — n'écris JAMAIS le mot "cuit(es)" ni un poids cuit. C'est particulièrement important pour le riz et les pâtes, qui doublent de poids à la cuisson : utilise leur poids sec (ex: "80g riz cru", "90g pâtes crues"), jamais "180g riz cuit" ou "200g pâtes cuites". Format quantité : grammes pour le solide (ex: "100g flocons d'avoine"), cl pour le liquide (ex: "20cl lait entier"), pièces pour les fruits/légumes entiers (ex: "2 bananes"), cuillères pour les condiments. Exemple complet : "100g flocons d'avoine + 20cl lait entier + 2 bananes". Reste concis, 3 aliments max par repas. Ajoute aussi pour chaque jour une estimation approximative du total kcal ("kcal", nombre entier) et des protéines en grammes ("prot", nombre entier) sur l'ensemble de la journée. Génère UNIQUEMENT les jours suivants : ${joursSubset.join(", ")}.

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

      const menusData = {
        semaine: [...menusData1.semaine, ...menusData2.semaine].map((j) => ({
          jour: j.jour,
          petit_dej: repasFixes.petit_dej || crudifie(j.petit_dej),
          collation: repasFixes.collation || crudifie(j.collation),
          dejeuner: repasFixes.dejeuner || crudifie(j.dejeuner),
          diner: repasFixes.diner || crudifie(j.diner),
          kcal: j.kcal,
          prot: j.prot,
        })),
      };

      // Étape 2 — liste de courses dérivée des menus ci-dessus
      setLoadingStep("Construction de la liste de courses...");
      const resumeMenus = menusData.semaine
        .map((j) => `${j.jour}: ${j.petit_dej} / collation: ${j.collation} / ${j.dejeuner} / ${j.diner}`)
        .join("\n");
      const corpulence =
        taille || poids
          ? `Corpulence de la personne : ${taille ? `${taille}cm` : "taille non précisée"}, ${poids ? `${poids}kg` : "poids non précisé"} — ajuste les quantités en conséquence (portions plus grosses pour un gabarit plus élevé et pour l'objectif "${goal.label}").\n`
          : "";
      const promptListe = `Voici les repas prévus cette semaine pour une personne (objectif : ${goal.label}) :
${resumeMenus}

${corpulence}Construis la liste de courses correspondante pour 7 jours, une personne, en cumulant les quantités déjà indiquées ci-dessus pour chaque ingrédient (évite les doublons, additionne). TOUTES les quantités sont en poids CRU, tel qu'acheté avant cuisson — n'écris JAMAIS "cuit(es)". Pour le riz et les pâtes en particulier, utilise le poids sec/cru (ex: "80g riz cru"), jamais un poids cuit. Maximum 5 catégories, maximum 6 articles par catégorie. Chaque article est une seule chaîne courte "nom + quantité totale" (ex: "Poulet 600g", "Riz basmati 1kg", "Brocolis 2 têtes").

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

      const parsed = {
        semaine: menusData.semaine,
        liste_courses: listeData.liste_courses.map((cat) => ({
          categorie: cat.categorie,
          articles: cat.articles.map(crudifie),
        })),
      };
      const ts = new Date().toISOString();
      const ctx = { mois: moisLabel, localisation: localisationLabel, objectif: goal.label };

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
      await persist({
        goalId,
        taille,
        poids,
        pays,
        exclusions,
        repasFixes,
        data: parsed,
        checked: {},
        generatedAt: ts,
        contexteUtilise: ctx,
        historique: nouvelHistorique,
      });
    } catch (e) {
      setError(`La génération a échoué : ${e.message || "erreur inconnue"}. Réessaie.`);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const persistState = useCallback(
    async (overrides = {}) => {
      await persist({
        goalId,
        taille,
        poids,
        pays,
        exclusions,
        repasFixes,
        data,
        checked,
        generatedAt,
        contexteUtilise,
        historique,
        ...overrides,
      });
    },
    [persist, goalId, taille, poids, pays, exclusions, repasFixes, data, checked, generatedAt, contexteUtilise, historique]
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
          "calc(20px + env(safe-area-inset-top, 0px)) 16px calc(48px + env(safe-area-inset-bottom, 0px)) 16px",
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
          style={{
            width: "100%",
            background: "#26362C",
            border: "1px solid #3C4E40",
            borderRadius: 8,
            padding: "10px 12px",
            color: "#F1EDE2",
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
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

      {/* Corpulence */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#9CAB9C", marginBottom: 8 }}>
          Ton gabarit (optionnel, ajuste les quantités)
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <input
              type="number"
              inputMode="numeric"
              value={taille}
              onChange={(e) => setTaille(e.target.value)}
              placeholder="Taille (cm)"
              style={{
                width: "100%",
                background: "#26362C",
                border: "1px solid #3C4E40",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#F1EDE2",
                fontSize: 16,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <input
              type="number"
              inputMode="numeric"
              value={poids}
              onChange={(e) => setPoids(e.target.value)}
              placeholder="Poids (kg)"
              style={{
                width: "100%",
                background: "#26362C",
                border: "1px solid #3C4E40",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#F1EDE2",
                fontSize: 16,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
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
          style={{
            width: "100%",
            background: "#26362C",
            border: "1px solid #3C4E40",
            borderRadius: 8,
            padding: "10px 12px",
            color: "#F1EDE2",
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
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

      {/* Résultats */}
      {(data || historique.length > 0) && (
        <div style={{ marginTop: 28 }}>
          {historique.length > 0 && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
              {data && (
                <button
                  onClick={() => setViewIndex(null)}
                  style={{
                    flexShrink: 0,
                    fontSize: 11.5,
                    padding: "11px 14px",
                    borderRadius: 20,
                    border: viewIndex === null ? "1px solid #D9A441" : "1px solid #2E3F33",
                    background: viewIndex === null ? "#3C4E40" : "#26362C",
                    color: "#F1EDE2",
                    cursor: "pointer",
                  }}
                >
                  Semaine actuelle
                </button>
              )}
              {historique.map((h, i) => (
                <button
                  key={h.id}
                  onClick={() => setViewIndex(i)}
                  style={{
                    flexShrink: 0,
                    fontSize: 11.5,
                    padding: "11px 14px",
                    borderRadius: 20,
                    border: viewIndex === i ? "1px solid #D9A441" : "1px solid #2E3F33",
                    background: viewIndex === i ? "#3C4E40" : "#26362C",
                    color: "#9CAB9C",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {new Date(h.id).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  {h.contexteUtilise ? ` · ${h.contexteUtilise.objectif}` : ""}
                </button>
              ))}
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
            </div>
          )}

          {activeEntry.data && (
            <>
              <div className="carnet-title" style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>
                Associations de la semaine
              </div>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginBottom: 24 }}>
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
                    {[
                      ["Matin", "petit_dej"],
                      ["Collation", "collation"],
                      ["Midi", "dejeuner"],
                      ["Soir", "diner"],
                    ].map(([label, field]) => {
                      const val = jour[field];
                      const editKey = `meal-${jourIdx}-${field}`;
                      const estFige = !!repasFixes[field];
                      return (
                        <div key={label} style={{ marginBottom: 7 }}>
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

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
