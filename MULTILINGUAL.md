# Farmer interface languages

The language selector is available on the Karnal, Haridwar and AgriFieldNet pages. **Automatic (study area)** uses Hindi for Karnal and Haridwar and English for the India-wide AgriFieldNet research dashboard. English, हिन्दी and தமிழ் can also be selected explicitly. The preference is stored in this browser and follows navigation between dashboards. Unavailable browser storage does not prevent changing language for the current page.

The Karnal farmer view translates its plot list, map layers and legends, timeline dates and freshness labels, field measurements, irrigation priorities/timing, prototype caveats and AI availability messages. Changing language preserves the selected role, period and underlying observations. Field identifiers, coordinates, numeric amounts, API contracts and downloaded data stay unchanged. Research reports, figures, source records and unknown external messages retain their original language. This is interface localization, not a new regional prediction model.

The existing study pages determine the automatic default; changing language never switches the geographical dataset. Research pages share the language preference for navigation, while their technical report content remains English.

`i18n-catalog.js` contains English/Hindi/Tamil rows. `i18n.js` manages preference validation, study-area defaults, placeholders and explicit `data-i18n` labels. It does not scan or machine-translate imported data. Add catalogue rows for new text and mark the authored UI label or call `t()` when rendering it. Keep stored option values and data keys independent of displayed text.

## Validation

```sh
npm run check:languages
npm run check:agrifieldnet
npm run test:languages:browser
```

The browser test requires Playwright and Microsoft Edge. If Playwright is available outside local `node_modules`, set `PLAYWRIGHT_MODULE` to its module path. The test serves the repository's real static dataset locally, deliberately returns an unavailable response for model inference, and checks Hindi/Tamil/English rendering, shared preference persistence, storage failure, unchanged records, map position and mobile layout. Screenshots are written to `test-output/` and are not deployment inputs.
