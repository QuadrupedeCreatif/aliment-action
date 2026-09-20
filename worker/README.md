# Worker relais Google Gemini

Petit relais Cloudflare Worker : reçoit `{ prompt }` depuis le front, appelle
l'API Google Gemini (gratuite, via Google AI Studio) avec la clé secrète côté
serveur, renvoie une réponse JSON avec les en-têtes CORS nécessaires. La clé
API n'est jamais exposée au navigateur. La réponse Gemini est reformatée pour
rester compatible avec ce que `src/carnet-de-courses.jsx` attend.

## Obtenir une clé Gemini gratuite

1. Va sur https://aistudio.google.com/apikey
2. "Create API key" (aucune carte bancaire requise pour le tier gratuit)
3. Copie la clé générée

## Déploiement

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

`wrangler deploy` affiche l'URL publique du Worker (ex:
`https://carnet-courses-worker.<ton-sous-domaine>.workers.dev`). Colle cette
URL dans `WORKER_URL` en haut de `src/carnet-de-courses.jsx`.

Le modèle utilisé est défini par `GEMINI_MODEL` dans `src/index.js` — vérifie
sur https://aistudio.google.com quel modèle Flash gratuit est le plus récent
si tu veux le mettre à jour.
