#!/usr/bin/env node
"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..");
const API_PREFIX = "/api";
const PUBLIC_CONTENT_JS_PATH = path.join(STATIC_ROOT, "data", "content.js");
const PUBLIC_APP_JS_PATH = path.join(STATIC_ROOT, "app.js");
const PUBLIC_INDEX_HTML_PATH = path.join(STATIC_ROOT, "index.html");

function stripJsBlockComments(code) {
  // Only strip /* ... */ to avoid breaking URLs like "https://..." inside strings.
  return String(code || "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalizePublicPath(p) {
  let s = String(p || "");
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\\/g, "/").replace(/\/+/g, "/");
  try {
    // Normalize to reduce Unicode normalization mismatches (macOS often uses NFD).
    return s.normalize("NFC");
  } catch {
    return s;
  }
}

function addAllowedPublicPath(set, p) {
  const base = normalizePublicPath(p);
  set.add(base);
  try {
    set.add(base.normalize("NFD"));
    set.add(base.normalize("NFC"));
  } catch {}
}

function extractMediaPathsFromSource(source, set) {
  const raw = String(source || "");
  const re = /["']((?:zdjęcia|video|audio)\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(raw))) {
    const rel = String(m[1] || "").trim();
    if (!rel) continue;
    addAllowedPublicPath(set, `/${rel}`);
  }
}

function buildPublicMediaAllowlist() {
  const set = new Set();
  const contentRaw = fs.readFileSync(PUBLIC_CONTENT_JS_PATH, "utf8");
  const contentNoBlockComments = stripJsBlockComments(contentRaw);
  extractMediaPathsFromSource(contentNoBlockComments, set);

  // Media can also be referenced in app.js (e.g., audio).
  const appRaw = stripJsBlockComments(fs.readFileSync(PUBLIC_APP_JS_PATH, "utf8"));
  extractMediaPathsFromSource(appRaw, set);

  // And in index.html (e.g., og:image).
  const indexRaw = fs.readFileSync(PUBLIC_INDEX_HTML_PATH, "utf8");
  extractMediaPathsFromSource(indexRaw, set);

  return set;
}

let PUBLIC_MEDIA_ALLOWLIST = null;
let PUBLIC_CONTENT_JS_STRIPPED = null;
try {
  PUBLIC_MEDIA_ALLOWLIST = buildPublicMediaAllowlist();
} catch (e) {
  PUBLIC_MEDIA_ALLOWLIST = new Set();
  error("WARN: Failed to build public media allowlist. Media will be blocked.", e);
}
try {
  const raw = fs.readFileSync(PUBLIC_CONTENT_JS_PATH, "utf8");
  PUBLIC_CONTENT_JS_STRIPPED = stripJsBlockComments(raw);
} catch (e) {
  PUBLIC_CONTENT_JS_STRIPPED = null;
  error("WARN: Failed to read data/content.js. The site may not work.", e);
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function error(...args) {
  // eslint-disable-next-line no-console
  console.error(...args);
}

function loadDotEnv(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
  } catch {
    return;
  }

  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = String(lineRaw || "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = String(m[2] || "");

    // Strip inline comments: KEY=value # comment
    // Only when value is not quoted.
    const vTrim = value.trim();
    const isQuoted =
      (vTrim.startsWith('"') && vTrim.endsWith('"')) ||
      (vTrim.startsWith("'") && vTrim.endsWith("'"));
    if (!isQuoted) {
      const hashIdx = value.indexOf(" #");
      if (hashIdx >= 0) value = value.slice(0, hashIdx);
    }

    value = value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Local dev convenience: load .env (without overriding real env vars).
loadDotEnv(path.resolve(STATIC_ROOT, ".env"));

const SERVER_STARTED_AT = new Date().toISOString();

const PORT = (() => {
  const n = Number.parseInt(process.env.PORT || "8080", 10);
  return Number.isFinite(n) ? n : 8080;
})();

const LICZNIK_BASE_URL = String(
  process.env.LICZNIK_BASE_URL ||
    "http://licznik-794170040235.europe-central2.run.app"
).replace(/\/+$/, "");

// NOTE: This key is used only server-side (proxy to LICZNIK). It is never sent to clients.
// Keep it out of the frontend and OUT OF GIT (use Cloud Run env or local `.env`).
const LICZNIK_API_KEY = String(process.env.LICZNIK_API_KEY || process.env.API_KEY || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || "");
const ADMIN_JWT_ISSUER = "staszek-backend";
const ADMIN_JWT_AUDIENCE = "staszek-admin";
const ADMIN_TOKEN_TTL_DAYS = (() => {
  const raw = String(process.env.ADMIN_TOKEN_TTL_DAYS || "").trim();
  if (!raw) return 7;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.max(1, Math.min(30, n));
})();

const TOGETHER_API_KEY = String(process.env.TOGETHER_API_KEY || "").trim();
const TOGETHER_MODEL = String(
  process.env.TOGETHER_MODEL || "Qwen/Qwen2.5-7B-Instruct-Turbo"
).trim();
const TOGETHER_BASE_URL = String(process.env.TOGETHER_BASE_URL || "https://api.together.ai")
  .trim()
  .replace(/\/+$/, "");

const MIN_PUBLIC_VOTE_COUNT = 20;

// Only one admin session at a time (per backend instance).
// When a new login happens, previous tokens become invalid automatically.
let adminSessionId = crypto.randomBytes(18).toString("base64url");
function rotateAdminSession() {
  adminSessionId = crypto.randomBytes(18).toString("base64url");
  return adminSessionId;
}

const CORS_ORIGINS = (() => {
  const raw = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
})();

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecodeToBuffer(s) {
  const raw = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (raw.length % 4)) % 4;
  const padded = raw + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function jwtSign(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64urlEncode(JSON.stringify(header));
  const p = base64urlEncode(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64urlEncode(sig)}`;
}

function jwtVerify(token, secret) {
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const data = `${h}.${p}`;
  const expected = base64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(base64urlDecodeToBuffer(p).toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    const exp = Number(payload.exp) || 0;
    if (exp && Date.now() / 1000 > exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyAdminPassword(password) {
  if (!ADMIN_PASSWORD) return false;
  return timingSafeEqualStr(String(password || ""), ADMIN_PASSWORD);
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, data, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function text(res, status, body, extraHeaders = {}) {
  const buf = Buffer.from(String(body ?? ""), "utf8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(buf);
}

function resolveCorsOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return "";
  if (!CORS_ORIGINS.length) return "";
  if (CORS_ORIGINS.includes(origin)) return origin;
  return "";
}

function isHttps(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase();
  return proto === "https";
}

function securityHeaders(req) {
  const headers = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-site",
  };

  if (isHttps(req)) {
    headers["strict-transport-security"] = "max-age=15552000; includeSubDomains";
  }
  return headers;
}

function corsHeaders(req) {
  const allowOrigin = resolveCorsOrigin(req);
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "600",
    ...securityHeaders(req),
  };
  if (allowOrigin) {
    headers["access-control-allow-origin"] = allowOrigin;
    headers.vary = "Origin";
  }
  return headers;
}

function isOriginAllowed(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  if (!CORS_ORIGINS.length) return true;
  return CORS_ORIGINS.includes(origin);
}

function bearerToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return m ? m[1] : "";
}

function isAdmin(req) {
  const token = bearerToken(req);
  if (!token) return false;
  if (!ADMIN_TOKEN_SECRET || String(ADMIN_TOKEN_SECRET).length < 24) return false;
  const payload = jwtVerify(token, ADMIN_TOKEN_SECRET);
  if (!payload) return false;
  if (payload.sub !== "admin") return false;
  if (payload.iss !== ADMIN_JWT_ISSUER) return false;
  if (payload.aud !== ADMIN_JWT_AUDIENCE) return false;
  if (!payload.sid || String(payload.sid) !== String(adminSessionId)) return false;
  return true;
}

function isValidName(name) {
  const s = String(name || "");
  if (!s || s.length > 128) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,127}$/.test(s);
}

function decodePathSegment(seg) {
  try {
    return decodeURIComponent(String(seg || ""));
  } catch {
    return "";
  }
}

function isAllowedCounterName(name) {
  if (!isValidName(name)) return false;
  return (
    name.startsWith("staszek-") ||
    name.startsWith("like-") ||
    name.startsWith("like_") ||
    name.startsWith("forum-")
  );
}

function isAllowedPublicCounterName(name) {
  if (!isValidName(name)) return false;
  if (
    name === "staszek-views" ||
    name === "staszek-visitors" ||
    name === "staszek-vote"
  ) {
    return true;
  }
  if (
    name.startsWith("like-news-") ||
    name.startsWith("like-program-") ||
    name.startsWith("like-poster-")
  ) {
    return true;
  }
  return false;
}

function isAllowedForumThreadKey(key) {
  if (!isValidName(key)) return false;
  if (key === "staszek-forum") return true;
  return (
    key.startsWith("staszek-news-") ||
    key.startsWith("staszek-program-") ||
    key.startsWith("staszek-poster-")
  );
}

function isAllowedBasicDbKey(key) {
  if (!isValidName(key)) return false;
  return key.startsWith("staszek-") || key.startsWith("pv-");
}

function isProtectedBasicDbReadKey(key) {
  const k = String(key || "");
  return k.startsWith("pv-");
}

function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real;
  const remote = String(req.socket?.remoteAddress || "").trim();
  return remote;
}

function normalizeIp(ip) {
  const s = String(ip || "").trim();
  if (!s) return "";
  if (s.startsWith("::ffff:")) return s.slice("::ffff:".length);
  // Strip port for IPv4: 1.2.3.4:12345
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (m) return m[1];
  return s;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

function forumIpCounterName(threadKey, ip) {
  const threadHash = sha256Hex(String(threadKey || "")).slice(0, 12);
  const secret = ADMIN_TOKEN_SECRET || LICZNIK_API_KEY;
  const ipHash = sha256Hex(`${secret}|${String(ip || "")}`).slice(0, 16);
  return `forum-ip-${threadHash}-${ipHash}`; // <= 128 chars
}

function forumUniqueCounterName(threadKey) {
  const threadHash = sha256Hex(String(threadKey || "")).slice(0, 12);
  return `forum-unique-${threadHash}`;
}

function moderationIpHash(ip) {
  const secret = ADMIN_TOKEN_SECRET || LICZNIK_API_KEY;
  return sha256Hex(`${secret}|${String(ip || "")}`).slice(0, 16);
}

function moderationBanCounterName(ipHash) {
  return `forum-ban-${String(ipHash || "")}`;
}

function moderationCountCounterName(ipHash) {
  return `forum-mod-count-${String(ipHash || "")}`;
}

function moderationSumCounterName(ipHash) {
  return `forum-mod-sum-${String(ipHash || "")}`;
}

function shouldBanByAverage(count, avg) {
  const c = Number(count) || 0;
  const a = Number(avg);
  if (!Number.isFinite(a) || c <= 0) return false;

  // Ban rules (progressive):
  // - >= 3 comments and avg <= 2
  // - >= 5 comments and avg < 4
  // - >= 10 comments and avg < 5
  if (c >= 10 && a < 5) return true;
  if (c >= 5 && a < 4) return true;
  if (c >= 3 && a <= 2) return true;
  return false;
}

// Only publish comments with score >= this value.
// (Lower scores are treated as low-quality / abusive / spam and are rejected.)
const COMMENT_MIN_PUBLISH_SCORE = 5;
const TOGETHER_TIMEOUT_MS = 9000;

function tryParseJsonObject(s) {
  try {
    const parsed = JSON.parse(String(s || ""));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return null;
}

function extractCommentFields(rawElement) {
  const raw = String(rawElement || "").trim();
  const obj = tryParseJsonObject(raw);
  if (obj) {
    const name = String(obj.n ?? obj.name ?? "").trim();
    const msg = String(obj.m ?? obj.message ?? "").trim();
    const time = Number(obj.t ?? obj.time ?? 0) || 0;
    if (msg) return { name, msg, time, obj };
  }
  return { name: "", msg: raw, time: 0, obj: null };
}

function normalizeForNameCheck(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  try {
    return s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  } catch {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
}

function isAdminImpersonationName(name) {
  const n = normalizeForNameCheck(name);
  if (!n) return false;
  // Block obvious "admin..." nicknames for non-admin users (case-insensitive, with extra chars/spaces).
  return n.startsWith("admin");
}

function buildTogetherModerationSystemPrompt() {
  return `Jesteś moderatorem komentarzy (forum kampanii szkolnej).

Zasada odpowiedzi:
- Zwracasz DOKŁADNIE JEDEN ZNAK: cyfrę 0-9.
- NIE dodawaj niczego poza tą cyfrą (żadnych słów, spacji, kropek, nawiasów, myślników, list, nowych linii).
- NIE wypisuj skali ani zakresów typu "0-9".

Zasada oceny:
- To są WYTYCZNE / przykłady. Użyj osądu.
- Jeśli komentarz pasuje do kilku kategorii → wybierz NAJNIŻSZĄ (najbardziej restrykcyjną) ocenę.
- Jeśli widzisz kilka niezależnych negatywnych sygnałów naraz (np. hejt + spam) → możesz zaniżyć ocenę jeszcze bardziej.

Skala:
0 = BARDZO ZŁY: groźby, nienawiść, doxxing, skrajny hejt / wulgaryzmy (najgorsze przypadki)
1 = obraźliwy/hejt/wulgaryzmy/nękanie LUB promowanie innego kandydata niż Stanisław (np. "głosuj na X", "X lepszy", anty-Stanisław)
2 = spam / flood / reklama / link-spam / powtarzalność / podszywanie się (rażąca niespójność nick/tytuł vs treść, udawanie osoby/instytucji)
3 = trolling / ośmieszanie / złośliwe, niekonstruktywne teksty
4 = mała wartość, ale pozytywne (np. głupie prośby/pytania bez złych intencji)
5 = pozytywne (np. krótkie okrzyki/rymowanki albo prośby/ogłoszenia na plus dla Stanisława)
6 = konstruktywne pytania (konkretne, merytoryczne)
7 = konstruktywne ogłoszenia/prośby (konkret, do zrobienia, merytoryczne)
8 = sensowne wsparcie / deklaracja poparcia (bez trollingu)
9 = WYJĄTKOWO DOBRE: bardzo wartościowy, merytoryczny, konkretny komentarz (mega konstruktywny)

Ważne:
- Pole name może być nickiem ALBO tytułem (np. "Senator", "Dyrekcja", "Komisja"). To może być poprawne.
- Podszywanie (2) tylko jeśli są mocne przesłanki w treści lub rażąca niespójność.
- Jeśli komentarz jest OK i ma sens → dawaj 5-8 (bo 0-4 będzie odrzucone).
- Jeśli nie jesteś pewien → wybierz ostrożnie niższą ocenę.
`;
}

async function togetherModerate({ threadKey, name, msg, isAdmin }) {
  // Admin bypasses LLM (still gets published). Score is informational only.
  if (isAdmin) return { ok: true, score: 8 };
  if (!TOGETHER_API_KEY) return { ok: false, error: "missing_together_api_key" };

  const payload = {
    model: TOGETHER_MODEL,
    messages: [
      { role: "system", content: buildTogetherModerationSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify(
          {
            thread_key: String(threadKey || ""),
            name: String(name || ""),
            message: String(msg || ""),
          },
          null,
          0
        ),
      },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 2,
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TOGETHER_TIMEOUT_MS);
  let r;
  let text = "";
  try {
    r = await fetch(`${TOGETHER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOGETHER_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    text = await r.text().catch(() => "");
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: "together_unreachable" };
  } finally {
    clearTimeout(t);
  }

  if (!r) return { ok: false, error: "together_error" };
  if (!r.ok) return { ok: false, error: "together_error", status: r.status };
  const json = tryParseJsonObject(text) || {};
  const content =
    String(json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || "").trim();
  const m = content.match(/^\s*([0-9])\s*$/);
  const score = m ? Number.parseInt(m[1], 10) : 0;
  if (!Number.isFinite(score) || score < 0 || score > 9) return { ok: true, score: 0 };
  return { ok: true, score };
}

const REQUEST_RATE_LIMIT_RULES = [
  { key: "sec", windowMs: 1000, limit: 2 },
  { key: "min", windowMs: 60 * 1000, limit: 60 },
  { key: "hour", windowMs: 60 * 60 * 1000, limit: 600 },
  { key: "day", windowMs: 24 * 60 * 60 * 1000, limit: 1000 },
];

const COMMENT_RATE_LIMIT_RULES = [
  { key: "tenSec", windowMs: 10 * 1000, limit: 2 },
  { key: "hour", windowMs: 60 * 60 * 1000, limit: 10 },
  { key: "day", windowMs: 24 * 60 * 60 * 1000, limit: 15 },
];

const rateLimitRequestsByIp = new Map();
const rateLimitCommentsByIp = new Map();
const adminLoginFailuresByIp = new Map();
let rateLimitSweepTick = 0;

function ensureLimiterRec(map, ip, rules, now) {
  let rec = map.get(ip);
  if (rec) return rec;
  rec = { last: now };
  for (const r of rules) rec[r.key] = { start: now, count: 0 };
  map.set(ip, rec);
  return rec;
}

function sweepLimiterMap(map, ttlMs, now) {
  for (const [ip, rec] of map) {
    const last = Number(rec?.last) || 0;
    if (!last || now - last > ttlMs) map.delete(ip);
  }
}

const ADMIN_LOGIN_LOCKOUT_AFTER = 5;
const ADMIN_LOGIN_LOCKOUT_MAX_SEC = 6 * 60 * 60;

function adminLoginRetryAfter(ip) {
  const cleanIp = String(ip || "").trim();
  if (!cleanIp) return 0;
  const now = Date.now();
  const rec = adminLoginFailuresByIp.get(cleanIp);
  if (!rec) return 0;
  const until = Number(rec.blockedUntil) || 0;
  if (!until || now >= until) return 0;
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function adminLoginRegisterFailure(ip) {
  const cleanIp = String(ip || "").trim();
  if (!cleanIp) return 0;
  const now = Date.now();
  const rec = adminLoginFailuresByIp.get(cleanIp) || {
    last: now,
    fails: 0,
    blockedUntil: 0,
  };
  rec.last = now;
  rec.fails = (Number(rec.fails) || 0) + 1;

  if (rec.fails >= ADMIN_LOGIN_LOCKOUT_AFTER) {
    const pow = Math.max(0, rec.fails - ADMIN_LOGIN_LOCKOUT_AFTER);
    const sec = Math.min(ADMIN_LOGIN_LOCKOUT_MAX_SEC, 60 * Math.pow(2, pow));
    rec.blockedUntil = now + sec * 1000;
    adminLoginFailuresByIp.set(cleanIp, rec);
    return Math.max(1, Math.ceil(sec));
  }

  adminLoginFailuresByIp.set(cleanIp, rec);
  return 0;
}

function adminLoginReset(ip) {
  const cleanIp = String(ip || "").trim();
  if (!cleanIp) return;
  adminLoginFailuresByIp.delete(cleanIp);
}

function hitRateLimit(map, ip, rules) {
  const now = Date.now();
  const cleanIp = String(ip || "").trim();
  if (!cleanIp) return { ok: true, retryAfter: 0 };

  const rec = ensureLimiterRec(map, cleanIp, rules, now);
  rec.last = now;

  for (const r of rules) {
    const w = rec[r.key] || (rec[r.key] = { start: now, count: 0 });
    if (now - w.start >= r.windowMs) {
      w.start = now;
      w.count = 0;
    }
    w.count += 1;
    if (w.count > r.limit) {
      const retryAfterMs = w.start + r.windowMs - now;
      const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return { ok: false, retryAfter, rule: r };
    }
  }

  rateLimitSweepTick += 1;
  if (rateLimitSweepTick % 500 === 0) {
    const ttl = 2 * 24 * 60 * 60 * 1000;
    sweepLimiterMap(rateLimitRequestsByIp, ttl, now);
    sweepLimiterMap(rateLimitCommentsByIp, ttl, now);
    sweepLimiterMap(adminLoginFailuresByIp, ttl, now);
  }

  return { ok: true, retryAfter: 0 };
}

function sendRateLimited(req, res, scope, retryAfter) {
  json(
    res,
    429,
    { error: "rate_limited", scope, retry_after: Number(retryAfter) || 1 },
    { ...corsHeaders(req), "retry-after": String(Number(retryAfter) || 1) }
  );
}

async function licznikFetchText(apiPath) {
  const targetUrl = new URL(String(apiPath || ""), LICZNIK_BASE_URL);
  if (LICZNIK_API_KEY) targetUrl.searchParams.set("key", LICZNIK_API_KEY);
  const r = await fetch(targetUrl.toString(), {
    method: "GET",
    headers: { "x-api-key": LICZNIK_API_KEY },
  });
  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text };
}

function parseIntOrNull(text) {
  const n = Number.parseInt(String(text || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function wantsJsonResponse(req, url) {
  const search = String(url?.search || "");
  if (/(?:^|[?&])format=json(?:&|$)/i.test(search)) return true;
  const accept = String(req.headers.accept || "").toLowerCase();
  return accept.includes("application/json");
}

function stripKeyQuery(urlSearch) {
  const s = String(urlSearch || "");
  if (!s) return "";
  try {
    const u = new URL(`http://x${s.startsWith("?") ? s : `?${s}`}`);
    u.searchParams.delete("key");
    const out = u.search;
    return out === "?" ? "" : out;
  } catch {
    // Best effort: remove "&key=..." or "?key=..."
    return s
      .replace(/([?&])key=[^&]*&?/gi, "$1")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

async function licznikGetInt(counterName) {
  try {
    const r = await licznikFetchText(`/ile/${encodeURIComponent(String(counterName || ""))}`);
    if (!r.ok) return null;
    return parseIntOrNull(r.text);
  } catch {
    return null;
  }
}

async function licznikAddInt(counterName, delta) {
  const d = Number.parseInt(String(delta ?? 0), 10);
  if (!Number.isFinite(d)) return null;
  try {
    const r = await licznikFetchText(
      `/dodaj/${encodeURIComponent(String(counterName || ""))}/${d}`
    );
    if (!r.ok) return null;
    return parseIntOrNull(r.text);
  } catch {
    return null;
  }
}

async function isIpBanned(ip) {
  const clean = String(ip || "").trim();
  if (!clean) return false;
  const ipHash = moderationIpHash(clean);
  const banName = moderationBanCounterName(ipHash);
  const cur = await licznikGetInt(banName);
  return typeof cur === "number" && cur >= 1;
}

async function updateIpStatsAndMaybeBan(ip, score) {
  const clean = String(ip || "").trim();
  if (!clean) return { ok: false, banned: false, count: 0, avg: 0 };

  const ipHash = moderationIpHash(clean);
  const countName = moderationCountCounterName(ipHash);
  const sumName = moderationSumCounterName(ipHash);
  const banName = moderationBanCounterName(ipHash);

  const s = Math.max(0, Math.min(9, Number(score) || 0));
  const newCount = await licznikAddInt(countName, 1);
  const newSum = await licznikAddInt(sumName, s);
  const count = typeof newCount === "number" ? newCount : (await licznikGetInt(countName)) || 0;
  const sum = typeof newSum === "number" ? newSum : (await licznikGetInt(sumName)) || 0;
  const avg = count > 0 ? sum / count : 0;

  let banned = false;
  if (shouldBanByAverage(count, avg)) {
    const curBan = await licznikGetInt(banName);
    if (!(typeof curBan === "number" && curBan >= 1)) {
      await licznikAddInt(banName, 1);
    }
    banned = true;
  }

  return { ok: true, banned, count, avg };
}

async function markForumIpSeen(req, threadKey) {
  try {
    const ip = normalizeIp(clientIp(req));
    if (!ip) return;
    const ipCounter = forumIpCounterName(threadKey, ip);
    const uniqueCounter = forumUniqueCounterName(threadKey);

    const cur = await licznikFetchText(`/ile/${encodeURIComponent(ipCounter)}`);
    const n = Number.parseInt(String(cur.text || "").trim(), 10);
    if (Number.isFinite(n) && n >= 1) return;

    await licznikFetchText(`/dodaj/${encodeURIComponent(ipCounter)}/1`);
    await licznikFetchText(`/dodaj/${encodeURIComponent(uniqueCounter)}/1`);
  } catch {}
}

async function proxyToLicznik(req, res, apiPath, urlSearch) {
  if (!LICZNIK_API_KEY) {
    json(
      res,
      500,
      { error: "missing_api_key" },
      { ...corsHeaders(req), "x-hint": "Set LICZNIK_API_KEY (or API_KEY) in backend env." }
    );
    return;
  }

  const cleanedSearch = stripKeyQuery(urlSearch || "");
  const targetUrl = new URL(`${apiPath}${cleanedSearch}`, LICZNIK_BASE_URL);
  targetUrl.searchParams.set("key", LICZNIK_API_KEY);

  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await readBody(req, 64 * 1024);
    } catch {
      json(res, 413, { error: "payload_too_large" }, corsHeaders(req));
      return;
    }
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: {
        "x-api-key": LICZNIK_API_KEY,
        ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}),
      },
      body: body && body.length ? body : undefined,
    });
  } catch (e) {
    error("Proxy error:", e);
    json(res, 502, { error: "upstream_unreachable" }, corsHeaders(req));
    return;
  }

  const headers = corsHeaders(req);
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  headers["cache-control"] = "no-store";

  res.writeHead(upstream.status, headers);
  if (req.method === "HEAD") return res.end();
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
}

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function safeResolveStaticPath(urlPath) {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {}
  const abs = path.resolve(STATIC_ROOT, `.${decoded}`);
  const rootWithSep = STATIC_ROOT.endsWith(path.sep) ? STATIC_ROOT : STATIC_ROOT + path.sep;
  if (abs !== STATIC_ROOT && !abs.startsWith(rootWithSep)) return "";
  return abs;
}

async function tryServeFile(req, res, filePath, stat) {
  const headers = {
    ...securityHeaders(req),
    "content-type": contentTypeForFile(filePath),
  };

  // Cache:
  // - HTML/JS/CSS should always be fresh (this is a frequently updated static SPA).
  // - Media/assets can be cached.
  const ext = path.extname(filePath).toLowerCase();

  // Add CSP for HTML to reduce risk of XSS (which could leak admin token).
  if (ext === ".html") {
    const rel = filePath.startsWith(STATIC_ROOT) ? filePath.slice(STATIC_ROOT.length) : filePath;
    const relUnix = rel.split(path.sep).join("/");
    const isShare = relUnix.startsWith("/share/");

    const base = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "media-src 'self' data:",
      "font-src 'self'",
    ];

    if (isShare) {
      // Share pages contain inline <style> and a tiny inline redirect <script>.
      headers["content-security-policy"] = [
        ...base,
        "form-action 'none'",
        "connect-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
      ].join("; ");
    } else {
      headers["content-security-policy"] = [
        ...base,
        "form-action 'self'",
        "connect-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
      ].join("; ");
    }
  }

  const noStoreExt = new Set([".html", ".js", ".css", ".json"]);
  if (noStoreExt.has(ext)) headers["cache-control"] = "no-store";
  else headers["cache-control"] = "public, max-age=86400";

  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    res.writeHead(500, {
      ...securityHeaders(req),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("error");
  });
  stream.pipe(res);
}

async function serveStatic(req, res, urlPath) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, {
      ...securityHeaders(req),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("method not allowed");
    return;
  }

  const rawPath = urlPath || "/";
  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {}
  const normalizedDecodedPath = normalizePublicPath(decodedPath);

  const segs = rawPath.split("/").filter(Boolean);
  const decodedSegs = String(decodedPath || "")
    .split("/")
    .filter(Boolean);

  // Never serve dotfiles or backend/source files.
  // (Also prevents leaking .env if present on disk.)
  const blockedTop = new Set(["server", "scripts"]);
  if (
    segs.some((s) => s.startsWith(".") && s !== ".well-known") ||
    decodedSegs.some((s) => s.startsWith(".") && s !== ".well-known") ||
    (decodedSegs[0] && blockedTop.has(decodedSegs[0])) ||
    rawPath === "/Dockerfile" ||
    decodedPath === "/Dockerfile" ||
    rawPath === "/README.md" ||
    decodedPath === "/README.md" ||
    rawPath === "/nginx.conf" ||
    decodedPath === "/nginx.conf" ||
    rawPath === "/CNAME" ||
    decodedPath === "/CNAME" ||
    rawPath === "/.gitignore" ||
    decodedPath === "/.gitignore" ||
    rawPath === "/.dockerignore" ||
    decodedPath === "/.dockerignore" ||
    rawPath === "/deploy.sh" ||
    decodedPath === "/deploy.sh" ||
    rawPath === "/gh.sh" ||
    decodedPath === "/gh.sh" ||
    rawPath === "/.env" ||
    decodedPath === "/.env" ||
    rawPath.startsWith("/.env.") ||
    String(decodedPath || "").startsWith("/.env.")
  ) {
    res.writeHead(404, {
      ...securityHeaders(req),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("not found");
    return;
  }

  // Serve sanitized public content.js (block comments stripped) to avoid leaking hidden content.
  if (normalizedDecodedPath === "/data/content.js" && typeof PUBLIC_CONTENT_JS_STRIPPED === "string") {
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    res.end(PUBLIC_CONTENT_JS_STRIPPED);
    return;
  }

  // Only expose the public content entry from /data. Anything else there is treated as private.
  if (normalizedDecodedPath.startsWith("/data/") && normalizedDecodedPath !== "/data/content.js") {
    res.writeHead(404, {
      ...securityHeaders(req),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("not found");
    return;
  }

  // Media allowlist: if it's not referenced by the current public content/app/index, don't serve it.
  // This prevents viewing "hidden" posters/posts via direct URL guessing.
  if (
    normalizedDecodedPath.startsWith("/zdjęcia/") ||
    normalizedDecodedPath.startsWith("/video/") ||
    normalizedDecodedPath.startsWith("/audio/")
  ) {
    const ok =
      PUBLIC_MEDIA_ALLOWLIST &&
      (PUBLIC_MEDIA_ALLOWLIST.has(normalizedDecodedPath) ||
        (typeof normalizedDecodedPath.normalize === "function" &&
          (PUBLIC_MEDIA_ALLOWLIST.has(normalizedDecodedPath.normalize("NFD")) ||
            PUBLIC_MEDIA_ALLOWLIST.has(normalizedDecodedPath.normalize("NFC")))));
    if (!ok) {
      res.writeHead(404, {
        ...securityHeaders(req),
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("not found");
      return;
    }
  }
  const wantsDirIndex = rawPath.endsWith("/");

  const candidates = [];
  if (wantsDirIndex) {
    candidates.push(`${rawPath}index.html`);
  } else {
    candidates.push(rawPath);
    candidates.push(`${rawPath}/index.html`);
  }
  if (rawPath === "/") candidates.push("/index.html");

  for (const rel of candidates) {
    const abs = safeResolveStaticPath(rel);
    if (!abs) continue;
    try {
      const st = await fs.promises.stat(abs);
      if (st.isDirectory()) {
        const idx = path.join(abs, "index.html");
        const idxSt = await fs.promises.stat(idx);
        if (idxSt.isFile()) return tryServeFile(req, res, idx, idxSt);
      }
      if (st.isFile()) return tryServeFile(req, res, abs, st);
    } catch {}
  }

  // SPA fallback
  const fallback = path.join(STATIC_ROOT, "index.html");
  try {
    const st = await fs.promises.stat(fallback);
    if (st.isFile()) return tryServeFile(req, res, fallback, st);
  } catch {}
  res.writeHead(404, {
    ...securityHeaders(req),
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end("not found");
}

async function handleApi(req, res, url) {
  if (!isOriginAllowed(req)) {
    json(res, 403, { error: "origin_not_allowed" }, corsHeaders(req));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const fullPath = String(url.pathname || "");
  const subPath = fullPath.startsWith(API_PREFIX) ? fullPath.slice(API_PREFIX.length) : fullPath;
  const p = subPath || "/";
  const ip = normalizeIp(clientIp(req));

  if (p === "/healthz") {
    text(res, 200, "ok", corsHeaders(req));
    return;
  }

  if (p === "/deploy" && req.method === "GET") {
    json(
      res,
      200,
      {
        ok: true,
        deployed_at: String(process.env.DEPLOYED_AT || "").trim() || null,
        git_sha: String(process.env.GIT_SHA || "").trim() || null,
        service: String(process.env.K_SERVICE || "").trim() || null,
        revision: String(process.env.K_REVISION || "").trim() || null,
        server_started_at: SERVER_STARTED_AT,
      },
      corsHeaders(req)
    );
    return;
  }

  if (p === "/moderation/active" && req.method === "GET") {
    json(
      res,
      200,
      {
        ok: true,
        configured: Boolean(TOGETHER_API_KEY),
        model: TOGETHER_MODEL,
        base_url: TOGETHER_BASE_URL,
      },
      corsHeaders(req)
    );
    return;
  }

  if (p === "/admin/logout" && req.method === "POST") {
    if (!isAdmin(req)) {
      json(res, 401, { ok: false }, corsHeaders(req));
      return;
    }
    rotateAdminSession();
    json(res, 200, { ok: true }, corsHeaders(req));
    return;
  }

  if (p === "/admin/me" && req.method === "GET") {
    const ok = isAdmin(req);
    if (!ok) {
      json(res, 401, { ok: false }, corsHeaders(req));
      return;
    }
    json(res, 200, { ok: true }, corsHeaders(req));
    return;
  }

  if (p === "/admin/login" && req.method === "POST") {
    const blocked = adminLoginRetryAfter(ip);
    if (blocked) {
      json(
        res,
        429,
        { error: "admin_locked", retry_after: blocked },
        { ...corsHeaders(req), "retry-after": String(blocked) }
      );
      return;
    }

    const rl = hitRateLimit(rateLimitRequestsByIp, ip, REQUEST_RATE_LIMIT_RULES);
    if (!rl.ok) {
      sendRateLimited(req, res, "requests", rl.retryAfter);
      return;
    }

    if (!ADMIN_PASSWORD || !ADMIN_TOKEN_SECRET) {
      json(
        res,
        500,
        { error: "admin_not_configured" },
        {
          ...corsHeaders(req),
          "x-hint": "Set ADMIN_PASSWORD and ADMIN_TOKEN_SECRET in backend env.",
        }
      );
      return;
    }

    const ct = String(req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      json(res, 415, { error: "unsupported_media_type" }, corsHeaders(req));
      return;
    }

    let body;
    try {
      body = await readBody(req, 16 * 1024);
    } catch {
      json(res, 413, { error: "payload_too_large" }, corsHeaders(req));
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      json(res, 400, { error: "invalid_json" }, corsHeaders(req));
      return;
    }

    const password = String(parsed?.password || "");
    const ok = verifyAdminPassword(password);
    if (!ok) {
      const after = adminLoginRegisterFailure(ip);
      if (after) {
        json(
          res,
          429,
          { error: "admin_locked", retry_after: after },
          { ...corsHeaders(req), "retry-after": String(after) }
        );
        return;
      }
      json(res, 401, { error: "invalid_password" }, corsHeaders(req));
      return;
    }

    adminLoginReset(ip);

    const sid = rotateAdminSession();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ADMIN_TOKEN_TTL_DAYS * 24 * 3600;
    const token = jwtSign(
      { sub: "admin", sid, iss: ADMIN_JWT_ISSUER, aud: ADMIN_JWT_AUDIENCE, iat: now, exp },
      ADMIN_TOKEN_SECRET
    );
    json(res, 200, { token }, corsHeaders(req));
    return;
  }

  // Proxy allowlist
  const parts = p.split("/").filter(Boolean);
  const top = parts[0] || "";

  if (top === "ile" && req.method === "GET" && parts.length === 2) {
    const counter = decodePathSegment(parts[1]);
    if (!isAllowedCounterName(counter)) {
      json(res, 400, { error: "invalid_counter" }, corsHeaders(req));
      return;
    }

    const admin = isAdmin(req);
    if (!admin && !isAllowedPublicCounterName(counter)) {
      // Hide non-public counters from the outside world (prevents viewing hidden/internal data).
      res.writeHead(404, {
        ...corsHeaders(req),
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("not found");
      return;
    }

    // If declarations are hidden in UI (< MIN_PUBLIC_VOTE_COUNT), hide them also on the API.
    if (!admin && counter === "staszek-vote") {
      const n = await licznikGetInt(counter);
      if (typeof n === "number" && n < MIN_PUBLIC_VOTE_COUNT) {
        res.writeHead(404, {
          ...corsHeaders(req),
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end("hidden");
        return;
      }
    }

    // Default (text/plain) responses should never be negative.
    // If counters got tampered with in the past, auto-heal by resetting negatives back to 0.
    const wantsJson = wantsJsonResponse(req, url);
    if (!wantsJson) {
      if (!LICZNIK_API_KEY) {
        json(
          res,
          500,
          { error: "missing_api_key" },
          { ...corsHeaders(req), "x-hint": "Set LICZNIK_API_KEY (or API_KEY) in backend env." }
        );
        return;
      }

      const qs = stripKeyQuery(url.search || "");
      const up = await licznikFetchText(`/ile/${encodeURIComponent(String(counter))}${qs}`);
      if (!up.ok) {
        res.writeHead(up.status || 502, {
          ...corsHeaders(req),
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(String(up.text || ""));
        return;
      }

      const n = parseIntOrNull(up.text);
      if (typeof n === "number" && n < 0) {
        // Auto-heal invalid negative counters.
        try {
          await licznikFetchText(`/wyzeruj/${encodeURIComponent(String(counter))}`);
        } catch {}
        text(res, 200, "0", corsHeaders(req));
        return;
      }

      text(res, 200, String(Math.max(0, n ?? 0)), corsHeaders(req));
      return;
    }

    await proxyToLicznik(req, res, p, stripKeyQuery(url.search || ""));
    return;
  }

  if (top === "wyzeruj" && req.method === "GET" && parts.length === 2) {
    const rl = hitRateLimit(rateLimitRequestsByIp, ip, REQUEST_RATE_LIMIT_RULES);
    if (!rl.ok) {
      sendRateLimited(req, res, "requests", rl.retryAfter);
      return;
    }
    if (!isAdmin(req)) {
      json(res, 401, { error: "admin_required" }, corsHeaders(req));
      return;
    }

    const name = decodePathSegment(parts[1]);
    if (!(isAllowedCounterName(name) || isAllowedBasicDbKey(name))) {
      json(res, 400, { error: "invalid_name" }, corsHeaders(req));
      return;
    }
    await proxyToLicznik(req, res, p, url.search || "");
    return;
  }

  if (top === "dodaj" && req.method === "GET" && (parts.length === 2 || parts.length === 3)) {
    const rl = hitRateLimit(rateLimitRequestsByIp, ip, REQUEST_RATE_LIMIT_RULES);
    if (!rl.ok) {
      sendRateLimited(req, res, "requests", rl.retryAfter);
      return;
    }

    const counter = decodePathSegment(parts[1]);
    if (!isAllowedCounterName(counter)) {
      json(res, 400, { error: "invalid_counter" }, corsHeaders(req));
      return;
    }

    const admin = isAdmin(req);

    const deltaRaw = parts.length === 3 ? decodePathSegment(parts[2]) : "1";
    if (!/^-?\d{1,8}$/.test(deltaRaw)) {
      json(res, 400, { error: "invalid_delta" }, corsHeaders(req));
      return;
    }
    const delta = Number.parseInt(deltaRaw, 10);
    if (!Number.isFinite(delta)) {
      json(res, 400, { error: "invalid_delta" }, corsHeaders(req));
      return;
    }
    if (delta < 0) {
      // Never allow negative deltas via the public-facing proxy.
      // If you need to "correct" counters, use /wyzeruj (admin-only) then add the right value.
      json(res, 400, { error: "invalid_delta" }, corsHeaders(req));
      return;
    }

    if (!admin) {
      if (delta !== 1) {
        // Public increments are +1 only. Anything else is treated as admin-only to prevent tampering.
        json(res, 403, { error: "admin_required" }, corsHeaders(req));
        return;
      }
      if (!isAllowedPublicCounterName(counter)) {
        json(res, 403, { error: "admin_required" }, corsHeaders(req));
        return;
      }
    } else {
      // Safety belt for admin: cap delta to avoid accidental huge changes.
      if (delta > 1_000_000) {
        json(res, 400, { error: "delta_too_large" }, corsHeaders(req));
        return;
      }
    }

    // Default (text/plain) responses should never be negative.
    // If counters were tampered with and went negative, auto-heal by resetting to 0 then applying delta.
    const wantsJson = wantsJsonResponse(req, url);
    const qs = stripKeyQuery(url.search || "");
    const hasPixel = /(?:^|[?&])pixel=1(?:&|$)/i.test(String(qs || ""));
    if (!wantsJson && !hasPixel) {
      if (!LICZNIK_API_KEY) {
        json(
          res,
          500,
          { error: "missing_api_key" },
          { ...corsHeaders(req), "x-hint": "Set LICZNIK_API_KEY (or API_KEY) in backend env." }
        );
        return;
      }

      const up = await licznikFetchText(
        `/dodaj/${encodeURIComponent(String(counter || ""))}/${delta}${qs}`
      );
      if (!up.ok) {
        res.writeHead(up.status || 502, {
          ...corsHeaders(req),
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(String(up.text || ""));
        return;
      }

      const n = parseIntOrNull(up.text);
      if (typeof n === "number" && n < 0) {
        try {
          await licznikFetchText(`/wyzeruj/${encodeURIComponent(String(counter || ""))}`);
        } catch {}
        const up2 = await licznikFetchText(
          `/dodaj/${encodeURIComponent(String(counter || ""))}/${delta}${qs}`
        );
        const n2 = up2.ok ? parseIntOrNull(up2.text) : null;
        text(res, 200, String(Math.max(0, n2 ?? 0)), corsHeaders(req));
        return;
      }

      text(res, 200, String(Math.max(0, n ?? 0)), corsHeaders(req));
      return;
    }

    await proxyToLicznik(req, res, p, qs);
    return;
  }

  if (parts[0] === "baza-podstawowa") {
    const op = parts[1] || "";
    if (op === "dodaj" && req.method === "GET" && parts.length >= 4) {
      const key = decodePathSegment(parts[2]);
      if (!isAllowedBasicDbKey(key)) {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (String(key || "").startsWith("staszek-") && !isAllowedForumThreadKey(key)) {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (String(key || "").startsWith("pv-") && key !== "pv-mesege-staszek") {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }

      const rawElement = decodePathSegment(parts.slice(3).join("/"));
      if (!rawElement) {
        json(res, 400, { error: "invalid_element" }, corsHeaders(req));
        return;
      }
      // This endpoint puts the element in the URL path, so keep it small.
      // (Forum uses a hard limit anyway; PV/contact is also limited here.)
      if (rawElement.length > 4000) {
        json(res, 413, { error: "payload_too_large" }, corsHeaders(req));
        return;
      }

      const rl = hitRateLimit(rateLimitRequestsByIp, ip, REQUEST_RATE_LIMIT_RULES);
      if (!rl.ok) {
        sendRateLimited(req, res, "requests", rl.retryAfter);
        return;
      }

      if (String(key || "").startsWith("staszek-")) {
        const cl = hitRateLimit(rateLimitCommentsByIp, ip, COMMENT_RATE_LIMIT_RULES);
        if (!cl.ok) {
          sendRateLimited(req, res, "comments", cl.retryAfter);
          return;
        }
      }

      const isForumWrite = String(key || "").startsWith("staszek-");
      const admin = isAdmin(req);

      if (isForumWrite && !admin) {
        const banned = await isIpBanned(ip);
        if (banned) {
          json(res, 403, { error: "ip_banned" }, corsHeaders(req));
          return;
        }
      }

      // For forum/comments (staszek-* keys), remember "this IP commented" server-side (not only cookies).
      const shouldMarkForumIp = isForumWrite;
      const shouldModerateComment = isForumWrite;

      let writePath = p;
      if (shouldModerateComment) {
        if (rawElement.length > 2200) {
          json(res, 413, { error: "payload_too_large" }, corsHeaders(req));
          return;
        }
        const { name, msg, time, obj } = extractCommentFields(rawElement);
        let score = 0;

        // Anti-impersonation: non-admin users cannot post with admin-like nicknames.
        // Such attempts are auto-scored as "trolling" (3) and rejected (since publish threshold is 5).
        if (!admin && isAdminImpersonationName(name)) {
          score = 3;
        } else {
          const mod = await togetherModerate({
            threadKey: key,
            name,
            msg,
            isAdmin: admin,
          });
          if (!mod.ok) {
            const hint =
              mod.error === "missing_together_api_key"
                ? "Set TOGETHER_API_KEY in backend env."
                : mod.error === "together_unreachable"
                  ? "Together API unreachable from backend."
                  : mod.error === "together_error"
                    ? `Together API error${mod.status ? ` (HTTP ${mod.status})` : ""}.`
                    : "Moderation failed.";
            json(
              res,
              503,
              { error: "moderation_unavailable" },
              { ...corsHeaders(req), "x-hint": hint }
            );
            return;
          }
          score = Number(mod.score) || 0;
        }

        if (!admin) {
          const stats = await updateIpStatsAndMaybeBan(ip, score);
          if (stats?.banned) {
            json(res, 403, { error: "ip_banned" }, corsHeaders(req));
            return;
          }
        }

        if (!admin && score < COMMENT_MIN_PUBLISH_SCORE) {
          json(res, 403, { error: "comment_rejected", score }, corsHeaders(req));
          return;
        }

        let elementToStore = rawElement;
        if (obj && typeof obj === "object") {
          obj.s = score;
          if (!obj.t) obj.t = time || Date.now();
          elementToStore = JSON.stringify(obj);
        } else {
          elementToStore = JSON.stringify({
            t: time || Date.now(),
            n: name || "",
            m: msg || rawElement,
            s: score,
          });
        }

        writePath = `/baza-podstawowa/dodaj/${encodeURIComponent(
          key
        )}/${encodeURIComponent(elementToStore)}`;
      }

      // We proxy manually here so we can mark IP only after a successful write.
      let upstream;
      try {
        const cleanedSearch = stripKeyQuery(url.search || "");
        const targetUrl = new URL(`${writePath}${cleanedSearch}`, LICZNIK_BASE_URL);
        targetUrl.searchParams.set("key", LICZNIK_API_KEY);
        upstream = await fetch(targetUrl.toString(), {
          method: "GET",
          headers: { "x-api-key": LICZNIK_API_KEY },
        });
      } catch (e) {
        error("Proxy error:", e);
        json(res, 502, { error: "upstream_unreachable" }, corsHeaders(req));
        return;
      }

      const headers = corsHeaders(req);
      const contentType = upstream.headers.get("content-type");
      if (contentType) headers["content-type"] = contentType;
      headers["cache-control"] = "no-store";

      res.writeHead(upstream.status, headers);
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);

      if (upstream.ok && shouldMarkForumIp) {
        // Fire-and-forget; do not block the response.
        void markForumIpSeen(req, key);
      }
      return;
    }

    if (op === "odczyt" && req.method === "GET" && parts.length === 3) {
      const key = decodePathSegment(parts[2]);
      if (!isAllowedBasicDbKey(key)) {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (String(key || "").startsWith("staszek-") && !isAllowedForumThreadKey(key)) {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (String(key || "").startsWith("pv-") && key !== "pv-mesege-staszek") {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (isProtectedBasicDbReadKey(key) && !isAdmin(req)) {
        json(res, 401, { error: "admin_required" }, corsHeaders(req));
        return;
      }
      await proxyToLicznik(req, res, p, url.search || "");
      return;
    }

    if (op === "usun" && req.method === "GET" && parts.length >= 4) {
      const key = decodePathSegment(parts[2]);
      if (!isAllowedBasicDbKey(key)) {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (String(key || "").startsWith("staszek-") && !isAllowedForumThreadKey(key)) {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      if (String(key || "").startsWith("pv-") && key !== "pv-mesege-staszek") {
        json(res, 400, { error: "invalid_key" }, corsHeaders(req));
        return;
      }
      const rl = hitRateLimit(rateLimitRequestsByIp, ip, REQUEST_RATE_LIMIT_RULES);
      if (!rl.ok) {
        sendRateLimited(req, res, "requests", rl.retryAfter);
        return;
      }
      if (!isAdmin(req)) {
        json(res, 401, { error: "admin_required" }, corsHeaders(req));
        return;
      }
      await proxyToLicznik(req, res, p, url.search || "");
      return;
    }
  }

  json(res, 404, { error: "not_found" }, corsHeaders(req));
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || "localhost");
  const rawUrl = String(req.url || "/");
  if (rawUrl.length > 8192) {
    res.writeHead(414, {
      ...securityHeaders(req),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("uri too long");
    return;
  }

  const url = new URL(rawUrl, `http://${host}`);

  try {
    if (url.pathname.startsWith(API_PREFIX)) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    error("Unhandled error:", e);
    res.writeHead(500, {
      ...securityHeaders(req),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("internal error");
  }
});

server.listen(PORT, () => {
  log(`Server listening on :${PORT}`);
  log(`Static root: ${STATIC_ROOT}`);
  log(`Licznik base: ${LICZNIK_BASE_URL}`);
  if (!LICZNIK_API_KEY) log("WARN: Missing LICZNIK_API_KEY (or API_KEY). Counters/forum will not work.");
  if (!ADMIN_PASSWORD || !ADMIN_TOKEN_SECRET) {
    log("WARN: Admin not configured (ADMIN_PASSWORD / ADMIN_TOKEN_SECRET). Admin login will be disabled.");
  } else if (String(ADMIN_TOKEN_SECRET).length < 24) {
    log("WARN: ADMIN_TOKEN_SECRET is too short. Use a long random value.");
  }
});
