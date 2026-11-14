// Relais d'import de recettes (Cloudflare Workers).
// Reçoit /?url=<lien de recette>, lit la page, renvoie {name, url, ingredients[]}.

// Sites autorisés : ajoutez ici d'autres domaines plus tard (ex. "750g.com").
const ALLOWED = ["marmiton.org"];
// Qui peut appeler ce relais. "*" = tout le monde ; pour restreindre,
// mettez l'adresse de votre appli, ex. "https://VOTRE-PSEUDO.github.io".
const ORIGIN = "*";

const HEADERS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: HEADERS });

const allowedHost = (host) => {
  host = host.replace(/^www\./, "");
  return ALLOWED.some((d) => host === d || host.endsWith("." + d));
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: HEADERS });

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get("url"));
    } catch {
      return json({ error: "Lien invalide" }, 400);
    }
    if (!/^https?:$/.test(target.protocol) || !allowedHost(target.hostname)) {
      return json({ error: "Ce site n'est pas autorisé par le relais" }, 403);
    }

    let res;
    try {
      res = await fetch(target.href, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });
    } catch {
      return json({ error: "Le site n'a pas répondu" }, 502);
    }
    if (!allowedHost(new URL(res.url).hostname)) {
      return json({ error: "Redirection vers un site non autorisé" }, 403);
    }
    if (!res.ok) return json({ error: "Page inaccessible (code " + res.status + ")" }, 502);

    const html = await res.text();
    const recipe = findRecipe(html);
    if (!recipe) return json({ error: "Aucune recette trouvée sur cette page" }, 422);

    const ingredients = (recipe.recipeIngredient || recipe.ingredients || [])
      .map((x) => decode(String(x)))
      .filter(Boolean);
    // Titre affiché sur la page (plus court que le nom des données structurées)
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
    const title = h1 ? decode(h1.replace(/<[^>]+>/g, "")) : "";
    return json({
      url: res.url,
      name: title && title.length < 120 ? title : decode(String(recipe.name || "")),
      image: imageOf(recipe),
      ingredients,
    });
  },
};

function findRecipe(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const found = pick(JSON.parse(m[1].trim()));
      if (found) return found;
    } catch {}
  }
  return null;
}

function pick(d) {
  if (Array.isArray(d)) {
    for (const x of d) {
      const r = pick(x);
      if (r) return r;
    }
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const t = d["@type"];
  if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return d;
  return d["@graph"] ? pick(d["@graph"]) : null;
}

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function imageOf(r) {
  let i = r.image;
  if (Array.isArray(i)) i = i[0];
  if (i && typeof i === "object") i = i.url || i.contentUrl;
  return typeof i === "string" && /^https?:\/\//.test(i) ? i : "";
}
