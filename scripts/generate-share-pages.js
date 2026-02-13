#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "data", "content.js");
const OUT_ROOT = path.join(ROOT, "share");

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function truncate(s, maxLen) {
  const t = normalizeText(s);
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trimEnd()}…`;
}

function encodePathSegments(p) {
  return String(p || "")
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/'/g, "%27"))
    .join("/");
}

function relFromShare(p) {
  const clean = String(p || "").replace(/^\/+/, "");
  return `../../../${encodePathSegments(clean)}`;
}

function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function rmDirIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(outPath, content) {
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, content, "utf8");
}

function loadStaszek() {
  const code = fs.readFileSync(CONTENT_PATH, "utf8");
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "data/content.js" });
  const st = ctx.window.STASZEK;
  if (!st) throw new Error("window.STASZEK not found after evaluating data/content.js");
  return st;
}

function sharePageHtml({ title, description, imageUrl, imageAlt, targetHash }) {
  const ogTitle = escapeHtml(title);
  const ogDesc = escapeHtml(description);
  const ogImg = escapeHtml(imageUrl);
  const ogAlt = escapeHtml(imageAlt || title);
  const target = escapeHtml(targetHash);

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${ogTitle}</title>
    <meta name="description" content="${ogDesc}" />

    <meta property="og:type" content="website" />
    <meta property="og:locale" content="pl_PL" />
    <meta property="og:site_name" content="STASZEK DLA STASZICA" />
    <meta property="og:title" content="${ogTitle}" />
    <meta property="og:description" content="${ogDesc}" />
    <meta property="og:image" content="${ogImg}" />
    <meta property="og:image:alt" content="${ogAlt}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${ogTitle}" />
    <meta name="twitter:description" content="${ogDesc}" />
    <meta name="twitter:image" content="${ogImg}" />

    <link rel="icon" type="image/svg+xml" href="../../../assets/icon.svg" />
    <meta name="theme-color" content="#070b1b" />
    <style>
      :root { color-scheme: dark light; }
      body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #070b1b; color: #fff; }
      .wrap { max-width: 860px; margin: 0 auto; padding: 24px 14px; }
      .card { border-radius: 18px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.04); padding: 16px; }
      .muted { color: rgba(255,255,255,0.75); line-height: 1.55; }
      a.btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.16); text-decoration: none; color: #fff; background: rgba(255,255,255,0.06); }
      a.btn.primary { background: rgba(242,196,90,0.14); border-color: rgba(242,196,90,0.35); }
      .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1 style="margin: 0 0 8px; font-size: 18px;">${ogTitle}</h1>
        <p class="muted" style="margin: 0;">Otwórz treść na stronie kampanii.</p>
        <div class="row">
          <a class="btn primary" href="../../../${target}">Otwórz</a>
          <a class="btn" href="../../../">Strona główna</a>
        </div>
      </div>
    </div>
    <script>
      (function () {
        var ua = String(navigator.userAgent || "").toLowerCase();
        var isBot = /facebookexternalhit|twitterbot|discordbot|slackbot|whatsapp|telegrambot|linkedinbot|pinterest|embedly|quora|tumblr|vkshare|skypeuripreview|applebot|googlebot|bingbot|crawler|spider|bot\\b/.test(ua);
        if (isBot) return;
        var target = "../../../${target}";
        setTimeout(function () { try { location.replace(target); } catch (e) {} }, 120);
      })();
    </script>
  </body>
</html>
`;
}

function main() {
  const st = loadStaszek();
  const news = Array.from(st.news || []);
  const program = Array.from(st.program || []);
  const posters = Array.from(st?.images?.posters || []);

  rmDirIfExists(path.join(OUT_ROOT, "aktualnosci"));
  rmDirIfExists(path.join(OUT_ROOT, "pomysly"));
  rmDirIfExists(path.join(OUT_ROOT, "plakaty"));

  // Aktualności
  for (const p of news) {
    const id = String(p?.id || "").trim();
    if (!id) continue;
    const title = `${String(p?.title || "Aktualność").trim() || "Aktualność"} • STASZEK DLA STASZICA`;
    const description = truncate(p?.body || "", 160) || "Aktualności kampanii — STASZEK DLA STASZICA.";
    const imageSrc =
      (Array.isArray(p?.images) && p.images[0]) ||
      p?.image ||
      posters[0]?.src ||
      st?.images?.program ||
      st?.images?.main ||
      "";
    const imageUrl = imageSrc ? relFromShare(imageSrc) : "";
    const targetHash = `#/aktualnosci?post=${encodeURIComponent(id)}`;
    const html = sharePageHtml({
      title,
      description,
      imageUrl,
      imageAlt: p?.title || "Aktualności",
      targetHash,
    });
    writeFile(path.join(OUT_ROOT, "aktualnosci", id, "index.html"), html);
  }

  // Program / Pomysły
  for (const pt of program) {
    const id = String(pt?.id ?? "").trim();
    if (!id) continue;
    const title = `${id}. ${String(pt?.title || "Punkt programu").trim()} • STASZEK DLA STASZICA`;
    const description =
      truncate(pt?.lead || pt?.spotlightText || "", 160) ||
      "Program kampanii — STASZEK DLA STASZICA.";
    const imageSrc =
      pt?.spotlightImage ||
      st?.images?.program ||
      posters[0]?.src ||
      st?.images?.main ||
      "";
    const imageUrl = imageSrc ? relFromShare(imageSrc) : "";
    const targetHash = `#/pomysly?punkt=${encodeURIComponent(id)}`;
    const html = sharePageHtml({
      title,
      description,
      imageUrl,
      imageAlt: pt?.title || "Pomysły / Program",
      targetHash,
    });
    writeFile(path.join(OUT_ROOT, "pomysly", id, "index.html"), html);
  }

  // Plakaty
  for (const po of posters) {
    const src = String(po?.src || "").trim();
    if (!src) continue;
    const key = hash32(src);
    const title = `${String(po?.title || "Plakat").trim()} • STASZEK DLA STASZICA`;
    const description =
      truncate(po?.subtitle || "Plakat wyborczy kampanii.", 160) ||
      "Plakat wyborczy kampanii — STASZEK DLA STASZICA.";
    const imageUrl = relFromShare(src);
    const targetHash = `#/plakaty?poster=${encodeURIComponent(key)}`;
    const html = sharePageHtml({
      title,
      description,
      imageUrl,
      imageAlt: po?.title || "Plakat",
      targetHash,
    });
    writeFile(path.join(OUT_ROOT, "plakaty", key, "index.html"), html);
  }

  // Small entry page (optional)
  const indexHtml = `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>STASZEK DLA STASZICA — Share</title>
  </head>
  <body>
    <p>Ta część strony jest generowana automatycznie (podglądy linków).</p>
    <p><a href="../">Wróć</a></p>
  </body>
</html>
`;
  writeFile(path.join(OUT_ROOT, "index.html"), indexHtml);

  console.log(
    `Generated share pages: news=${news.length}, program=${program.length}, posters=${posters.length}`
  );
}

main();
