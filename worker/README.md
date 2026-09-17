# Worker relais Anthropic

Petit relais Cloudflare Worker : reçoit `{ prompt }` depuis le front, appelle
l'API Anthropic avec la clé secrète côté serveur, renvoie la réponse JSON avec
les en-têtes CORS nécessaires. La clé API n'est jamais exposée au navigateur.

## Déploiement

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

`wrangler deploy` affiche l'URL publique du Worker (ex:
`https://carnet-courses-worker.<ton-sous-domaine>.workers.dev`). Colle cette
URL dans `WORKER_URL` en haut de `src/carnet-de-courses.jsx`.
