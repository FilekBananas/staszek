(() => {
  const state = {
    route: "",
    posterIndex: 0,
    stats: {
      views: null,
      visitors: null,
      vote: null,
    },
    ui: {
      statsBoxesActivated: false,
    },
    likes: {
      set: new Set(),
      pending: new Set(),
      counts: new Map(),
    },
    audio: {
      enabled: true,
      unlocked: false,
      started: false,
      src: "",
      el: null,
      suspendedByVideo: false,
    },
    admin: {
      enabled: false,
    },
    filters: {
      aktualnosci: { search: "", tag: "" },
      pomysly: { search: "", tag: "" },
    },
  };
  const AUDIO_FEATURE_ENABLED = true;

  let renderTimer = 0;
  let restoreFocus = null;

  const ROUTES = [
    { id: "start", label: "Start", hash: "#/" },
    { id: "aktualnosci", label: "Aktualności", hash: "#/aktualnosci" },
    { id: "plakaty", label: "Plakaty", hash: "#/plakaty" },
    { id: "pomysly", label: "Pomysły", hash: "#/pomysly" },
    { id: "kontakt", label: "Kontakt", hash: "#/kontakt" },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const COUNTER_HOST = "licznik-794170040235.europe-central2.run.app";
  const COUNTER_BASE = `${location.protocol === "http:" ? "http" : "https"}://${COUNTER_HOST}`;
  const COUNTER_API_KEY = "jDIw(@#wdF2r4";

  const COUNTER_SITE_VIEWS = "staszek-views";
  const COUNTER_SITE_VISITORS = "staszek-visitors";
  const COUNTER_SITE_VOTE = "staszek-vote";
  const COUNTER_SITE_EXONERATE = "staszek-uniewinnic";
  const MIN_PUBLIC_VOTE_COUNT = 20;
  const VIEW_COOLDOWN_MS = 2 * 60 * 1000;
  // Tymczasowo wyłączone: baner + przycisk związany z artykułem o wykluczeniu.
  // Ustaw na `true`, żeby łatwo przywrócić.
  const APPEAL_ARTICLE_FEATURE_ENABLED = false;
  const ADMIN_FEATURE_ENABLED = true;
  const ADMIN_SECRET_SHA256_HEX =
    "7b610aa182ee49fc321ce2e138e3b55365eb3e100fc7260fb079fb2246b54be5";

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function formatNumber(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    try {
      return new Intl.NumberFormat("pl-PL").format(n);
    } catch {
      return String(n);
    }
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  }

  function setAnimatedNumber(el, value) {
    if (!el) return;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      el.dataset.loading = "1";
      if (!el.textContent || el.textContent === "—") el.textContent = "…";
      return;
    }

    el.dataset.loading = "0";
    const prev = Number(el.dataset.current);
    const from = Number.isFinite(prev) ? prev : 0;
    const to = value;
    if (from === to) {
      el.dataset.current = String(to);
      el.textContent = formatNumber(to);
      return;
    }

    el.dataset.current = String(to);
    const start = performance.now();
    const duration = 720;

    const tick = (now) => {
      if (!el.isConnected) return;
      const t = easeOutCubic((now - start) / duration);
      const v = Math.round(from + (to - from) * t);
      el.textContent = formatNumber(v);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    const all = String(document.cookie || "").split(";").map((s) => s.trim());
    for (const part of all) {
      if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
    }
    return "";
  }

  function writeCookie(name, value, days = 365) {
    const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60));
    const v = encodeURIComponent(String(value));
    document.cookie = `${name}=${v}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }

  function hasCookie(name) {
    return readCookie(name) !== "";
  }

  function isAdminEnabled() {
    return ADMIN_FEATURE_ENABLED && state.admin?.enabled === true;
  }

  function setAdminEnabled(enabled) {
    if (!state.admin) state.admin = { enabled: false };
    state.admin.enabled = Boolean(enabled);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(text) {
    try {
      if (!window.crypto?.subtle) return "";
      const data = new TextEncoder().encode(String(text || ""));
      const digest = await window.crypto.subtle.digest("SHA-256", data);
      return bytesToHex(new Uint8Array(digest));
    } catch {
      return "";
    }
  }

  function loadLikeSet() {
    const raw = readCookie("staszek_likes");
    const set = new Set();
    if (!raw) return set;
    for (const part of raw.split(",")) {
      const k = part.trim();
      if (k) set.add(k);
    }
    return set;
  }

  function saveLikeSet(set) {
    try {
      const list = Array.from(set).slice(0, 600);
      writeCookie("staszek_likes", list.join(","), 400);
    } catch {}
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

  function counterUrl(path) {
    const url = `${COUNTER_BASE}${path}`;
    if (!COUNTER_API_KEY) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(COUNTER_API_KEY)}`;
  }

  function parseCounterValue(text) {
    const n = Number.parseInt(String(text || "").trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(String(text || ""));
    } catch {
      return null;
    }
  }

  function getCounter(counterName) {
    const name = encodeURIComponent(String(counterName || ""));
    return fetch(counterUrl(`/ile/${name}`), { cache: "no-store", mode: "cors" })
      .then((r) => r.text())
      .then(parseCounterValue)
      .catch(() => null);
  }

  function addCounter(counterName, delta = 1) {
    const name = encodeURIComponent(String(counterName || ""));
    const parsed = Number.parseInt(String(delta), 10);
    const d = Number.isFinite(parsed) ? parsed : 0;
    return fetch(counterUrl(`/dodaj/${name}/${d}`), {
      cache: "no-store",
      mode: "cors",
      keepalive: true,
    })
      .then((r) => r.text())
      .then(parseCounterValue)
      .catch(() => null);
  }

  function parseBasicDbItems(text) {
    const parsed = safeJsonParse(text);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    if (parsed && typeof parsed === "object") {
      const list =
        parsed.items || parsed.data || parsed.elements || parsed.value || parsed.values;
      if (Array.isArray(list)) return list.map((x) => String(x));
    }
    return String(text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function basicDbAdd(key, element) {
    const k = encodeURIComponent(String(key || ""));
    const e = encodeURIComponent(String(element || ""));
    return fetch(counterUrl(`/baza-podstawowa/dodaj/${k}/${e}`), {
      cache: "no-store",
      mode: "cors",
      keepalive: true,
    })
      .then((r) => (r.ok ? true : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => false);
  }

  function basicDbRead(key) {
    const k = encodeURIComponent(String(key || ""));
    return fetch(counterUrl(`/baza-podstawowa/odczyt/${k}?format=json`), {
      cache: "no-store",
      mode: "cors",
    })
      .then((r) => r.text().then((t) => ({ ok: r.ok, status: r.status, text: t })))
      .then(({ ok, status, text }) => {
        if (!ok) throw new Error(`HTTP ${status}`);
        return parseBasicDbItems(text);
      })
      .catch(() => []);
  }

  function basicDbRemove(key, element) {
    const k = encodeURIComponent(String(key || ""));
    const e = encodeURIComponent(String(element || ""));
    return fetch(counterUrl(`/baza-podstawowa/usun/${k}/${e}`), {
      cache: "no-store",
      mode: "cors",
      keepalive: true,
    })
      .then((r) => (r.ok ? true : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => false);
  }

  function updateStatsUI() {
    const viewsText = formatNumber(state.stats.views);
    const visitorsText = formatNumber(state.stats.visitors);

    const viewsEl = $("#statViews");
    const visitorsEl = $("#statVisitors");
    if (viewsEl) viewsEl.textContent = viewsText;
    if (visitorsEl) visitorsEl.textContent = visitorsText;

    const badgeViews = $("#statViewsBadge");
    const badgeVisitors = $("#statVisitorsBadge");
    if (badgeViews) badgeViews.textContent = `Wyświetlenia: ${viewsText}`;
    if (badgeVisitors) badgeVisitors.textContent = `Osoby: ${visitorsText}`;

    if (!state.ui.statsBoxesActivated) return;

    setAnimatedNumber($("#statViewsBox"), state.stats.views);
    setAnimatedNumber($("#statVisitorsBox"), state.stats.visitors);

    const voteCard = $("#statVoteCard");
    const showVote =
      typeof state.stats.vote === "number" &&
      Number.isFinite(state.stats.vote) &&
      state.stats.vote >= MIN_PUBLIC_VOTE_COUNT;
    if (voteCard) voteCard.hidden = !showVote;
    if (showVote) setAnimatedNumber($("#statVoteBox"), state.stats.vote);
  }

  function setupLazyStatsBoxes(section) {
    if (!section) return;
    if (state.ui.statsBoxesActivated) return;

    if (!("IntersectionObserver" in window)) {
      state.ui.statsBoxesActivated = true;
      updateStatsUI();
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          obs.disconnect();
          state.ui.statsBoxesActivated = true;
          updateStatsUI();
          break;
        }
      },
      { threshold: 0.24, rootMargin: "0px 0px -12% 0px" }
    );
    obs.observe(section);
  }

  function isProbablyBot() {
    const ua = String(navigator.userAgent || "");
    const low = ua.toLowerCase();

    try {
      if (navigator.webdriver) return true;
    } catch {}

    if (low.includes("headlesschrome") || low.includes("lighthouse")) return true;

    const tokens = [
      "bot",
      "crawler",
      "spider",
      "crawl",
      "slurp",
      "duckduckbot",
      "bingbot",
      "yandex",
      "baiduspider",
      "sogou",
      "exabot",
      "facebookexternalhit",
      "facebot",
      "twitterbot",
      "linkedinbot",
      "slackbot",
      "discordbot",
      "telegrambot",
      "whatsapp",
      "pinterest",
      "applebot",
      "gptbot",
      "ccbot",
      "claudebot",
      "bytespider",
      "perplexitybot",
      "semrush",
      "ahrefs",
      "mj12bot",
      "python-requests",
      "okhttp",
      "java/",
    ];
    for (const t of tokens) {
      if (low.includes(t)) return true;
    }
    return false;
  }

  function isPageVisible() {
    if (typeof document.visibilityState === "string") return document.visibilityState === "visible";
    if (typeof document.hidden === "boolean") return !document.hidden;
    return true;
  }

  function hydrateSiteStats() {
    getCounter(COUNTER_SITE_VIEWS).then((v) => {
      if (typeof v === "number") {
        state.stats.views = v;
        updateStatsUI();
      }
    });
    getCounter(COUNTER_SITE_VISITORS).then((v) => {
      if (typeof v === "number") {
        state.stats.visitors = v;
        updateStatsUI();
      }
    });
    getCounter(COUNTER_SITE_VOTE).then((v) => {
      if (typeof v === "number") {
        state.stats.vote = v;
        updateStatsUI();
      }
    });
  }

  let statsInitialized = false;
  function initSiteStats() {
    if (statsInitialized) return;
    statsInitialized = true;

    // Always show current numbers (even if we decide not to count this visit).
    hydrateSiteStats();

    const { id } = parseRoute();
    if (id === "pv") return;
    if (id === "admin") return;
    if (isProbablyBot()) return;

    let counted = false;
    let timer = 0;
    const seenKey = "staszek_seen";

    const onInteract = () => doCount();
    const onVisibility = () => {
      if (isPageVisible()) doCount();
    };

    function cleanup() {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onInteract, { capture: true });
      window.removeEventListener("keydown", onInteract, { capture: true });
      window.removeEventListener("scroll", onInteract, { capture: true });
      window.removeEventListener("touchstart", onInteract, { capture: true });
      if (timer) window.clearTimeout(timer);
      timer = 0;
    }

    function doCount() {
      if (counted) return;
      if (!isPageVisible()) return;
      counted = true;
      cleanup();

      let canCountView = true;
      try {
        if (sessionStorage.getItem("staszek_view_session") === "1") canCountView = false;
      } catch {}
      try {
        const last = Number(localStorage.getItem("staszek_view_last") || "0") || 0;
        if (last && Date.now() - last < VIEW_COOLDOWN_MS) canCountView = false;
      } catch {}

      if (canCountView) {
        try {
          sessionStorage.setItem("staszek_view_session", "1");
        } catch {}
        try {
          localStorage.setItem("staszek_view_last", String(Date.now()));
        } catch {}

        addCounter(COUNTER_SITE_VIEWS, 1).then((v) => {
          if (typeof v === "number") {
            state.stats.views = v;
            updateStatsUI();
          }
        });
      } else {
        getCounter(COUNTER_SITE_VIEWS).then((v) => {
          if (typeof v === "number") {
            state.stats.views = v;
            updateStatsUI();
          }
        });
      }

      if (canCountView) {
        const first = !hasCookie(seenKey);
        if (first) writeCookie(seenKey, "1", 400);
        const pv = first
          ? addCounter(COUNTER_SITE_VISITORS, 1)
          : getCounter(COUNTER_SITE_VISITORS);
        pv.then((v) => {
          if (typeof v === "number") {
            state.stats.visitors = v;
            updateStatsUI();
          }
        });
      } else {
        getCounter(COUNTER_SITE_VISITORS).then((v) => {
          if (typeof v === "number") {
            state.stats.visitors = v;
            updateStatsUI();
          }
        });
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onInteract, {
      passive: true,
      once: true,
      capture: true,
    });
    window.addEventListener("keydown", onInteract, {
      passive: true,
      once: true,
      capture: true,
    });
    window.addEventListener("scroll", onInteract, { passive: true, once: true, capture: true });
    window.addEventListener("touchstart", onInteract, {
      passive: true,
      once: true,
      capture: true,
    });

    timer = window.setTimeout(() => doCount(), 6000);
  }

  function loadAudioEnabled() {
    try {
      const v = localStorage.getItem("staszek_audio");
      if (v === "0") return false;
      if (v === "1") return true;
      // First visit: default OFF (muted) and persist the choice.
      localStorage.setItem("staszek_audio", "0");
    } catch {}
    return false;
  }

  function saveAudioEnabled(enabled) {
    try {
      localStorage.setItem("staszek_audio", enabled ? "1" : "0");
    } catch {}
  }

  function ensureAudioEl() {
    if (state.audio.el) return state.audio.el;
    const a = new Audio();
    a.loop = true;
    a.preload = "auto";
    a.volume = 0.65;
    a.muted = false;
    state.audio.el = a;
    return a;
  }

  function trackForRoute(routeId) {
    const map = {
      start: "audio/audio-mian-page.mp3",
      aktualnosci: "audio/audio-aktualnosci.mp3",
      plakaty: "audio/audio-plakaty.mp3",
      pomysly: "audio/audio-pomysly.mp3",
    };
    return map[routeId] || map.start;
  }

  function setupAudioUnlockOnce() {
    if (!state.audio.enabled) return;
    if (state.audio.unlocked) return;

    const handler = () => {
      state.audio.unlocked = true;
      const a = ensureAudioEl();
      a.muted = false;
      syncAudioWithRoute(state.route || "start");
    };

    document.addEventListener("pointerdown", handler, { once: true, capture: true });
    document.addEventListener("keydown", handler, { once: true, capture: true });
  }

  function syncAudioWithRoute(routeId) {
    const a = ensureAudioEl();
    const desiredSrc = trackForRoute(routeId);

    if (!state.audio.enabled) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {}
      state.audio.src = "";
      state.audio.started = false;
      return;
    }

    if (state.audio.src !== desiredSrc) {
      state.audio.src = desiredSrc;
      a.src = desiredSrc;
      try {
        a.currentTime = 0;
      } catch {}
    }

    // Autoplay policies:
    // - If audio is already "unlocked", play with sound.
    // - Otherwise, try with sound first (some browsers allow it), and fall back to muted autoplay.
    const tryPlay = () => {
      const p = a.play();
      if (p && typeof p.then === "function") return p;
      return Promise.resolve();
    };

    if (state.audio.unlocked) {
      a.muted = false;
      tryPlay().then(
        () => {
          state.audio.started = true;
        },
        () => {
          state.audio.started = false;
          setupAudioUnlockOnce();
        }
      );
      return;
    }

    a.muted = false;
    tryPlay().then(
      () => {
        state.audio.started = true;
        state.audio.unlocked = true;
      },
      () => {
        a.muted = true;
        tryPlay().then(
          () => {
            state.audio.started = true;
            state.audio.unlocked = false;

            a.muted = false;
            tryPlay().then(
              () => {
                state.audio.unlocked = true;
              },
              () => {
                a.muted = true;
                state.audio.unlocked = false;
                setupAudioUnlockOnce();
              }
            );
          },
          () => {
            state.audio.started = false;
            state.audio.unlocked = false;
            setupAudioUnlockOnce();
          }
        );
      }
    );
  }

  function isAnyVideoPlayingWithSound() {
    const videos = $$("video");
    for (const v of videos) {
      if (v.paused || v.ended) continue;
      if (v.muted) continue;
      if (Number(v.volume) === 0) continue;
      return true;
    }
    return false;
  }

  function pauseBgAudioForVideo() {
    if (!AUDIO_FEATURE_ENABLED) return;
    if (!state.audio.enabled) return;
    const a = state.audio.el;
    if (!a) return;
    try {
      a.pause();
    } catch {}
    state.audio.suspendedByVideo = true;
  }

  function maybeResumeBgAudioAfterVideo() {
    if (!AUDIO_FEATURE_ENABLED) return;
    if (!state.audio.enabled) return;
    if (!state.audio.suspendedByVideo) return;
    if (isAnyVideoPlayingWithSound()) return;

    state.audio.suspendedByVideo = false;
    const a = state.audio.el;
    if (!a) return;
    try {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }

  function enforceVideoDucking() {
    if (!AUDIO_FEATURE_ENABLED) return;
    if (isAnyVideoPlayingWithSound()) pauseBgAudioForVideo();
    else maybeResumeBgAudioAfterVideo();
  }

  let videoDuckingSetup = false;
  function setupVideoDucking() {
    if (videoDuckingSetup) return;
    videoDuckingSetup = true;

    const handler = () => enforceVideoDucking();
    document.addEventListener("playing", handler, true);
    document.addEventListener("pause", handler, true);
    document.addEventListener("ended", handler, true);
    document.addEventListener("volumechange", handler, true);
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, "");
      else if (v === false || v == null) continue;
      else node.setAttribute(k, String(v));
    }
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) {
      if (child == null) continue;
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function svg(tag, attrs = {}, children = []) {
    const NS = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.setAttribute("class", v);
      else if (k === "style") Object.assign(node.style, v);
      else if (v === true) node.setAttribute(k, "");
      else if (v === false || v == null) continue;
      else node.setAttribute(k, String(v));
    }
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) {
      if (child == null) continue;
      if (typeof child === "string")
        node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function audioIcon(isOn) {
    const base = [
      svg("path", {
        d: "M11 5L6 9H3v6h3l5 4V5z",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linejoin": "round",
      }),
    ];
    const waves = [
      svg("path", {
        d: "M15.5 8.5a4 4 0 010 7",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
      }),
      svg("path", {
        d: "M17.5 6.5a7 7 0 010 11",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
      }),
    ];
    const mute = [
      svg("path", {
        d: "M15 9l6 6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
      }),
      svg("path", {
        d: "M21 9l-6 6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
      }),
    ];

    return svg(
      "svg",
      {
        class: "icon-svg",
        viewBox: "0 0 24 24",
        width: "20",
        height: "20",
        "aria-hidden": "true",
        focusable: "false",
      },
      [...base, ...(isOn ? waves : mute)]
    );
  }

  function heartIcon(filled) {
    const path =
      "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
    return svg(
      "svg",
      {
        class: "icon-svg",
        viewBox: "0 0 24 24",
        width: "20",
        height: "20",
        "aria-hidden": "true",
        focusable: "false",
      },
      [
        svg("path", {
          d: path,
          fill: filled ? "currentColor" : "none",
          stroke: filled ? "none" : "currentColor",
          "stroke-width": filled ? null : "2",
          "stroke-linejoin": "round",
        }),
      ]
    );
  }

  function buildLikeControl({
    likeKey,
    counterName,
    label = "",
    className = "btn like-btn",
    title = "Polub",
    stopPropagation = false,
  }) {
    const liked = state.likes.set.has(likeKey);
    const pending = state.likes.pending.has(likeKey);

    const iconWrap = el("span", { class: "like-icon" }, heartIcon(liked));
    const labelEl = label ? el("span", { class: "like-label" }, label) : null;

    const countEl = el("span", { class: "like-count", title: "Polubienia" }, "—");

    const known = state.likes.counts.get(counterName);
    if (typeof known === "number") countEl.textContent = formatNumber(known);
    else {
      getCounter(counterName).then((v) => {
        if (!countEl.isConnected) return;
        if (typeof v === "number") {
          state.likes.counts.set(counterName, v);
          countEl.textContent = formatNumber(v);
          if (counterName === COUNTER_SITE_VOTE) {
            state.stats.vote = v;
            updateStatsUI();
          }
          refresh();
        }
      });
    }

    const btn = el(
      "button",
      {
        class: className,
        type: "button",
        title,
        disabled: liked || pending,
        "aria-pressed": liked ? "true" : "false",
        onClick: async (e) => {
          if (stopPropagation) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (state.likes.set.has(likeKey)) return;
          if (state.likes.pending.has(likeKey)) return;

          state.likes.pending.add(likeKey);
          refresh();

          const newVal = await addCounter(counterName, 1);
          if (typeof newVal !== "number") {
            state.likes.pending.delete(likeKey);
            refresh();
            toast("Nie udało się wysłać lajka. Spróbuj ponownie.");
            return;
          }

          state.likes.pending.delete(likeKey);
          state.likes.set.add(likeKey);
          state.likes.counts.set(counterName, newVal);
          saveLikeSet(state.likes.set);
          if (counterName === COUNTER_SITE_VOTE) {
            state.stats.vote = newVal;
            updateStatsUI();
          }
          refresh();
        },
      },
      [iconWrap, labelEl, countEl].filter(Boolean)
    );

    function refresh() {
      const isLiked = state.likes.set.has(likeKey);
      const isPending = state.likes.pending.has(likeKey);
      btn.disabled = isLiked || isPending;
      btn.setAttribute("aria-pressed", isLiked ? "true" : "false");
      btn.classList.toggle("is-liked", isLiked);
      btn.classList.toggle("is-pending", isPending);

      iconWrap.textContent = "";
      iconWrap.appendChild(heartIcon(isLiked));

      const v = state.likes.counts.get(counterName);
      if (typeof v === "number") countEl.textContent = formatNumber(v);

      const hideVoteCount =
        counterName === COUNTER_SITE_VOTE &&
        !(typeof v === "number" && Number.isFinite(v) && v >= MIN_PUBLIC_VOTE_COUNT);
      countEl.hidden = hideVoteCount;
    }
    refresh();
    return btn;
  }

  const FORUM_SITE_KEY = "staszek-forum";
  const FORUM_MAX_NAME = 26;
  const FORUM_MAX_MESSAGE = 360;
  const FORUM_COOLDOWN_MS = 8000;
  const FORUM_CACHE_TTL_MS = 15000;
  const forumCache = new Map();

  function stripDiacriticsLower(s) {
    const raw = String(s || "");
    try {
      return raw
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    } catch {
      return raw.toLowerCase();
    }
  }

  function slugKeyPart(s, fallback = "x") {
    const clean = stripDiacriticsLower(s)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return clean || fallback;
  }

  function forumKeyForNews(postId) {
    return `staszek-news-${slugKeyPart(postId, "post")}`;
  }

  function forumKeyForProgram(pointId) {
    return `staszek-program-${slugKeyPart(pointId, "punkt")}`;
  }

  function forumKeyForPoster(src) {
    return `staszek-poster-${hash32(src)}`;
  }

  function likeKeyForNews(postId) {
    return `like:news:${slugKeyPart(postId, "post")}`;
  }

  function likeCounterForNews(postId) {
    return `like-news-${slugKeyPart(postId, "post")}`;
  }

  function likeKeyForProgram(pointId) {
    return `like:program:${slugKeyPart(pointId, "punkt")}`;
  }

  function likeCounterForProgram(pointId) {
    return `like-program-${slugKeyPart(pointId, "punkt")}`;
  }

  function likeKeyForPoster(src) {
    return `like:poster:${hash32(src)}`;
  }

  function likeCounterForPoster(src) {
    return `like-poster-${hash32(src)}`;
  }

  function sanitizeForumName(name) {
    const s = String(name || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.slice(0, FORUM_MAX_NAME);
  }

  function sanitizeForumMessage(message) {
    const s = String(message || "").replace(/\r\n/g, "\n").trim();
    if (!s) return "";
    return s.slice(0, FORUM_MAX_MESSAGE);
  }

  function parseForumEntry(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const parsed = safeJsonParse(s);
    if (parsed && typeof parsed === "object") {
      const msg = String(parsed.m ?? parsed.message ?? "").trim();
      if (msg) {
        return {
          t: Number(parsed.t ?? parsed.time ?? 0) || 0,
          n: String(parsed.n ?? parsed.name ?? "").trim(),
          m: msg,
          _raw: s,
        };
      }
    }
    return { t: 0, n: "", m: s, _raw: s };
  }

  function formatForumTime(ms) {
    const t = Number(ms) || 0;
    if (!t) return "";
    try {
      return new Date(t).toLocaleString("pl-PL", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      try {
        return new Date(t).toLocaleString();
      } catch {
        return "";
      }
    }
  }

  function buildForumPanel({
    threadKey,
    placeholder = "Napisz wiadomość…",
    compact = false,
    autoLoad = false,
    onCount = null,
  }) {
    const keyHash = hash32(threadKey);
    const cooldownKey = `staszek_forum_last_${keyHash}`;

    let items = [];
    let loaded = false;
    let loading = false;

    const notice = el(
      "div",
      { class: "thread-notice" },
      "Wpisy są publiczne. Nie podawaj danych osobowych."
    );

    const nameInput = el("input", {
      class: "thread-input",
      placeholder: "Imię / nick (opcjonalnie)",
      maxLength: String(FORUM_MAX_NAME),
      "aria-label": "Imię lub nick",
      autocomplete: "nickname",
      inputmode: "text",
    });

    const msgInput = el("textarea", {
      class: "thread-input thread-textarea",
      placeholder,
      rows: compact ? "3" : "4",
      maxLength: String(FORUM_MAX_MESSAGE),
      "aria-label": "Treść wpisu",
    });

    const sendBtn = el(
      "button",
      { class: "btn btn-primary", type: "submit" },
      "Wyślij"
    );

    const refreshBtn = el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: () => load(true),
      },
      "Odśwież"
    );

    const statusEl = el("div", { class: "thread-status", role: "status" }, "");
    const listEl = el("div", { class: "thread-list" }, [
      el("div", { class: "thread-empty" }, "Brak wpisów (jeszcze)."),
    ]);

    const hint = el(
      "div",
      { class: "thread-hint" },
      `Max ${FORUM_MAX_MESSAGE} znaków.`
    );

    const actions = el("div", { class: "thread-actions" }, [sendBtn, refreshBtn, hint]);

    const form = el(
      "form",
      {
        class: "thread-form",
        onSubmit: async (e) => {
          e.preventDefault();
          if (loading) return;

          const n = sanitizeForumName(nameInput.value);
          const m = sanitizeForumMessage(msgInput.value);
          if (!m) {
            toast("Wpis nie może być pusty.");
            return;
          }

          try {
            const last = Number(localStorage.getItem(cooldownKey) || "0") || 0;
            if (Date.now() - last < FORUM_COOLDOWN_MS) {
              toast("Poczekaj chwilę przed kolejnym wpisem.");
              return;
            }
          } catch {}

          const entry = { t: Date.now(), n, m };
          const payload = JSON.stringify(entry);
          entry._raw = payload;

          loading = true;
          sendBtn.disabled = true;
          refreshBtn.disabled = true;
          setStatus("Wysyłanie…");

          const ok = await basicDbAdd(threadKey, payload);
          loading = false;
          sendBtn.disabled = false;
          refreshBtn.disabled = false;

          if (!ok) {
            setStatus("Nie udało się dodać wpisu. Spróbuj ponownie.", "err");
            return;
          }

          try {
            localStorage.setItem(cooldownKey, String(Date.now()));
          } catch {}

          msgInput.value = "";
          if (!loaded) loaded = true;
          items = [entry, ...items].slice(0, 200);
          forumCache.set(threadKey, { items, at: Date.now() });
          render();
          setStatus("Dodano.", "ok");
          setTimeout(() => setStatus(""), 1800);
        },
      },
      [nameInput, msgInput, actions]
    );

    const root = el("div", { class: `thread-panel ${compact ? "is-compact" : ""}` }, [
      notice,
      form,
      statusEl,
      listEl,
    ]);

    function setStatus(msg, kind = "") {
      statusEl.textContent = msg || "";
      statusEl.dataset.kind = kind || "";
    }

    function render() {
      if (typeof onCount === "function") onCount(items.length);

      listEl.textContent = "";
      if (!items.length) {
        listEl.appendChild(
          el(
            "div",
            { class: "thread-empty" },
            "Brak wpisów. Możesz być pierwszy/a."
          )
        );
        return;
      }

      for (const it of items) {
        const who = sanitizeForumName(it.n) || "Anonim";
        const time = formatForumTime(it.t);
        const delBtn =
          isAdminEnabled() && it._raw
            ? el(
                "button",
                {
                  class: "thread-del",
                  type: "button",
                  title: "Usuń wpis",
                  onClick: async () => {
                    const okConfirm = confirm(
                      "Usunąć ten wpis? Tej operacji nie da się cofnąć."
                    );
                    if (!okConfirm) return;
                    setStatus("Usuwanie…");
                    const ok = await basicDbRemove(threadKey, it._raw);
                    if (!ok) {
                      setStatus("Nie udało się usunąć wpisu.", "err");
                      setTimeout(() => setStatus(""), 2200);
                      return;
                    }
                    items = items.filter((x) => x && x._raw !== it._raw);
                    forumCache.set(threadKey, { items, at: Date.now() });
                    render();
                    setStatus("Usunięto.", "ok");
                    setTimeout(() => setStatus(""), 1800);
                  },
                },
                "Usuń"
              )
            : null;

        const right = el("div", { class: "thread-item-tools" }, [
          time ? el("span", { class: "thread-time" }, time) : null,
          delBtn,
        ]);

        const head = el("div", { class: "thread-item-head" }, [
          el("strong", { class: "thread-name" }, who),
          right,
        ]);
        const msg = el("div", { class: "thread-msg" }, it.m);
        listEl.appendChild(el("div", { class: "thread-item" }, [head, msg]));
      }
    }

    async function load(force = false) {
      if (loading) return;
      loading = true;
      refreshBtn.disabled = true;
      setStatus("Ładowanie…");

      const cached = forumCache.get(threadKey);
      if (!force && cached && Date.now() - cached.at < FORUM_CACHE_TTL_MS) {
        items = cached.items;
        loaded = true;
        loading = false;
        refreshBtn.disabled = false;
        setStatus("");
        render();
        return;
      }

      const raw = await basicDbRead(threadKey);
      const parsed = raw.map(parseForumEntry).filter(Boolean);

      items = parsed
        .slice()
        .reverse()
        .slice(0, 200);
      loaded = true;
      forumCache.set(threadKey, { items, at: Date.now() });

      loading = false;
      refreshBtn.disabled = false;
      setStatus("");
      render();
    }

    if (autoLoad) load();

    return { node: root, load };
  }

  function buildForumDetails({
    threadKey,
    label = "Dyskusja",
    placeholder = "Napisz wiadomość…",
    compact = false,
  }) {
    const countBadge = el("span", { class: "thread-count", hidden: true }, "");
    const summary = el("summary", { class: "thread-summary" }, [
      el("span", { class: "thread-label" }, label),
      countBadge,
    ]);

    const panel = buildForumPanel({
      threadKey,
      placeholder,
      compact,
      autoLoad: false,
      onCount: (n) => {
        const v = Number(n) || 0;
        countBadge.hidden = v <= 0;
        countBadge.textContent = v > 0 ? String(v) : "";
      },
    });

    const details = el("details", { class: "thread" }, [summary, panel.node]);
    details.addEventListener("toggle", () => {
      if (details.open) panel.load(false);
    });
    return details;
  }

  function parseRoute() {
    const rawHash = String(location.hash || "");
    const hashPart = rawHash.replace(/^#/, "");
    const useHash = hashPart.trim() !== "" && hashPart !== "/";

    if (useHash) {
      const clean = hashPart.startsWith("/") ? hashPart.slice(1) : hashPart;
      const [path, query] = clean.split("?");
      const parts = (path || "").split("/").filter(Boolean);
      let id = parts[0] || "start";
      if (parts[0] === "admin") id = "admin";
      return { id, parts, query: query || "" };
    }

    const pathParts = String(location.pathname || "/")
      .split("/")
      .filter(Boolean);
    const query = String(location.search || "").replace(/^\?/, "");
    let id = pathParts[0] || "start";
    if (pathParts[0] === "admin") id = "admin";
    return { id, parts: pathParts, query };
  }

  function navTo(hash) {
    if (location.hash === hash) return;
    location.hash = hash;
  }

  function replaceUrlToAppRoot() {
    const path = String(location.pathname || "/");
    const markers = ["/admin/", "/pv/"];
    let idx = -1;
    for (const m of markers) {
      const i = path.indexOf(m);
      if (i >= 0 && (idx === -1 || i < idx)) idx = i;
    }
    const base = idx >= 0 ? path.slice(0, idx) : path;
    const baseNoSlash = base.endsWith("/") ? base.slice(0, -1) : base;
    const next = `${baseNoSlash || ""}/#/`;
    try {
      history.replaceState(null, "", next);
    } catch {
      navTo("#/");
    }
  }

  function scheduleRender(nextRestoreFocus = null) {
    restoreFocus = nextRestoreFocus;
    if (renderTimer) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => render(), 0);
  }

  function formatDate(dateStr) {
    const s = (dateStr || "").trim();
    if (!s) return "";
    return s;
  }

  function renderRichText(text) {
    const root = el("div", { class: "post-body" });
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");

    let paragraph = [];
    let list = null;

    function flushParagraph() {
      if (!paragraph.length) return;
      root.appendChild(el("p", {}, paragraph.join(" ")));
      paragraph = [];
    }

    function flushList() {
      if (!list) return;
      root.appendChild(list);
      list = null;
    }

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const isBlank = line.trim() === "";
      const isBullet =
        /^[-•]\s+/.test(line.trim()) || /^\d+[.)]\s+/.test(line.trim());

      if (isBlank) {
        flushParagraph();
        flushList();
        continue;
      }

      if (isBullet) {
        flushParagraph();
        if (!list) list = el("ul");
        const itemText = line.trim().replace(/^[-•]\s+/, "").replace(/^\d+[.)]\s+/, "");
        list.appendChild(el("li", {}, itemText));
        continue;
      }

      flushList();
      paragraph.push(line.trim());
    }

    flushParagraph();
    flushList();
    return root;
  }

  function makeImage(src, alt) {
    const wrap = el("div", { class: "image" });
    const img = el("img", { src, alt, loading: "lazy" });
    img.addEventListener("load", () => wrap.classList.add("is-loaded"));
    img.addEventListener("error", () => wrap.classList.add("is-loaded"));
    wrap.appendChild(img);
    return wrap;
  }

  function makeNewsGallery(images, altBase) {
    const items = (Array.isArray(images) ? images : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    if (!items.length) return null;
    if (items.length === 1) return makeImage(items[0], altBase || "Grafika");

    const mainSrc = items[0];
    const side = items.slice(1, 3);

    const main = el("div", { class: "news-gallery-main" }, [
      makeImage(mainSrc, altBase ? `${altBase} — grafika 1` : "Grafika 1"),
    ]);

    const row = side.length
      ? el(
          "div",
          { class: "news-gallery-row" },
          side.map((src, idx) =>
            el("div", { class: "news-gallery-sub" }, [
              makeImage(
                src,
                altBase ? `${altBase} — grafika ${idx + 2}` : `Grafika ${idx + 2}`
              ),
            ])
          )
        )
      : null;

    return el("div", { class: "news-gallery" }, [main, row].filter(Boolean));
  }

  function makeVideo(src, poster, title) {
    const wrap = el("div", { class: "video" });
    const video = el("video", {
      src,
      poster: poster || null,
      preload: "metadata",
      playsinline: true,
      controls: true,
      "aria-label": title || "Wideo",
    });
    video.addEventListener("loadeddata", () => wrap.classList.add("is-loaded"));
    video.addEventListener("error", () => wrap.classList.add("is-loaded"));
    wrap.appendChild(video);
    return wrap;
  }

  function reveal(container) {
    const targets = $$(".reveal", container);
    if (!targets.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.14 }
    );
    for (const t of targets) io.observe(t);
  }

  function copyText(text) {
    const s = String(text || "");
    if (!s) return Promise.resolve(false);
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(s).then(
        () => true,
        () => false
      );
    }
    const ta = el("textarea", {
      style: {
        position: "fixed",
        top: "-1000px",
        left: "-1000px",
        opacity: "0",
      },
    });
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return Promise.resolve(ok);
  }

  function toast(message) {
    const existing = $("#toast");
    existing?.remove();
    const node = el("div", {
      id: "toast",
      class: "panel",
      style: {
        position: "fixed",
        right: "14px",
        bottom: "14px",
        zIndex: 120,
        padding: "12px 12px",
        borderRadius: "16px",
        background: "rgba(11,11,15,0.78)",
        border: "1px solid rgba(255,255,255,0.14)",
        backdropFilter: "blur(12px)",
        maxWidth: "min(420px, calc(100vw - 28px))",
      },
    });
    node.appendChild(el("div", { style: { fontSize: "13px" } }, message));
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2400);
  }

  function setRobotsMeta(content) {
    const head = document.head || document.getElementsByTagName("head")[0];
    if (!head) return;
    const existing = head.querySelector('meta[name="robots"]');
    const c = String(content || "").trim();
    if (!c) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.setAttribute("content", c);
      return;
    }
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", c);
    head.appendChild(meta);
  }

  function buildTopbar() {
    const creatorUrl = "https://filip.biskupski.site/from/staszek-dla-staszica";
    const brand = el(
      "div",
      {
        class: "brand",
        role: "link",
        tabIndex: "0",
        onClick: () => navTo("#/"),
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") navTo("#/");
        },
        "aria-label": "Przejdź na start",
      },
      [
        el("div", { class: "brand-mark", "aria-hidden": "true" }),
        el("div", {}, [
          el("div", { class: "brand-title" }, "STASZEK DLA STASZICA"),
          el(
            "div",
            { class: "brand-subtitle" },
            "La Familia"
          ),
        ]),
      ]
    );

    const nav = el("nav", { class: "nav", "aria-label": "Nawigacja" });
    for (const r of ROUTES) {
      const a = el("a", { href: r.hash, "data-route": r.id }, r.label);
      nav.appendChild(a);
    }

    let audioBtn = null;
    if (AUDIO_FEATURE_ENABLED) {
      const iconWrap = el("span", { class: "audio-icon" }, audioIcon(state.audio.enabled));
      const sr = el(
        "span",
        { class: "sr-only" },
        state.audio.enabled ? "Dźwięk włączony" : "Dźwięk wyłączony"
      );

      audioBtn = el(
        "button",
        {
          class: "icon-btn icon-only",
          type: "button",
          title: "",
          "aria-pressed": "false",
          onClick: () => {
            state.audio.enabled = !state.audio.enabled;
            saveAudioEnabled(state.audio.enabled);
            syncAudioWithRoute(state.route || "start");
            enforceVideoDucking();
            refreshAudioBtn();
          },
        },
        [iconWrap, sr]
      );

      function refreshAudioBtn() {
        audioBtn.title = state.audio.enabled
          ? "Wycisz / wyłącz dźwięk"
          : "Włącz dźwięk";
        audioBtn.setAttribute("aria-pressed", state.audio.enabled ? "true" : "false");
        iconWrap.textContent = "";
        iconWrap.appendChild(audioIcon(state.audio.enabled));
        sr.textContent = state.audio.enabled ? "Dźwięk włączony" : "Dźwięk wyłączony";
      }
      refreshAudioBtn();
    }

    const creditLink = el(
      "a",
      {
        class: "icon-btn",
        href: creatorUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Wykonanie strony: Filip Biskupski",
        "aria-label": "Wykonanie strony: Filip Biskupski",
      },
      [
        el("span", { class: "btn-full" }, "Twórca strony"),
        el("span", { class: "btn-short", "aria-hidden": "true" }, "Twórca"),
      ]
    );

    const tools = el(
      "div",
      { class: "tools" },
      AUDIO_FEATURE_ENABLED ? [audioBtn, creditLink] : [creditLink]
    );

    const inner = el("div", { class: "topbar-inner" }, [brand, nav, tools]);
    return el("header", { class: "topbar" }, inner);
  }

  function buildFooter() {
    const candidate = window.STASZEK?.candidate;
    const ig = "https://www.instagram.com/tomaszewski_2026/";
    const creatorUrl = "https://filip.biskupski.site/from/staszek-dla-staszica";
    const foot = el("footer", { class: "footer" }, [
      el(
        "div",
        {},
        `© ${new Date().getFullYear()} Filip Biskupski. Wszelkie prawa zastrzeżone.`
      ),
      el(
        "div",
        { style: { marginTop: "8px" } },
        [
          "Instagram: ",
          el(
            "a",
            { href: ig, target: "_blank", rel: "noopener noreferrer" },
            "@tomaszewski_2026"
          ),
          " • Masz pomysł lub chcesz o coś zapytać / skontaktować się ze mną? Napisz na IG.",
        ]
      ),
      el(
        "div",
        { style: { marginTop: "6px" } },
        [
          "Wykonanie strony: ",
          el(
            "a",
            { href: creatorUrl, target: "_blank", rel: "noopener noreferrer" },
            "Filip Biskupski"
          ),
        ]
      ),
      el(
        "div",
        { style: { marginTop: "10px", color: "rgba(255,255,255,0.78)" } },
        [
          "Wyświetlenia: ",
          el("strong", { id: "statViews" }, "—"),
          " • Osoby: ",
          el("strong", { id: "statVisitors" }, "—"),
        ]
      ),
    ]);
    return foot;
  }

  function setNavActive(routeId) {
    const links = $$(".nav a");
    for (const a of links) {
      const isActive = a.getAttribute("data-route") === routeId;
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  function pageStart() {
    const { candidate, images } = window.STASZEK;
    const ig = "https://www.instagram.com/tomaszewski_2026/";
    const creatorUrl = "https://filip.biskupski.site/from/staszek-dla-staszica";
    const staffLinks = window.STASZEK?.staffLinks || {};
    const latestPost = (window.STASZEK?.news || [])[0] || null;
    const analysisPost = APPEAL_ARTICLE_FEATURE_ENABLED
      ? (window.STASZEK?.news || []).find((p) => p && p.id === "post-analiza-wykluczenie")
      : null;

    const latestPreview = latestPost
      ? (() => {
          const id = String(latestPost.id || "").trim();
          const titleText = String(latestPost.title || "Post").trim() || "Post";
          const href = `#/aktualnosci?post=${encodeURIComponent(id)}`;
          const tags = (latestPost.tags || []).slice(0, 2).map((t) =>
            el("span", { class: "badge" }, `#${t}`)
          );
          const mediaSrc =
            (Array.isArray(latestPost.images) && latestPost.images[0]) ||
            latestPost.image ||
            "";
          const snippet = (() => {
            const s = String(latestPost.body || "").replace(/\s+/g, " ").trim();
            if (!s) return "";
            return s.length > 180 ? `${s.slice(0, 180).trimEnd()}…` : s;
          })();

          return el(
            "a",
            {
              class: "card reveal latest-post",
              href,
              "aria-label": `Otwórz najnowszy post: ${titleText}`,
            },
            [
              el("div", { class: "latest-post-inner" }, [
                mediaSrc
                  ? el("div", { class: "latest-post-thumb" }, makeImage(mediaSrc, titleText))
                  : null,
                el("div", { class: "latest-post-content" }, [
                  el("div", { class: "meta-row latest-post-meta" }, [
                    el("span", { class: "badge accent" }, "Najnowszy post"),
                    ...tags,
                    el("span", { style: { flex: "1" } }),
                    latestPost.date
                      ? el("span", { class: "post-date" }, formatDate(latestPost.date))
                      : null,
                    el("span", { class: "badge" }, "Otwórz →"),
                  ]),
                  el("h3", { class: "latest-post-title" }, titleText),
                  snippet ? el("p", { class: "latest-post-snippet" }, snippet) : null,
                ]),
              ]),
            ]
          );
        })()
      : null;

    const banner = APPEAL_ARTICLE_FEATURE_ENABLED
      ? el("section", { class: "card reveal announcement" }, [
          el("div", { class: "announcement-head" }, [
            el("span", { class: "badge warn" }, "WAŻNE"),
            el("strong", {}, "Wykluczenie z wyborów — apel"),
          ]),
          el(
            "p",
            {},
            "Jeśli popierasz apel o przywrócenie Stanisława do wyborów, kliknij poniżej:"
          ),
          el("div", { class: "meta-row" }, [
            buildLikeControl({
              likeKey: "like:uniewinnic",
              counterName: COUNTER_SITE_EXONERATE,
              label: "Uniewinnić Stanisława",
              className: "btn btn-primary like-btn like-appeal",
              title: "Uniewinnić Stanisława",
            }),
          ]),
          analysisPost
            ? (() => {
                const titleRow = el("div", { class: "post-title" }, [
                  el("h3", {}, analysisPost.title || "Analiza"),
                  analysisPost.date
                    ? el("span", { class: "post-date" }, formatDate(analysisPost.date))
                    : null,
                ]);
                const body = renderRichText(analysisPost.body || "");
                return el("div", { style: { marginTop: "12px" } }, [titleRow, body]);
              })()
            : null,
        ])
      : null;

    const hero = el("section", { class: "hero reveal" }, [
      el("div", {
        class: "hero-media",
        style: { backgroundImage: `url("${images.main}")` },
      }),
      el("div", { class: "hero-overlay" }),
      el("div", { class: "hero-inner" }, [
        el("div", {}, [
          el("div", { class: "hero-kicker" }, [
            el("span", { "aria-hidden": "true" }, "🌹"),
            el("span", {}, "Kontrakt dla Rodziny Staszica • 13/13 zatwierdzone"),
          ]),
          el("h1", { class: "hero-h1" }, [
            "Stanisław ",
            el("strong", {}, "Tomaszewski"),
          ]),
          el(
            "p",
            { class: "hero-p" },
            `Kandydat na Prezydenta Staszica • ${candidate.className} • ${candidate.profile}.`
          ),
          el("div", { class: "cta-row" }, [
            el(
              "a",
              { class: "btn btn-primary", href: "#/pomysly" },
              "Zobacz program (13)"
            ),
            el("a", { class: "btn", href: "#/plakaty" }, "Plakaty wyborcze"),
            el("a", { class: "btn", href: "#/aktualnosci" }, "Aktualności"),
          ]),
        ]),
        el("div", { class: "card" }, [
          el("h3", {}, "Kim jestem"),
          el(
            "p",
            {},
            "Stanisław Tomaszewski • 1C • MAT‑INF‑FIZ. Projekty, negocjacje, skuteczność."
          ),
          el(
            "p",
            { style: { marginTop: "10px" } },
            [
              "Masz pomysł, czego brakuje w szkole — albo po prostu chcesz o coś zapytać / skontaktować się ze mną? Napisz na Instagramie: ",
              el(
                "a",
                { href: ig, target: "_blank", rel: "noopener noreferrer" },
                "@tomaszewski_2026"
              ),
              ".",
            ]
          ),
          el("div", { class: "meta-row" }, [
            el("span", { class: "badge ok" }, "✅ Approved by Dyrekcja"),
            el("span", { class: "badge accent" }, "#staszekdlastaszica"),
            el(
              "button",
              {
                class: "btn",
                type: "button",
                onClick: async () => {
                  const ok = await copyText(location.href.split("#")[0] + "#/");
                  toast(
                    ok ? "Link skopiowany." : "Nie udało się skopiować linku."
                  );
                },
              },
              "Udostępnij link"
            ),
          ]),
          el("div", { class: "meta-row" }, [
            buildLikeControl({
              likeKey: "like:vote",
              counterName: COUNTER_SITE_VOTE,
              label: "Głosuję na Staśka",
              className: "btn btn-primary like-btn like-vote",
              title: "Głosuję na Staśka",
            }),
          ]),
        ]),
      ]),
    ]);

    const statsBoxes = el("section", { class: "stats-grid", style: { marginTop: "14px" } }, [
      el("div", { class: "card reveal stat" }, [
        el("div", { class: "stat-value" }, [
          el("span", { class: "stat-number", id: "statVisitorsBox", "data-loading": "1" }, "…"),
        ]),
        el("div", { class: "stat-label" }, "Osoby, które odwiedziły stronę"),
      ]),
      el("div", { class: "card reveal stat" }, [
        el("div", { class: "stat-value" }, [
          el("span", { class: "stat-number", id: "statViewsBox", "data-loading": "1" }, "…"),
        ]),
        el("div", { class: "stat-label" }, "Wyświetlenia strony"),
      ]),
      el("div", { class: "card reveal stat", id: "statVoteCard", hidden: true }, [
        el("div", { class: "stat-value" }, [
          el("span", { class: "stat-number", id: "statVoteBox", "data-loading": "1" }, "…"),
        ]),
        el("div", { class: "stat-label" }, "Deklaracje: „Głosuję na Staśka”"),
      ]),
    ]);
    state.ui.statsBoxesActivated = false;
    setupLazyStatsBoxes(statsBoxes);

    const quick = el("section", { class: "grid three", style: { marginTop: "14px" } }, [
      el("div", { class: "card reveal" }, [
        el("h3", {}, "13 punktów"),
        el("p", {}, "Konkrety od Erasmusa+ po powrót skarpetek."),
        el("div", { class: "meta-row" }, [
          el("span", { class: "badge accent" }, "Program"),
          el("a", { class: "btn", href: "#/pomysly" }, "Otwórz"),
        ]),
      ]),
      el("div", { class: "card reveal" }, [
        el("h3", {}, "Aktualności"),
        el("p", {}, "Najnowsze posty kampanii i ogłoszenia."),
        el("div", { class: "meta-row" }, [
          el("span", { class: "badge" }, "Posty"),
          el("a", { class: "btn", href: "#/aktualnosci" }, "Otwórz"),
        ]),
      ]),
      el("div", { class: "card reveal" }, [
        el("h3", {}, "Plakaty"),
        el("p", {}, "Galeria plakatów + podgląd fullscreen."),
        el("div", { class: "meta-row" }, [
          el("span", { class: "badge" }, "Grafiki"),
          el("a", { class: "btn", href: "#/plakaty" }, "Otwórz"),
        ]),
      ]),
    ]);

    const staffSection = el("section", { class: "split", style: { marginTop: "14px" } }, [
      el("div", { class: "card reveal" }, [
        el("h3", {}, "La Familia (sztab)"),
        el(
          "p",
          {},
          "Prawdziwa siła to nie jednostka. To ludzie, którzy dowożą rzeczy do końca."
        ),
        makeImage(images.staff, "Sztab wyborczy"),
      ]),
      el("div", { class: "card reveal" }, [
        el("h3", {}, "Skład sztabu"),
        el("p", {}, "Najlepsi z najlepszych:"),
        el(
          "div",
          { class: "chips", style: { marginTop: "10px" } },
          window.STASZEK.staff.map((n) => {
            const baseName = String(n).replace(/\s*\([^)]*\)\s*$/, "");
            if (baseName === "Filip Biskupski") {
              return el(
                "a",
                {
                  class: "chip chip-link",
                  href: creatorUrl,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  role: "listitem",
                  title: "Otwórz stronę Filipa Biskupskiego",
                  "aria-label": "Filip Biskupski (link)",
                },
                n
              );
            }
            const fb = staffLinks[baseName];
            if (fb) {
              return el(
                "a",
                {
                  class: "chip chip-link",
                  href: fb,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  role: "listitem",
                  title: `Facebook: ${n}`,
                  "aria-label": `${n} (Facebook)`,
                },
                n
              );
            }
            return el("span", { class: "chip", role: "listitem" }, n);
          })
        ),
      ]),
    ]);

    const forumPanel = buildForumPanel({
      threadKey: FORUM_SITE_KEY,
      placeholder: "Napisz na forum…",
      autoLoad: true,
    });

    const forumSection = el("section", { class: "card reveal", style: { marginTop: "14px" } }, [
      el("h3", {}, "Forum"),
      el(
        "p",
        {},
        "Masz pytanie, pomysł albo chcesz zostawić wiadomość dla kampanii? Napisz tutaj."
      ),
      forumPanel.node,
    ]);

    return el("div", {}, [
      latestPreview,
      banner,
      hero,
      statsBoxes,
      quick,
      staffSection,
      forumSection,
    ]);
  }

  function pageAdmin(parts) {
    const token = String(parts?.[1] || "").trim();
    const node = pageStart();
    if (!ADMIN_FEATURE_ENABLED || !token) {
      replaceUrlToAppRoot();
      scheduleRender();
      return node;
    }

    (async () => {
      const hex = await sha256Hex(token);
      if (hex && hex.toLowerCase() === ADMIN_SECRET_SHA256_HEX) {
        setAdminEnabled(true);
        toast("Tryb admin włączony.");
      }
      replaceUrlToAppRoot();
      scheduleRender();
    })();

    return node;
  }

  function pagePv(parts) {
    const token = String(parts?.[1] || "").trim();

    if (isAdminEnabled()) return pagePvWiadomosci();

    if (!ADMIN_FEATURE_ENABLED || !token) {
      replaceUrlToAppRoot();
      scheduleRender();
      return pageStart();
    }

    const loading = el("div", {}, [
      el("h2", { class: "page-title reveal" }, "PV"),
      el("div", { class: "card reveal", style: { marginTop: "12px" } }, [
        el("h3", {}, "Ładowanie…"),
        el("p", {}, "…"),
      ]),
    ]);

    (async () => {
      const hex = await sha256Hex(token);
      if (hex && hex.toLowerCase() === ADMIN_SECRET_SHA256_HEX) {
        setAdminEnabled(true);
      }
      replaceUrlToAppRoot();
      try {
        const base = location.href.split("#")[0];
        history.replaceState(null, "", `${base}#/pv`);
      } catch {
        navTo("#/pv");
      }
      scheduleRender();
    })();

    return loading;
  }

  function getAllTags(items) {
    const set = new Set();
    for (const it of items) {
      for (const t of it.tags || []) set.add(String(t).toLowerCase());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pl"));
  }

  function pageAktualnosci() {
    const posts = Array.from(window.STASZEK.news || []);
    const tags = getAllTags(posts);
    const filters = state.filters.aktualnosci;

    const title = el("h2", { class: "page-title reveal" }, "Aktualności");
    const lead = el(
      "p",
      { class: "page-lead reveal" },
      "Najświeższe posty kampanii. Wyszukuj, filtruj tagami i udostępniaj linki."
    );

    const input = el("input", {
      id: "newsSearch",
      placeholder: "Szukaj w postach…",
      value: filters.search,
      onInput: (e) => {
        filters.search = e.target.value;
        scheduleRender({
          id: "newsSearch",
          start: e.target.selectionStart ?? e.target.value.length,
          end: e.target.selectionEnd ?? e.target.value.length,
        });
      },
      "aria-label": "Szukaj w postach",
    });

    const chips = el(
      "div",
      { class: "chips" },
      [
        el(
          "button",
          {
            class: "chip",
            type: "button",
            "aria-pressed": filters.tag === "",
            onClick: () => {
              filters.tag = "";
              render();
            },
          },
          "Wszystkie"
        ),
        ...tags.map((t) =>
          el(
            "button",
            {
              class: "chip",
              type: "button",
              "aria-pressed": filters.tag === t,
              onClick: () => {
                filters.tag = filters.tag === t ? "" : t;
                render();
              },
            },
            `#${t}`
          )
        ),
      ]
    );

    const searchRow = el("div", { class: "search reveal" }, [
      input,
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => {
            filters.search = "";
            filters.tag = "";
            render();
          },
        },
        "Wyczyść"
      ),
    ]);

    const filterPanel = el("div", { class: "card reveal" }, [
      el("h3", {}, "Filtry"),
      el("p", {}, "Wyszukuj i filtruj po tagach."),
      el("div", { style: { marginTop: "10px" } }, chips),
    ]);

    const q = filters.search.trim().toLowerCase();
    const tag = filters.tag;
    const filtered = posts.filter((p) => {
      const hay =
        (p.title || "") + "\n" + (p.body || "") + "\n" + (p.tags || []).join(" ");
      const okQ = !q || hay.toLowerCase().includes(q);
      const okT = !tag || (p.tags || []).map((x) => String(x).toLowerCase()).includes(tag);
      return okQ && okT;
    });

    const list = el("div", { class: "grid", style: { marginTop: "12px" } });

    if (!filtered.length) {
      list.appendChild(
        el("div", { class: "card reveal" }, [
          el("h3", {}, "Brak wyników"),
          el("p", {}, "Zmień wyszukiwanie lub usuń filtry."),
        ])
      );
    }

    for (const p of filtered) {
      const shareBtn = el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: async () => {
            const base = location.href.split("#")[0];
            const link = `${base}#/aktualnosci?post=${encodeURIComponent(p.id)}`;
            const ok = await copyText(link);
            toast(ok ? "Link do posta skopiowany." : "Nie udało się skopiować linku.");
          },
        },
        "Udostępnij"
      );

      const tagBadges = (p.tags || []).slice(0, 6).map((t) =>
        el(
          "button",
          {
            class: "badge",
            type: "button",
            title: "Filtruj po tagu",
            onClick: () => {
              filters.tag = String(t).toLowerCase();
              render();
            },
          },
          `#${t}`
        )
      );

      const card = el("article", { class: "card reveal", "data-post-id": p.id }, [
        el("div", { class: "post-title" }, [
          el("h3", {}, p.title || "Post"),
          el("div", { class: "post-date" }, formatDate(p.date)),
        ]),
        APPEAL_ARTICLE_FEATURE_ENABLED && p.id === "post-analiza-wykluczenie"
          ? el("div", { class: "meta-row" }, [
              buildLikeControl({
                likeKey: "like:uniewinnic",
                counterName: COUNTER_SITE_EXONERATE,
                label: "Uniewinnić Stanisława",
                className: "btn btn-primary like-btn like-appeal",
                title: "Uniewinnić Stanisława",
              }),
            ])
          : null,
        p.video
          ? makeVideo(p.video, p.image || "", p.title || "Wideo")
          : Array.isArray(p.images) && p.images.length
            ? makeNewsGallery(p.images, p.title || "Grafika posta")
            : p.image
              ? makeImage(p.image, p.title || "Grafika posta")
              : null,
        renderRichText(p.body || ""),
        el("div", { class: "meta-row" }, [
          ...tagBadges,
          el("span", { style: { flex: "1" } }),
          buildLikeControl({
            likeKey: likeKeyForNews(p.id),
            counterName: likeCounterForNews(p.id),
            title: "Polub post",
          }),
          shareBtn,
        ]),
        buildForumDetails({
          threadKey: forumKeyForNews(p.id),
          label: "Dyskusja",
          placeholder: "Napisz komentarz do posta…",
        }),
      ]);
      list.appendChild(card);
    }

    return el("div", {}, [
      title,
      lead,
      searchRow,
      filterPanel,
      list,
    ]);
  }

  function cssEscape(s) {
    if (window.CSS?.escape) return CSS.escape(String(s));
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
  }

  function buildProgramCard(p) {
    const approved = p.approved ? "✅ Approved by Dyrekcja" : "⏳ W trakcie";
    const badge = el("span", { class: `badge ${p.approved ? "ok" : "warn"}` }, approved);

    const shareBtn = el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: async () => {
          const base = location.href.split("#")[0];
          const link = `${base}#/pomysly?punkt=${encodeURIComponent(String(p.id))}`;
          const ok = await copyText(link);
          toast(ok ? "Link do punktu skopiowany." : "Nie udało się skopiować linku.");
        },
      },
      "Link"
    );

    const openBtn = el(
      "button",
      {
        class: "btn btn-primary",
        type: "button",
        onClick: () => openProgramModal(p),
      },
      "Szczegóły"
    );

    const tags = (p.tags || []).slice(0, 6).map((t) => el("span", { class: "badge" }, t));

    return el("div", { class: "card reveal" }, [
      el("h3", {}, `${p.id}. ${p.title}`),
      el("p", {}, p.lead || ""),
      el("div", { class: "meta-row" }, [
        badge,
        ...tags,
        el("span", { style: { flex: "1" } }),
        buildLikeControl({
          likeKey: likeKeyForProgram(p.id),
          counterName: likeCounterForProgram(p.id),
          title: "Polub punkt programu",
        }),
        shareBtn,
        openBtn,
      ]),
      buildForumDetails({
        threadKey: forumKeyForProgram(p.id),
        label: "Dyskusja",
        placeholder: "Napisz komentarz do punktu programu…",
        compact: true,
      }),
    ]);
  }

  function openProgramModal(point) {
    const modal = $("#modal");
    const title = $("#modalTitle");
    const body = $("#modalBody");
    if (!modal || !title || !body) return;

    title.textContent = `${point.id}. ${point.title}`;
    body.textContent = "";

    const col = el("div", { class: "grid" });
    col.appendChild(el("div", { class: "card" }, [
      el("h3", {}, "Opis"),
      el("p", {}, point.lead || ""),
      el("div", { class: "meta-row" }, [
        el("span", { class: `badge ${point.approved ? "ok" : "warn"}` }, point.approved ? "✅ Approved by Dyrekcja" : "⏳ W trakcie"),
        ...(point.tags || []).map((t) => el("span", { class: "badge" }, `#${t}`)),
        el("span", { style: { flex: "1" } }),
        buildLikeControl({
          likeKey: likeKeyForProgram(point.id),
          counterName: likeCounterForProgram(point.id),
          title: "Polub punkt programu",
        }),
      ]),
    ]));

    if (point.spotlightImage || point.spotlightText) {
      const spot = el("div", { class: "card" }, [
        el("h3", {}, "Karta"),
        point.spotlightImage ? makeImage(point.spotlightImage, point.title) : null,
        point.spotlightText ? renderRichText(point.spotlightText) : null,
      ]);
      col.appendChild(spot);
    }

    const discussionPanel = buildForumPanel({
      threadKey: forumKeyForProgram(point.id),
      placeholder: "Napisz komentarz do tego punktu programu…",
      compact: true,
      autoLoad: true,
    });

    col.appendChild(
      el("div", { class: "card" }, [
        el("h3", {}, "Dyskusja"),
        discussionPanel.node,
      ])
    );

    body.appendChild(col);

    modal.setAttribute("aria-hidden", "false");
    modal.focus();
  }

  function closeModal() {
    const modal = $("#modal");
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
  }

  function pagePomysly() {
    const points = Array.from(window.STASZEK.program || []);
    const tags = getAllTags(points);
    const filters = state.filters.pomysly;

    const title = el("h2", { class: "page-title reveal" }, "Pomysły / Program");
    const lead = el(
      "p",
      { class: "page-lead reveal" },
      "13 konkretnych punktów. Wszystkie z zielonym światłem Dyrekcji."
    );

    const input = el("input", {
      id: "programSearch",
      placeholder: "Szukaj w punktach programu…",
      value: filters.search,
      onInput: (e) => {
        filters.search = e.target.value;
        scheduleRender({
          id: "programSearch",
          start: e.target.selectionStart ?? e.target.value.length,
          end: e.target.selectionEnd ?? e.target.value.length,
        });
      },
      "aria-label": "Szukaj w programie",
    });

    const chips = el(
      "div",
      { class: "chips" },
      [
        el(
          "button",
          {
            class: "chip",
            type: "button",
            "aria-pressed": filters.tag === "",
            onClick: () => {
              filters.tag = "";
              render();
            },
          },
          "Wszystkie"
        ),
        ...tags.map((t) =>
          el(
            "button",
            {
              class: "chip",
              type: "button",
              "aria-pressed": filters.tag === t,
              onClick: () => {
                filters.tag = filters.tag === t ? "" : t;
                render();
              },
            },
            `#${t}`
          )
        ),
      ]
    );

    const searchRow = el("div", { class: "search reveal" }, [
      input,
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => {
            filters.search = "";
            filters.tag = "";
            render();
          },
        },
        "Wyczyść"
      ),
    ]);

    const approvedCount = points.filter((p) => p.approved).length;
    const stats = el("div", { class: "grid", style: { marginTop: "10px" } }, [
      el("div", { class: "card reveal" }, [
        el("h3", {}, "Status"),
        el("p", {}, "Góra zaakceptowała plan — egzekucja postulatów."),
        el("div", { class: "meta-row" }, [
          el("span", { class: "badge ok" }, `✅ Approved: ${approvedCount}/${points.length}`),
          el("span", { class: "badge accent" }, "Kontrakt"),
        ]),
      ]),
    ]);

    const filterPanel = el("div", { class: "card reveal", style: { marginTop: "12px" } }, [
      el("h3", {}, "Filtry"),
      el("p", {}, "Wyszukaj punkt albo filtruj po tagach."),
      el("div", { style: { marginTop: "10px" } }, chips),
    ]);

    const q = filters.search.trim().toLowerCase();
    const tag = filters.tag;
    const filtered = points.filter((p) => {
      const hay =
        `${p.id} ${p.title}\n${p.lead || ""}\n${(p.tags || []).join(" ")}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      const okT = !tag || (p.tags || []).map((x) => String(x).toLowerCase()).includes(tag);
      return okQ && okT;
    });

    const grid = el("div", { class: "grid", style: { marginTop: "12px" } }, filtered.map(buildProgramCard));

    const essay = el("section", { class: "card reveal", style: { marginTop: "12px" } }, [
      el("h3", {}, "Wizja współpracy organów SU"),
      el(
        "p",
        {},
        "Tekst o tym, jak ma współpracować władza w Staszicu."
      ),
      renderRichText(window.STASZEK.cooperationEssay || ""),
    ]);

    return el("div", {}, [
      title,
      lead,
      searchRow,
      stats,
      filterPanel,
      grid,
      essay,
    ]);
  }

  function openPoster(index) {
    const posters = window.STASZEK?.images?.posters || [];
    if (!posters.length) return;
    state.posterIndex = clamp(index, 0, posters.length - 1);

    const modal = $("#posterModal");
    const title = $("#posterTitle");
    const body = $("#posterBody");
    if (!modal || !title || !body) return;

    const p = posters[state.posterIndex];
    title.textContent = p.title || "Plakat";
    body.textContent = "";
    body.appendChild(makeImage(p.src, p.title || "Plakat"));
    const prevBtn = el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: () => openPoster(state.posterIndex - 1),
        disabled: state.posterIndex === 0,
      },
      "←"
    );
    const nextBtn = el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: () => openPoster(state.posterIndex + 1),
        disabled: state.posterIndex === posters.length - 1,
      },
      "→"
    );
    const navGroup = el("div", { class: "poster-nav" }, [prevBtn, nextBtn]);
    const likeBtn = buildLikeControl({
      likeKey: likeKeyForPoster(p.src),
      counterName: likeCounterForPoster(p.src),
      title: "Polub plakat",
    });
    const metaRow = el("div", { class: "poster-meta-row" }, [
      el("span", { class: "badge", title: p.subtitle || "" }, p.subtitle || ""),
      el("div", { class: "poster-ctas" }, [
        likeBtn,
        el(
          "a",
          { class: "btn btn-primary", href: p.src, download: "" },
          "Pobierz"
        ),
      ]),
    ]);
    const navRow = el("div", { class: "poster-nav-row" }, navGroup);
    body.appendChild(el("div", { class: "poster-actions" }, [metaRow, navRow]));
    body.appendChild(
      buildForumDetails({
        threadKey: forumKeyForPoster(p.src),
        label: "Dyskusja",
        placeholder: "Napisz komentarz do plakatu…",
        compact: true,
      })
    );

    modal.setAttribute("aria-hidden", "false");
    modal.focus();
  }

  function closePosterModal() {
    const modal = $("#posterModal");
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
  }

  function pagePlakaty() {
    const posters = window.STASZEK?.images?.posters || [];

    const title = el("h2", { class: "page-title reveal" }, "Plakaty wyborcze");
    const lead = el(
      "p",
      { class: "page-lead reveal" },
      "Kliknij plakat, żeby otworzyć podgląd i pobrać w pełnej jakości."
    );

    const grid = el("div", { class: "poster-grid", style: { marginTop: "14px" } });
    posters.forEach((p, idx) => {
      const card = el(
        "div",
        {
          class: "poster reveal",
          role: "button",
          tabIndex: "0",
          onClick: () => openPoster(idx),
          onKeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") openPoster(idx);
          },
          "aria-label": `Otwórz plakat: ${p.title}`,
        },
        [
          el("img", { src: p.src, alt: p.title, loading: "lazy" }),
          el("div", { class: "poster-caption" }, `${p.title} • ${p.subtitle || ""}`),
        ]
      );
      grid.appendChild(card);
    });

    return el("div", {}, [title, lead, grid]);
  }

  function pageKontakt() {
    const ig = "https://www.instagram.com/tomaszewski_2026/";
    const title = el("h2", { class: "page-title reveal" }, "Kontakt");
    const lead = el(
      "p",
      { class: "page-lead reveal" },
      "Masz sprawę, pomysł albo pytanie? Wyślij wiadomość."
    );

    const CONTACT_KEY = "pv-mesege-staszek";
    const SUBJECT_MAX = 80;
    const BODY_MAX = 520;
    const cooldownKey = "staszek_contact_last";

    const notice = el(
      "div",
      { class: "thread-notice" },
      [
        "Alternatywnie: Instagram ",
        el("a", { href: ig, target: "_blank", rel: "noopener noreferrer" }, "@tomaszewski_2026"),
        ". Nie podawaj danych wrażliwych.",
      ]
    );

    const subjectInput = el("input", {
      class: "thread-input",
      placeholder: "Temat",
      maxLength: String(SUBJECT_MAX),
      "aria-label": "Temat wiadomości",
      autocomplete: "off",
    });

    const bodyInput = el("textarea", {
      class: "thread-input thread-textarea",
      placeholder: "Treść",
      rows: "6",
      maxLength: String(BODY_MAX),
      "aria-label": "Treść wiadomości",
    });

    const statusEl = el("div", { class: "thread-status", role: "status" }, "");
    const sendBtn = el("button", { class: "btn btn-primary", type: "submit" }, "Wyślij");

    const form = el(
      "form",
      {
        class: "card reveal thread-form",
        onSubmit: async (e) => {
          e.preventDefault();
          const subject = String(subjectInput.value || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, SUBJECT_MAX);
          const body = String(bodyInput.value || "")
            .replace(/\r\n/g, "\n")
            .trim()
            .slice(0, BODY_MAX);

          if (!subject) {
            toast("Uzupełnij temat.");
            return;
          }
          if (!body) {
            toast("Uzupełnij treść.");
            return;
          }

          try {
            const last = Number(localStorage.getItem(cooldownKey) || "0") || 0;
            if (Date.now() - last < FORUM_COOLDOWN_MS) {
              toast("Poczekaj chwilę przed wysłaniem kolejnej wiadomości.");
              return;
            }
          } catch {}

          statusEl.dataset.kind = "";
          statusEl.textContent = "Wysyłanie…";
          sendBtn.disabled = true;

          const element = `{${subject} ////// ${body}}`;
          const ok = await basicDbAdd(CONTACT_KEY, element);

          sendBtn.disabled = false;
          if (!ok) {
            statusEl.dataset.kind = "err";
            statusEl.textContent = "Nie udało się wysłać. Spróbuj ponownie.";
            return;
          }

          try {
            localStorage.setItem(cooldownKey, String(Date.now()));
          } catch {}

          subjectInput.value = "";
          bodyInput.value = "";
          statusEl.dataset.kind = "ok";
          statusEl.textContent = "Wysłano.";
          setTimeout(() => {
            if (!statusEl.isConnected) return;
            statusEl.textContent = "";
            statusEl.dataset.kind = "";
          }, 2200);
        },
      },
      [
        notice,
        subjectInput,
        bodyInput,
        el("div", { class: "thread-actions" }, [
          sendBtn,
          el("div", { class: "thread-hint" }, `Max ${SUBJECT_MAX} / ${BODY_MAX} znaków.`),
        ]),
        statusEl,
      ]
    );

    return el("div", {}, [title, lead, form]);
  }

  function parsePvMessageElement(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const json = safeJsonParse(s);
    if (json && typeof json === "object") {
      const subject = String(json.temat ?? json.subject ?? "").trim();
      const body = String(json.tresc ?? json.treść ?? json.body ?? "").trim();
      if (subject || body) return { subject, body };
    }

    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1);
      const m = inner.match(/^([\s\S]*?)\s*\/{6}\s*([\s\S]*?)$/);
      if (m) {
        return { subject: String(m[1] || "").trim(), body: String(m[2] || "").trim() };
      }
    }
    return { subject: "", body: s };
  }

  function pagePvWiadomosci() {
    const CONTACT_KEY = "pv-mesege-staszek";

    const title = el("h2", { class: "page-title reveal" }, "PV • Wiadomości");
    const lead = el(
      "p",
      { class: "page-lead reveal" },
      "Wiadomości wysłane przez zakładkę Kontakt."
    );

    const statusEl = el("div", { class: "thread-status", role: "status" }, "");
    const countBadge = el("span", { class: "badge" }, "—");

    const searchInput = el("input", {
      placeholder: "Szukaj w wiadomościach…",
      value: "",
      "aria-label": "Szukaj w wiadomościach",
      onInput: () => applyFilter(),
    });

    const refreshBtn = el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: () => load(true),
      },
      "Odśwież"
    );

    const controls = el("div", { class: "search reveal" }, [searchInput, refreshBtn, countBadge]);

    const list = el("div", { class: "grid", style: { marginTop: "12px" } }, [
      el("div", { class: "card reveal" }, [el("h3", {}, "Ładowanie…"), el("p", {}, "…")]),
    ]);

    let all = [];

    function renderList(items) {
      list.textContent = "";
      if (!items.length) {
        list.appendChild(
          el("div", { class: "card reveal" }, [
            el("h3", {}, "Brak wiadomości"),
            el("p", {}, "Nic tu jeszcze nie wpadło."),
          ])
        );
        return;
      }

      for (const m of items) {
        const subject = (m.subject || "").trim() || "(bez tematu)";
        const body = (m.body || "").trim();
        list.appendChild(
          el("article", { class: "card reveal" }, [
            el("h3", {}, subject),
            body ? el("div", { class: "thread-msg", style: { marginTop: "10px" } }, body) : null,
          ].filter(Boolean))
        );
      }
      reveal(list);
    }

    function applyFilter() {
      const q = String(searchInput.value || "").trim().toLowerCase();
      if (!q) {
        renderList(all);
        return;
      }
      const filtered = all.filter((m) => {
        const hay = `${m.subject || ""}\n${m.body || ""}`.toLowerCase();
        return hay.includes(q);
      });
      renderList(filtered);
    }

    async function load(force = false) {
      statusEl.dataset.kind = "";
      statusEl.textContent = "Ładowanie…";
      refreshBtn.disabled = true;
      const items = await basicDbRead(CONTACT_KEY);
      if (!list.isConnected) return;

      all = items
        .slice()
        .reverse()
        .map(parsePvMessageElement)
        .filter(Boolean);

      refreshBtn.disabled = false;
      statusEl.textContent = "";
      countBadge.textContent = `Wiadomości: ${all.length}`;
      applyFilter();
    }

    // initial load
    load();

    return el("div", {}, [
      title,
      lead,
      controls,
      statusEl,
      list,
    ]);
  }

  function buildModal(id, titleId, bodyId, onClose) {
    const closeBtn = el(
      "button",
      {
        class: "icon-btn",
        type: "button",
        title: "Zamknij (Esc)",
        onClick: onClose,
      },
      "Zamknij"
    );

    const panel = el("div", { class: "modal-panel", role: "document" }, [
      el("div", { class: "modal-head" }, [
        el("strong", { id: titleId }, ""),
        closeBtn,
      ]),
      el("div", { class: "modal-body", id: bodyId }),
    ]);

    const modal = el("div", {
      class: "modal",
      id,
      role: "dialog",
      tabIndex: "-1",
      "aria-hidden": "true",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      onClick: (e) => {
        if (e.target === modal) onClose();
      },
    }, panel);
    return modal;
  }

  function initShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ($("#posterModal")?.getAttribute("aria-hidden") === "false")
          closePosterModal();
        if ($("#modal")?.getAttribute("aria-hidden") === "false") closeModal();
        return;
      }
    });
  }

  function initBackground() {
    const canvas = $("#bg");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const stars = [];
    const STAR_COUNT = 90;

    function resize() {
      w = Math.floor(window.innerWidth);
      h = Math.floor(window.innerHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      stars.length = 0;
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.6 + Math.random() * 1.8,
          s: 0.15 + Math.random() * 0.55,
          a: 0.14 + Math.random() * 0.3,
        });
      }
    }

    let t = 0;
    function draw() {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "rgba(255,255,255,0.06)";
      for (const s of stars) {
        const y = (s.y + t * (10 * s.s)) % (h + 20);
        const tw = 0.6 + 0.4 * Math.sin(t * 1.6 + s.x * 0.01);
        ctx.globalAlpha = s.a * tw;
        ctx.beginPath();
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(draw);
    }

    resize();
    seed();
    requestAnimationFrame(draw);
    window.addEventListener("resize", () => {
      resize();
      seed();
    });
  }

  function render() {
    const { id, parts, query } = parseRoute();
    const prevRoute = state.route;
    state.route = id;

    const app = $("#app");
    if (!app) return;
    app.textContent = "";

    const topbar = buildTopbar();
    const content = el("main", { class: "content", id: "content" });
    const footer = buildFooter();

    let page;
    if (id === "aktualnosci") page = pageAktualnosci();
    else if (id === "plakaty") page = pagePlakaty();
    else if (id === "pomysly") page = pagePomysly();
    else if (id === "kontakt") page = pageKontakt();
    else if (id === "pv") page = pagePv(parts);
    else if (id === "admin") page = pageAdmin(parts);
    else page = pageStart();

    content.appendChild(page);
    app.appendChild(topbar);
    setNavActive(id);
    app.appendChild(content);
    app.appendChild(footer);

    ensureModals();
    reveal(content);
    updateStatsUI();

    if (AUDIO_FEATURE_ENABLED) {
      syncAudioWithRoute(id);
      enforceVideoDucking();
    }

    if (id !== prevRoute) {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } catch {
        window.scrollTo(0, 0);
      }
    }

    document.title = {
      start: "STASZEK DLA STASZICA",
      aktualnosci: "Aktualności • STASZEK DLA STASZICA",
      plakaty: "Plakaty • STASZEK DLA STASZICA",
      pomysly: "Pomysły • STASZEK DLA STASZICA",
      kontakt: "Kontakt • STASZEK DLA STASZICA",
      pv: "PV • Wiadomości",
      admin: "Admin",
    }[id] || "STASZEK DLA STASZICA";

    setRobotsMeta(id === "pv" || id === "admin" ? "noindex, nofollow" : "");

    if (id === "pomysly" && query) {
      const m = query.match(/(?:^|&)punkt=([^&]+)/);
      if (m) {
        const pid = decodeURIComponent(m[1]);
        const p = (window.STASZEK.program || []).find((x) => String(x.id) === pid);
        if (p) setTimeout(() => openProgramModal(p), 80);
      }
    }
    if (id === "aktualnosci" && query) {
      const m = query.match(/(?:^|&)post=([^&]+)/);
      if (m) {
        const id2 = decodeURIComponent(m[1]);
        const sel = `article[data-post-id="${cssEscape(id2)}"]`;
        const target = $(sel);
        if (target) {
          setTimeout(() => {
            target.scrollIntoView?.({ block: "start", behavior: "smooth" });
            target.classList.add("flash");
            setTimeout(() => target.classList.remove("flash"), 1200);
          }, 60);
        }
      }
    }

    if (restoreFocus?.id) {
      const input = document.getElementById(restoreFocus.id);
      if (input && typeof input.focus === "function") {
        input.focus();
        try {
          input.setSelectionRange(restoreFocus.start ?? 9999, restoreFocus.end ?? 9999);
        } catch {}
      }
      restoreFocus = null;
    }
  }

  function ensureModals() {
    const app = $("#app");
    if (!app) return;
    if (!$("#modal")) {
      app.appendChild(buildModal("modal", "modalTitle", "modalBody", closeModal));
    }
    if (!$("#posterModal")) {
      app.appendChild(
        buildModal("posterModal", "posterTitle", "posterBody", closePosterModal)
      );
    }
  }

  function init() {
    if (!window.STASZEK) {
      $("#app")?.appendChild(
        el("div", { class: "noscript" }, "Brak danych: data/content.js")
      );
      return;
    }

    state.likes.set = loadLikeSet();
    initSiteStats();

    if (AUDIO_FEATURE_ENABLED) {
      state.audio.enabled = loadAudioEnabled();
      setupAudioUnlockOnce();
      setupVideoDucking();
    } else {
      state.audio.enabled = false;
    }

    initBackground();
    initShortcuts();

    window.addEventListener("hashchange", render);
    render();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
