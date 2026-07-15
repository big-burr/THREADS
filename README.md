# THREADS

Photo-based closet app. Snap your clothes, Claude tags them, pick a style + weather and get an outfit — all backed by your BAKER Obsidian vault.

## How it works

- **Connect vault**: picks your BAKER vault root folder via File System Access API (Chrome/Edge desktop). Creates `08-Closet/` inside it if it doesn't exist.
- **Add item**: take/upload a photo → Claude vision API tags it (category, color, style, season) → confirm/edit tags → saved as an entry appended to `08-Closet/<Category>.md`, photo stored in `08-Closet/images/`.
- **Pick an outfit**: choose a style vibe, type in the weather, hit the button. Claude reads your full closet inventory from the category files and picks one outfit using only items you actually own. The pick gets logged to `08-Closet/outfit-log/YYYY-MM-DD.md`.

## Vault structure

```
08-Closet/
  Pants.md
  Tees.md
  Sweaters.md
  Shoes.md
  images/
  outfit-log/
    2026-07-15.md
```

## Setup

1. Open the site (GitHub Pages or locally).
2. Click **connect vault**, select your BAKER vault root folder.
3. On first item add, you'll be prompted for an Anthropic API key — stored in `localStorage` only, never leaves your browser except to call the Anthropic API directly.

## Deployment

Same rules as BAKER: deploy via GitHub Desktop, bump `CACHE_VERSION` in `sw.js` on every push, hard-refresh after deploy.
