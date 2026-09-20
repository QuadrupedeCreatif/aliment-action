const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Modèle Gemini gratuit (Flash). Vérifie/ajuste ce nom sur https://aistudio.google.com
// si Google en propose un plus récent au moment où tu lis ceci.
const GEMINI_MODEL = "gemini-3.6-flash";
// Modèle de repli, tenté une seule fois si GEMINI_MODEL reste indisponible
// (503) après les retries. "-lite" est le suffixe habituel des variantes
// allégées de Gemini ; ajuste GEMINI_MODEL_FALLBACK directement si Google
// nomme sa variante lite différemment au moment où tu lis ceci.
const GEMINI_MODEL_FALLBACK = `${GEMINI_MODEL}-lite`;

// Délais (ms) avant chaque nouvelle tentative sur GEMINI_MODEL en cas de 503
// ("UNAVAILABLE" / forte demande côté Gemini) — 2 retries au total.
const RETRY_DELAYS_MS = [1000, 2000];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callGemini(model, prompt, apiKey) {
  return fetch(`${GEMINI_URL}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Méthode non autorisée" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let prompt;
    try {
      const body = await request.json();
      prompt = body.prompt;
    } catch (e) {
      return new Response(JSON.stringify({ error: "Corps JSON invalide" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Le champ 'prompt' (string) est requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY non configurée sur le Worker" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let geminiResponse = await callGemini(GEMINI_MODEL, prompt, env.GEMINI_API_KEY);

    // Retry sur 503 (Gemini en forte demande) : jusqu'à 2 tentatives
    // supplémentaires sur le modèle principal, avec un court délai entre elles.
    for (let i = 0; geminiResponse.status === 503 && i < RETRY_DELAYS_MS.length; i++) {
      await sleep(RETRY_DELAYS_MS[i]);
      geminiResponse = await callGemini(GEMINI_MODEL, prompt, env.GEMINI_API_KEY);
    }

    // Toujours 503 après les retries : dernière tentative sur un modèle de repli.
    if (geminiResponse.status === 503) {
      geminiResponse = await callGemini(GEMINI_MODEL_FALLBACK, prompt, env.GEMINI_API_KEY);
    }

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      return new Response(errorBody, {
        status: geminiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiJson = await geminiResponse.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // On reformate dans la forme attendue par le front (compatible avec l'ancien
    // format Anthropic : { content: [{ type: "text", text }] }) pour ne rien
    // avoir à changer côté carnet-de-courses.jsx.
    const compatBody = { content: [{ type: "text", text }] };

    return new Response(JSON.stringify(compatBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};
