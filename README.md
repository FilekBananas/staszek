# STASZEK DLA STASZICA — strona + backend

Frontend jest w 100% HTML/CSS/JS, a backend służy do:
- ukrycia klucza do API LICZNIK (liczniki/like/forum/PV),
- logowania admina (hasło jest tylko w backendzie),
- moderacji komentarzy (Together AI / Qwen) + usuwania wpisów,
- podglądu PV.

## Jak uruchomić lokalnie

Najprościej przez backend (żeby działały liczniki/forum/admin):

```bash
# 1) uzupełnij .env:
#    - ADMIN_PASSWORD, ADMIN_TOKEN_SECRET
#    - TOGETHER_API_KEY (wymagane do dodawania wpisów na forum)
#    opcjonalnie: TOGETHER_MODEL, TOGETHER_BASE_URL

# 2) uruchom serwer (server sam wczyta .env)
node server/server.js
```

Potem wejdź w przeglądarce na `http://localhost:8080`.

Jeśli hostujesz frontend gdzie indziej (np. GitHub Pages), ustaw w `index.html`:
`<meta name="staszek-api-base" content="https://TWOJ_BACKEND/api" />`.

## Jak dodać nowe posty (Aktualności)

Edytuj `data/content.js` → tablica `news`.

Każdy post ma pola:
- `title`
- `date` (opcjonalnie)
- `image` (opcjonalnie; ścieżka do pliku w `zdjęcia/`)
- `tags` (opcjonalnie)
- `body`

## Jak dodać nowe plakaty

Edytuj `data/content.js` → `images.posters`.
