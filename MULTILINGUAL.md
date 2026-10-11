# Farmer interface languages

The language selector is available on the Karnal, Haridwar, AgriFieldNet and soil-moisture pages. **Automatic (study area)** uses Hindi for Karnal and Haridwar and English for the India-wide AgriFieldNet and US soil-moisture research dashboards. The preference is stored in this browser and follows navigation between dashboards. Unavailable browser storage does not prevent changing language for the current page.

English remains available alongside ten Indian languages, chosen by the 2011 Census ranking of scheduled languages by mother-tongue speakers: Hindi (हिन्दी), Bengali (বাংলা), Marathi (मराठी), Telugu (తెలుగు), Tamil (தமிழ்), Gujarati (ગુજરાતી), Urdu (اردو), Kannada (ಕನ್ನಡ), Odia (ଓଡ଼ିଆ) and Malayalam (മലയാളം). This is a documented selection basis, not a claim about current speaker counts. [Census Statement 4](https://censusindia.gov.in/nada/index.php/catalog/42458/download/46089/C-16_25062018.pdf).

Urdu uses right-to-left translated text while maps, scientific charts, timelines and English research retain their original direction. Native names have explicit language/direction attributes. System font fallbacks support the scripts without a translation service or additional network font dependency.

The Karnal farmer view translates its plot list, map layers and legends, timeline dates and freshness labels, field measurements, irrigation priorities/timing, prototype caveats and AI availability messages. Changing language preserves the selected role, period and underlying observations. Field identifiers, coordinates, numeric amounts, API contracts and downloaded data stay unchanged. Research reports, figures, source records and unknown external messages retain their original language. This is interface localization, not a new regional prediction model.

The existing study pages determine the automatic default; changing language never switches the geographical dataset. Research pages share the language preference for navigation, while their technical report content remains English.

`i18n-catalog.js` contains the original English/Hindi/Tamil rows. `i18n-regional.js` contains the eight additional authored catalogues, each covering the same 155 interface strings. Its fixed English key list is independent of the original catalogue's order. Add new strings to both catalogues and their translations; tests enforce identical key coverage and placeholder parity. `i18n.js` owns the language registry, builds all selectors from it, and manages preference validation, study-area defaults, placeholders and explicit `data-i18n` labels. It does not scan or machine-translate imported data. Mark authored UI labels or call `t()` when rendering them. Keep stored option values and data keys independent of displayed text.

## Validation

```sh
npm run check:languages
npm run check:agrifieldnet
npm run test:languages:browser
```

The browser test requires Playwright and Microsoft Edge. If Playwright is available outside local `node_modules`, set `PLAYWRIGHT_MODULE` to its module path. The test serves the repository's real static dataset locally, deliberately returns an unavailable response for model inference, and checks all eleven language choices, shared preference persistence, storage failure, unchanged records, map position, Urdu direction and mobile layout. Every study page is checked for matching selectors and translated navigation. `LANGUAGE_TEST_BASE_URL` optionally targets a deployed site. Screenshots are written to `test-output/` and are not deployment inputs. Automated checks cover completeness and behavior; they do not represent native-speaker review.
