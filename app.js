(() => {
  const state = {
    route: "",
    posterIndex: 0,
    audio: {
      enabled: true,
      unlocked: false,
      started: false,
      src: "",
      el: null,
      suspendedByVideo: false,
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
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
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

  function parseRoute() {
    const raw = String(location.hash || "#/").replace(/^#/, "");
    const clean = raw.startsWith("/") ? raw.slice(1) : raw;
    const [path, query] = clean.split("?");
    const parts = (path || "").split("/").filter(Boolean);
    return { id: parts[0] || "start", parts, query: query || "" };
  }

  function navTo(hash) {
    if (location.hash === hash) return;
    location.hash = hash;
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

  function buildTopbar() {
    const creatorUrl = "https://filip.biskupski.site/";
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
    const creatorUrl = "https://filip.biskupski.site/";
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
    const creatorUrl = "https://filip.biskupski.site/";
    const staffLinks = window.STASZEK?.staffLinks || {};

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
        ]),
      ]),
    ]);

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

    return el("div", {}, [
      hero,
      quick,
      staffSection,
    ]);
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
        p.video
          ? makeVideo(p.video, p.image || "", p.title || "Wideo")
          : p.image
            ? makeImage(p.image, p.title || "Grafika posta")
            : null,
        renderRichText(p.body || ""),
        el("div", { class: "meta-row" }, [
          ...tagBadges,
          el("span", { style: { flex: "1" } }),
          shareBtn,
        ]),
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
        shareBtn,
        openBtn,
      ]),
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
    body.appendChild(
      el("div", { class: "meta-row", style: { marginTop: "10px" } }, [
        el("span", { class: "badge" }, p.subtitle || ""),
        el("span", { style: { flex: "1" } }),
        el(
          "a",
          { class: "btn btn-primary", href: p.src, download: "" },
          "Pobierz"
        ),
        el(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => openPoster(state.posterIndex - 1),
            disabled: state.posterIndex === 0,
          },
          "←"
        ),
        el(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => openPoster(state.posterIndex + 1),
            disabled: state.posterIndex === posters.length - 1,
          },
          "→"
        ),
      ])
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
    const { id, query } = parseRoute();
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
    else page = pageStart();

    content.appendChild(page);
    app.appendChild(topbar);
    setNavActive(id);
    app.appendChild(content);
    app.appendChild(footer);

    ensureModals();
    reveal(content);

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
    }[id] || "STASZEK DLA STASZICA";

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
