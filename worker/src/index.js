const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Modèle Gemini gratuit (Flash). Vérifie/ajuste ce nom sur https://aistudio.google.com
// si Google en propose un plus récent au moment où tu lis ceci.
const GEMINI_MODEL = "gemini-3.6-flash";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

    const geminiResponse = await fetch(
      `${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

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
