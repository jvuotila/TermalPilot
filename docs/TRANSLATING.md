# Translating ThermalPilot

The panel and both dashboard cards share language catalogs in
`custom_components/thermal_pilot/frontend/languages/`. Each supported language has
its own UTF-8 JSON file using its language code: `fi.json` for Finnish, `en.json`
for English, `sv.json` for Swedish, and so on. The shared `localization.js` loader
fetches only the selected language, caches it for the panel and cards, and carries
the frontend version into the JSON request. Missing files or translations fall
back to English. Card language overrides still work independently of the
integration language.

Each file contains `language`, `name`, `messages`, `legacy`, and `cardMessages`.
Add or correct complete sentences in `messages`, keeping placeholders such as
`{heating}`, `{idle}`, and `{days}` unchanged. `legacy` retains existing panel
label substitutions; `cardMessages` retains the existing compact card labels.
The cards check `cardMessages` first, then `messages` and `legacy`. New shared
phrases should go in `messages` so they do not need to be copied between cards.
Do not translate room names, entity IDs, JSON keys, or placeholders.

For example, the Finnish model tooltip is stored as one complete message:

```json
{
  "{heating} observed heating hours; {idle} idle hours. Enough observations do not by themselves prove accuracy.": "Havaittua lämmitystä {heating} tuntia; lepoa {idle} tuntia. Riittävä havaintomäärä ei yksin takaa ennusteiden tarkkuutta."
}
```

Home Assistant's integration setup flow keeps its native `strings.json` and
`translations/en.json` files; these are separate from the panel/card catalogs.
Offline previews embed the same JSON catalogs so they also work without a server.
Run `node tests/test_localization.cjs` and the existing frontend tests after editing
translations. CI covers catalog loading, caching, versioned URLs, placeholders,
English fallback, and the panel/card language selectors.
