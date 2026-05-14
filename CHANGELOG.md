```
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │   ▄▀█ █▀▄▀█ ▄▀█  ░░ CHANGELOG ░░  v1.0.0 ░ tokyonight        │
 │   █▀█ █░▀░█ █▀█                                              │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
```

> `> ama_` // ask me anything · talk to any website
>
> All notable changes to this project will be documented in this file.
> Format loosely follows [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

---

## [1.0.0] — 2026-05-14

```
╔═══════════════════════════════════════════════════════════════╗
║  >> MAJOR RELEASE  ::  THE RETRO REDESIGN                     ║
║  PROV: tokyonight     THEME: phosphor // paper                ║
╚═══════════════════════════════════════════════════════════════╝
```

### Added
- **`> ama_` brand identity.** New wordmark with blinking phosphor cursor. The old plain-text title is gone; everything reads like a serial terminal.
- **Extension icons redrawn.** `icon16` is a chunky `>_` (legible in the toolbar). `icon48` / `icon128` carry the full `>ama▌` mark in green + cyan on phosphor dark. Store masters at 256 + 512 saved to `store-assets/`. Generated via `JetBrainsMono-Bold` rasterized in Pillow with a Gaussian glow pass.
- **`[cfg]` settings affordance.** The gear SVG in the sidepanel header is gone — replaced by `[cfg]` text, matching the bracket idiom used by the mode pills.
- **`>` input prompt.** Input area prefix changed from `$` to `>` so the chrome reads consistently with the header `> ama_` mark.
- **CRT terminal sidepanel.** Mono-spaced everywhere, ASCII frames, scanline overlay, vignette, soft phosphor glow on accent text. Tokyonight Storm palette.
- **Light theme (Tokyonight Day).** Switchable from the dashboard, applies **instantly** to an open sidepanel — no Save click needed. Same CRT layout, ink-on-paper colors, dimmed scanlines.
- **System theme fallback.** First-time users with no stored preference get `prefers-color-scheme` honored (both inline boot script + `theme.js` agree on this default).
- **Dashboard upgrade (`options.html`).** Full CRT restyle. Now shows current version pulled from `manifest.json` (kept in lockstep with `package.json`) and a theme picker with live palette swatches.
- **`theme.js` bootstrap.** Sub-paint theme load via `localStorage` mirror + `chrome.storage.local` source of truth. Theme changes propagate to any open extension page via `storage.onChanged` — no reload.
- **`CHANGELOG.md`** — this file. You are here.

### Changed
- **Sidepanel typography.** System sans → JetBrains Mono (fallback to system mono). All labels lowercase or `ALL CAPS` per CRT idiom.
- **Pills + buttons.** Rounded chips → square monospace buttons. Active pill is a solid phosphor block.
- **User messages.** Speech bubbles → terminal prompt lines (`>` + yellow text). Assistant lines start with `*` + orange.
- **Sources block.** Now a tree (`↳`) under a dashed divider. Excerpts are blockquoted with a left border.
- **Site bar / provider bar.** Labelled with `CONN` and `PROV:` prefixes. Connection dot now squared with a soft glow.
- **Empty state.** Says `[ READY ]` before the prompt copy.
- **Dashboard "Save" button** now only persists the provider — theme is committed on click of the swatch (matches OS-style theme pickers).

### Removed
- `chrome/manifest_v2.json` — dead MV2 fallback. Had no `side_panel`, no `options_ui` icon, no `host_permissions`; nothing referenced it.
- `store-assets/screenshot-1.png` … `screenshot-5.png` (old design) — replaced with fresh `screenshot-1.png` … `screenshot-4.png` at the Chrome Web Store-required **1280×800**, source caps scaled proportionally (no distortion), bg padded with the panel's own sampled color so the framing blends.

### Provider robustness
- **ChatGPT**: `oai-device-id` is now a stable, persisted UUID (`chrome.storage.local._oaiDeviceId`) instead of a fresh `crypto.randomUUID()` per request. Fresh device-ids on every call are one of OpenAI's top anti-bot signals; persisting drops 403 frequency substantially.
- **Gemini**: `callGeminiWeb` now detects "stub" responses (empty or short fragments without terminal punctuation) and throws an actionable error instead of silently returning `"Based on"` or letting `JSON.parse` fail with `Unterminated string at position 2`. On suspicious responses it dumps the *full* raw API payload to the SW console so the actual block reason can be inspected.
- **All providers**: `callLLMJson` wraps `JSON.parse` and surfaces `<provider> returned non-JSON output: "…"` with a preview, instead of native `SyntaxError`.

### Polish
- Settings button (`[cfg]`) got `aria-label="Settings"` for screen readers.
- Provider login button label tracks state — **`log in`** when signed out, **`sign out`** when signed in. `title` attribute explains the click action ("opens chatgpt — use the account menu there to sign out"). Catch path resets both label and title.
- Icons now include **96 px** in both manifests — `about:debugging` in Firefox prefers that size for its panel column.
- Theme bootstrap respects `prefers-color-scheme` when no stored value exists.
- `color-scheme: dark` / `light` on `:root` so native `<select>` popovers and scrollbars render in theme instead of OS-light.

### Build / tooling
- `scripts/build-store-assets.py` — single command regenerates extension icons (16/48/96/128), store-listing masters (128/256/512), and frames new screenshots to 1280×800 with sampled bg. Reusable for future icon tweaks.

### Bumped
- `package.json`, `chrome/manifest.json`, `firefox/manifest.json` → **1.0.0**

```
█▓▒░  end of release ░▒▓█
```

---

## [0.3.1] — prior

### Added
- Firefox toolbar button to toggle the sidebar.
- Store banner image; README polish.
- LICENSE, `package.json`, README badges.

### Changed
- README rewritten around problem-first framing; six modes documented.
- Privacy policy added for Chrome Web Store submission.

---

## [0.3.0] — prior

- Firefox extension shipped; data-collection permissions declared; all `innerHTML` paths removed for Mozilla review.
- Compare mode redesign.
- Direct HTTP provider transport (no native messaging hop).

---

## [0.2.0] — prior

- Research mode (default): multi-page crawl + synthesis.
- Per-site conversations: each site gets its own preserved thread.
- Auto-inject content script.
- Side panel UI with session-based providers, mode pills, site search.

---

## [0.1.0] — initial POC

- WeAreAsking → renamed to **AMA**.
- Multi-phase crawl pipeline with JSON-forced LLM output.
- English-only source labels; first working sidepanel.

```
EOF · v1.0.0 · 2026-05-14
```
