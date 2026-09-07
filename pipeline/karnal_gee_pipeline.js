/*************************************************************************************
 * KHARIF SEASON ANALYSIS-READY DATA (ARD) SCRIPT - TILED / NATIVE 10 m VERSION
 * Region  : Karnal District, Haryana, India
 * Season  : Kharif (Jun 1 - Oct 31)
 * Sources : Sentinel-2 (Optical) | Sentinel-1 (SAR) | SoilGrids/OpenLandMap (Soil)
 *           CHIRPS + ERA5-Land (Weather)
 *
 * WHAT THIS SCRIPT DOES
 * - Builds 16-day optical (Sentinel-2) and SAR (Sentinel-1) composites over
 *   Karnal district for the Kharif season, and merges them into a single
 *   14-band image per tile x period (11 optical bands + 3 SAR bands).
 * - Every period that has optical data is kept even if Sentinel-1 has no
 *   coverage for that window: missing SAR bands are filled with a -9999
 *   sentinel and the image is flagged with 'sar_available' (1 = real SAR,
 *   0 = sentinel fill). Check that property before trusting SAR values.
 * - Splits the district into a tile grid so every tile x period export stays
 *   under Drive's ~100 MB per-file guidance while keeping full native 10 m
 *   pixels (no downsampling).
 * - Exports go to Drive via Export.image.toDrive() / Export.table.toDrive()
 *   (async background tasks - not getDownloadURL(), which failed with
 *   "memory capacity exceeded" even on the small soil layer because it
 *   computes everything synchronously server-side).
 *
 * HOW TO USE
 * 1. Paste into the GEE Code Editor (https://code.earthengine.google.com).
 * 2. Set YEAR below. With EXPORT_ALL_PERIODS = true (the default) this
 *    queues Drive tasks for all 15 tiles x every 16-day period in one run -
 *    Drive tasks run in the background and don't expire.
 * 3. Run. The console prints the tile grid summary and total task count
 *    BEFORE any tasks are queued. Then go to the Tasks tab and click Run on
 *    each task.
 *************************************************************************************/

// =========================================================================
// 0. USER CONFIG
// =========================================================================

// --- Season / area ---
var YEAR = 2025;
var KHARIF_START = ee.Date.fromYMD(YEAR, 6, 1);
var KHARIF_END = ee.Date.fromYMD(YEAR, 10, 31);
var COMPOSITE_DAYS = 16;

// --- Tile sizing (native 10 m; grid is sized to a fixed tile count) ---
var TARGET_TILE_COUNT = 10; // number of tiles to divide the district bounding box into
var NATIVE_SCALE = 10;      // Sentinel-2 / Sentinel-1 native resolution (m)
var BYTES_PER_PIXEL = 4;    // float32 output (used for the informational size estimate only)

// --- Output ---
var EXPORT_FOLDER = 'Karnal_Kharif_ARD_Tiled_' + YEAR;
var EXPORT_APP_FEATURES = true;   // also write an app-compatible CSV for the local UI
var APP_FEATURE_SAMPLE_PIXELS = 5000;
var APP_FEATURE_DESCRIPTION = 'Karnal_Field_Features_' + YEAR;

// --- Cropland mask ---
// Restricts every export to actual farmland instead of the full district
// (which also includes towns, roads, water bodies, forest, etc). Uses ESA
// WorldCover (10 m, matches Sentinel-2/1 native resolution); class 40 =
// Cropland. Non-cropland pixels become nodata in the composites, the tiled
// exports, and the app feature samples - the AOI/tile grid shape itself is
// unchanged, only which pixels within it carry real data.
var MASK_TO_CROPLAND = true;
var WORLDCOVER_CROPLAND_CLASS = 40;

// --- Export scope ---
var EXPORT_ALL_PERIODS = true;   // true = every period, false = first period only (QA run)

// =========================================================================
// 1. AOI - KARNAL DISTRICT BOUNDARY
// =========================================================================
var districts = ee.FeatureCollection('FAO/GAUL/2015/level2');
var karnal = districts
  .filter(ee.Filter.eq('ADM1_NAME', 'Haryana'))
  .filter(ee.Filter.eq('ADM2_NAME', 'Karnal'));

var AOI = karnal.geometry();
Map.centerObject(AOI, 10);
Map.addLayer(AOI, {color: 'yellow'}, 'Karnal District AOI', true, 0.4);

// =========================================================================
// 2. OPTICAL PIPELINE - SENTINEL-2 SR HARMONIZED
// =========================================================================
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(AOI)
  .filterDate(KHARIF_START, KHARIF_END)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40));

var s2Clouds = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
  .filterBounds(AOI)
  .filterDate(KHARIF_START, KHARIF_END);

var s2WithCloud = ee.Join.saveFirst('cloud_mask').apply({
  primary: s2,
  secondary: s2Clouds,
  condition: ee.Filter.equals({leftField: 'system:index', rightField: 'system:index'})
});

function maskS2Clouds(img) {
  img = ee.Image(img);
  var cloudProb = ee.Image(img.get('cloud_mask')).select('probability');
  var isCloud = cloudProb.gt(40);
  var qa = img.select('QA60');
  var cirrusBit = 1 << 11;
  var qaMask = qa.bitwiseAnd(cirrusBit).eq(0);
  return img.updateMask(isCloud.not()).updateMask(qaMask)
    .divide(10000)
    .copyProperties(img, ['system:time_start']);
}

var s2Clean = ee.ImageCollection(s2WithCloud).map(maskS2Clouds);

function addOpticalIndices(img) {
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndmi = img.normalizedDifference(['B8', 'B11']).rename('NDMI');
  var evi = img.expression(
    '2.5 * ((NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1))', {
      NIR: img.select('B8'), RED: img.select('B4'), BLUE: img.select('B2')
    }).rename('EVI');
  var savi = img.expression(
    '((NIR - RED) / (NIR + RED + 0.5)) * 1.5', {
      NIR: img.select('B8'), RED: img.select('B4')
    }).rename('SAVI');
  return img.addBands([ndvi, ndwi, ndmi, evi, savi]);
}

var s2Indexed = s2Clean.map(addOpticalIndices);

// Builds one composite image per COMPOSITE_DAYS-day window between start/end.
function buildPeriodicComposites(collection, start, end, stepDays, bandSelection, reducer) {
  var nSteps = end.difference(start, 'day').divide(stepDays).ceil();
  var steps = ee.List.sequence(0, nSteps.subtract(1));
  return ee.ImageCollection(steps.map(function (i) {
    var periodStart = start.advance(ee.Number(i).multiply(stepDays), 'day');
    var periodEnd = periodStart.advance(stepDays, 'day');
    var img = collection.filterDate(periodStart, periodEnd).select(bandSelection);
    var composite = reducer === 'median' ? img.median() : img.mean();
    return composite
      .set('system:time_start', periodStart.millis())
      .set('period_start', periodStart.format('YYYY-MM-dd'));
  }));
}

var OPTICAL_BANDS = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12', 'NDVI', 'NDWI', 'NDMI', 'EVI', 'SAVI'];
var opticalComposites = buildPeriodicComposites(
  s2Indexed, KHARIF_START, KHARIF_END, COMPOSITE_DAYS, OPTICAL_BANDS, 'median'
).map(function (img) { return img.clip(AOI); });

print('Optical 16-day composites:', opticalComposites.size());

// =========================================================================
// 3. SAR PIPELINE - SENTINEL-1 GRD (IW, VV+VH)
// =========================================================================
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(AOI)
  .filterDate(KHARIF_START, KHARIF_END)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
  .select(['VV', 'VH']);

function speckleFilter(image) {
  var kernel = ee.Kernel.square({radius: 3, units: 'pixels'});
  var filtered = image.focalMedian({kernel: kernel, iterations: 1});
  return filtered.copyProperties(image, ['system:time_start']);
}
var s1Filtered = s1.map(speckleFilter);

// Small epsilon avoids Infinity/NaN in VV/VH when VH is 0.
var SAR_RATIO_EPSILON = 1e-6;
function addSarRatio(img) {
  var ratio = img.select('VV').divide(img.select('VH').add(SAR_RATIO_EPSILON)).rename('VV_VH_ratio');
  return img.addBands(ratio);
}
var s1Indexed = s1Filtered.map(addSarRatio);

var SAR_BANDS = ['VV', 'VH', 'VV_VH_ratio'];
var sarComposites = buildPeriodicComposites(
  s1Indexed, KHARIF_START, KHARIF_END, COMPOSITE_DAYS, SAR_BANDS, 'median'
).map(function (img) { return img.clip(AOI); });

print('SAR 16-day composites:', sarComposites.size());

// =========================================================================
// 3b. COMBINE SATELLITE SOURCES - OPTICAL + SAR INTO ONE STACK PER PERIOD
// =========================================================================
// Every period with an optical composite is kept (optical is the primary
// collection in the join) and matched against SAR by 'period_start'. If a
// period has no SAR match, its 3 SAR bands are filled with the -9999
// sentinel instead of dropping the period, and 'sar_available' records
// which case applies (1 = real SAR, 0 = sentinel fill).
var SAR_SENTINEL_VALUE = -9999;
var sarSentinelImage = ee.Image.constant(SAR_BANDS.map(function () { return SAR_SENTINEL_VALUE; }))
  .rename(SAR_BANDS)
  .clip(AOI);

var periodJoinFilter = ee.Filter.equals({leftField: 'period_start', rightField: 'period_start'});

var opticalWithSarJoin = ee.ImageCollection(ee.Join.saveFirst('sar_match').apply({
  primary: opticalComposites,
  secondary: sarComposites,
  condition: periodJoinFilter
}));

var combinedComposites = ee.ImageCollection(opticalWithSarJoin.map(function (img) {
  img = ee.Image(img);
  // saveFirst only sets 'sar_match' on images that found a match, so
  // checking for the property (rather than testing for null) correctly
  // detects a missing period.
  var hasSarMatch = img.propertyNames().indexOf('sar_match').neq(-1);

  var sarImg = ee.Image(ee.Algorithms.If({
    condition: hasSarMatch,
    trueCase: ee.Image(img.get('sar_match')),
    falseCase: sarSentinelImage
  }));

  return img.addBands(sarImg)
    .copyProperties(img, ['system:time_start', 'period_start'])
    .set('sar_available', hasSarMatch);
}));

var sarAvailableCount = combinedComposites.filter(ee.Filter.eq('sar_available', 1)).size();
print('Combined optical+SAR composites (all optical periods kept):', combinedComposites.size());
print('...of which periods have real SAR data (sar_available = 1):', sarAvailableCount);
print('...periods using the -9999 SAR sentinel fill (sar_available = 0):',
  combinedComposites.size().subtract(sarAvailableCount));

// =========================================================================
// 3c. CROPLAND MASK - RESTRICT TO ACTUAL FARMLAND
//     Applied to every composite before app-feature sampling and tiled
//     export, so non-cropland pixels (built-up, roads, water, forest,
//     barren) come back as nodata everywhere downstream instead of the
//     full district footprint. sar_available stays intact per image since
//     masking only affects pixel values, not image properties.
// =========================================================================
if (MASK_TO_CROPLAND) {
  var worldCover = ee.ImageCollection('ESA/WorldCover/v200').first();
  var croplandMask = worldCover.select('Map').eq(WORLDCOVER_CROPLAND_CLASS).clip(AOI);
  Map.addLayer(croplandMask.selfMask(), {palette: ['3ade3a']}, 'Cropland Mask (WorldCover)', false);

  combinedComposites = ee.ImageCollection(combinedComposites.map(function (img) {
    return ee.Image(img).updateMask(croplandMask);
  }));
}

// =========================================================================
// 3d. APP FEATURE EXPORT
//     The tiled GeoTIFFs are the analysis-ready archive. This small table is
//     the hand-off consumed by csv_to_geojson.py and the Leaflet UI. It
//     samples the first valid period so the app can render field-level
//     points immediately while the full ARD tiles remain in Drive.
// =========================================================================
if (EXPORT_APP_FEATURES) {
  var appFeatureImage = ee.Image(combinedComposites.first());
  var appFeatureSamples = appFeatureImage
    .select(['NDVI', 'NDWI', 'NDMI', 'EVI', 'SAVI', 'VV', 'VH', 'VV_VH_ratio'])
    .sample({
      region: AOI,
      scale: NATIVE_SCALE,
      numPixels: APP_FEATURE_SAMPLE_PIXELS,
      geometries: true,
      tileScale: 4
    })
    .map(function (feature) {
      var coordinates = feature.geometry().coordinates();
      var ndvi = ee.Number(feature.get('NDVI'));
      var ndmi = ee.Number(feature.get('NDMI'));
      var stressScore = ee.Number(1).subtract(ndmi.max(0)).max(0).min(1);
      return feature.set({
        field_id: ee.String('GEE-PIXEL-').cat(feature.id()),
        longitude: coordinates.get(0),
        latitude: coordinates.get(1),
        crop_type: ee.Algorithms.If(ndvi.gt(0.65), 'Paddy (Rice)', 'Unclassified'),
        growth_stage: ee.Algorithms.If(ndvi.lt(0.25), 'Sowing/Planting',
          ee.Algorithms.If(ndvi.lt(0.55), 'Vegetative', 'Flowering')),
        moisture_stress: ee.Algorithms.If(stressScore.gt(0.7), 'Severe Stress',
          ee.Algorithms.If(stressScore.gt(0.45), 'Moderate Stress', 'Mild Stress')),
        stress_score: stressScore,
        water_deficit_mm: stressScore.multiply(40),
        recommended_depth_mm: stressScore.multiply(50),
        canal_priority_score: stressScore.multiply(9).add(1),
        sar_available: appFeatureImage.get('sar_available')
      });
    });

  Export.table.toDrive({
    collection: appFeatureSamples,
    description: APP_FEATURE_DESCRIPTION,
    folder: EXPORT_FOLDER,
    fileNamePrefix: APP_FEATURE_DESCRIPTION,
    fileFormat: 'CSV'
  });
  print('App feature table export queued:', APP_FEATURE_DESCRIPTION);
}

// =========================================================================
// 4. SOIL LAYERS (STATIC - 250 m native, district-wide, NOT tiled)
// =========================================================================
var soilTexture = ee.Image('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02')
  .select('b0').rename('soil_texture_class');
var bulkDensity = ee.Image('OpenLandMap/SOL/SOL_BULKDENS-FINEEARTH_USDA-4A1H_M/v02')
  .select('b0').rename('bulk_density');
var organicCarbon = ee.Image('OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02')
  .select('b0').rename('organic_carbon');
var waterContent = ee.Image('OpenLandMap/SOL/SOL_WATERCONTENT-33KPA_USDA-4B1C_M/v01')
  .select('b0').rename('field_capacity');

var soilStack = soilTexture
  .addBands(bulkDensity)
  .addBands(organicCarbon)
  .addBands(waterContent)
  .clip(AOI);

// =========================================================================
// 5. WEATHER ARD (district-wide, NOT tiled - CHIRPS ~5 km, ERA5-Land ~11 km)
// =========================================================================
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterBounds(AOI).filterDate(KHARIF_START, KHARIF_END);
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
  .filterBounds(AOI).filterDate(KHARIF_START, KHARIF_END);

function buildWeatherComposite(periodStart, periodEnd) {
  var rain = chirps.filterDate(periodStart, periodEnd).sum().rename('rainfall_mm');
  var tmax = era5.filterDate(periodStart, periodEnd)
    .select('temperature_2m_max').mean().subtract(273.15).rename('tmax_C');
  var tmin = era5.filterDate(periodStart, periodEnd)
    .select('temperature_2m_min').mean().subtract(273.15).rename('tmin_C');
  var dewpoint = era5.filterDate(periodStart, periodEnd)
    .select('dewpoint_temperature_2m').mean().subtract(273.15).rename('dewpoint_C');
  var et0Proxy = era5.filterDate(periodStart, periodEnd)
    .select('potential_evaporation_sum').sum().abs().multiply(1000).rename('ET0_mm_proxy');
  return rain.addBands([tmax, tmin, dewpoint, et0Proxy])
    .set('system:time_start', periodStart.millis())
    .set('period_start', periodStart.format('YYYY-MM-dd'));
}

var weatherSteps = KHARIF_END.difference(KHARIF_START, 'day').divide(COMPOSITE_DAYS).ceil();
var weatherComposites = ee.ImageCollection(
  ee.List.sequence(0, weatherSteps.subtract(1)).map(function (i) {
    var periodStart = KHARIF_START.advance(ee.Number(i).multiply(COMPOSITE_DAYS), 'day');
    var periodEnd = periodStart.advance(COMPOSITE_DAYS, 'day');
    return buildWeatherComposite(periodStart, periodEnd);
  })
).map(function (img) { return img.clip(AOI); });

// District-wide soil + weather exports (small - no tiling needed).
Export.image.toDrive({
  image: soilStack.toFloat(),
  description: 'Karnal_Soil_Stack_Static',
  folder: EXPORT_FOLDER,
  region: AOI,
  scale: 250,
  maxPixels: 1e10,
  fileFormat: 'GeoTIFF'
});
Export.image.toDrive({
  image: ee.Image(weatherComposites.first()).toFloat(),
  description: 'Karnal_Weather_Period1_' + YEAR,
  folder: EXPORT_FOLDER,
  region: AOI,
  scale: 5000,
  maxPixels: 1e10,
  fileFormat: 'GeoTIFF'
});

// =========================================================================
// 6. TILE GRID CONSTRUCTION
//    The district bounding box is divided into a grid sized to land close
//    to TARGET_TILE_COUNT tiles (the final count can end up a bit lower
//    once corner tiles that don't intersect the district are dropped).
// =========================================================================
var combinedBandCount = OPTICAL_BANDS.length + SAR_BANDS.length; // 11 + 3 = 14

// AOI centroid latitude, used to convert between meters and degrees.
var centroid = AOI.centroid(1).coordinates().getInfo();
var centerLat = centroid[1];

// AOI bounding box (client-side numbers, needed to build the grid).
var boundsCoords = AOI.bounds(1).coordinates().getInfo()[0];
var lons = boundsCoords.map(function (c) { return c[0]; });
var lats = boundsCoords.map(function (c) { return c[1]; });
var minLon = Math.min.apply(null, lons);
var maxLon = Math.max.apply(null, lons);
var minLat = Math.min.apply(null, lats);
var maxLat = Math.max.apply(null, lats);

// Solve tile side from the bounding box area so the grid divides it into
// roughly TARGET_TILE_COUNT tiles.
var bboxWidthMeters = (maxLon - minLon) * 111320 * Math.cos(centerLat * Math.PI / 180);
var bboxHeightMeters = (maxLat - minLat) * 111320;
var bboxAreaSqMeters = bboxWidthMeters * bboxHeightMeters;
var tileSideMeters = Math.sqrt(bboxAreaSqMeters / TARGET_TILE_COUNT);

// Convert tile side (meters) to degrees using the AOI centroid latitude.
var tileSideDegLat = tileSideMeters / 111320;
var tileSideDegLon = tileSideMeters / (111320 * Math.cos(centerLat * Math.PI / 180));

// Build candidate grid cells covering the bounding box.
var tileFeatures = [];
var tileId = 0;
for (var lon = minLon; lon < maxLon; lon += tileSideDegLon) {
  for (var lat = minLat; lat < maxLat; lat += tileSideDegLat) {
    var cell = ee.Geometry.Rectangle(
      [lon, lat, lon + tileSideDegLon, lat + tileSideDegLat], null, false
    );
    tileFeatures.push(ee.Feature(cell, {tile_id: tileId}));
    tileId += 1;
  }
}
var tileGridFC = ee.FeatureCollection(tileFeatures);

// Keep only tiles that actually intersect Karnal district (drops empty corners).
var tilesInAOI = tileGridFC.filterBounds(AOI);

// Pull tile geometries client-side in ONE call, then derive the count from
// that same payload instead of a second .size().getInfo() round trip.
var tilesGeoJSON = tilesInAOI.getInfo();
var tileGeometries = tilesGeoJSON.features.map(function (f) {
  return ee.Geometry(f.geometry);
});
var tileCount = tileGeometries.length;

// Visualize the grid.
Map.addLayer(tilesInAOI.style({color: 'red', fillColor: '00000000', width: 1}),
  {}, 'Export Tile Grid');

// Size estimate printout (deterministic, no extra getInfo calls).
var tileAreaSqKm = (tileSideMeters * tileSideMeters) / 1e6;
var pixelsPerTileSide = tileSideMeters / NATIVE_SCALE;
var estCombinedMB = (pixelsPerTileSide * pixelsPerTileSide * BYTES_PER_PIXEL * combinedBandCount) / (1024 * 1024);
print('--- TILE GRID SUMMARY ---');
print('Target tile count:', TARGET_TILE_COUNT);
print('Tile side (approx):', (tileSideMeters / 1000).toFixed(2), 'km');
print('Tile area (approx):', tileAreaSqKm.toFixed(1), 'sq km');
print('Tiles covering Karnal district:', tileCount);
print('Est. size per tile - Combined optical+SAR (' + combinedBandCount + ' bands, 10 m):',
  estCombinedMB.toFixed(1), 'MB');

// =========================================================================
// 7. TILED EXPORTS - NATIVE 10 m, EACH TILE < 100 MB
//    One combined optical+SAR file per tile x period.
// =========================================================================
// period_start values are deterministic 16-day windows from KHARIF_START to
// KHARIF_END, so they're computed here with plain client-side date math
// instead of combinedComposites.aggregate_array(...).getInfo(). Pulling this
// list via getInfo() forces EE to fully evaluate the joined/conditional
// combinedComposites collection synchronously server-side before returning
// anything - the same "Earth Engine memory capacity exceeded" failure mode
// noted for getDownloadURL() in the header, just triggered by a different
// synchronous call. This produces the identical set of period_start strings
// without evaluating that collection at all.
function buildPeriodStartStrings(start, end, stepDays) {
  var totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  var nSteps = Math.ceil(totalDays / stepDays);
  var starts = [];
  for (var i = 0; i < nSteps; i++) {
    var d = new Date(start.getTime() + i * stepDays * 86400000);
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    starts.push(d.getUTCFullYear() + '-' + mm + '-' + dd);
  }
  return starts;
}

var kharifStartJS = new Date(Date.UTC(YEAR, 5, 1));   // matches ee.Date.fromYMD(YEAR, 6, 1)
var kharifEndJS = new Date(Date.UTC(YEAR, 9, 31));    // matches ee.Date.fromYMD(YEAR, 10, 31)
var periodStartsList = buildPeriodStartStrings(kharifStartJS, kharifEndJS, COMPOSITE_DAYS);
var periodsToExport = EXPORT_ALL_PERIODS ? periodStartsList : [periodStartsList[0]];

print('--- COMPLETE-REGION RUN ---');
print('Periods in this run:', periodsToExport.length, 'of', periodStartsList.length, 'total Kharif periods');
print('Tiles covering Karnal district:', tileCount);
print('Total Drive tasks this run will queue:', periodsToExport.length * tileCount);

periodsToExport.forEach(function (dateStr) {
  var combinedImg = ee.Image(combinedComposites.filter(ee.Filter.eq('period_start', dateStr)).first());

  tileGeometries.forEach(function (tileGeom, idx) {
    Export.image.toDrive({
      image: combinedImg.clip(tileGeom).toFloat(),
      description: 'Karnal_ARD_' + dateStr + '_tile' + idx,
      folder: EXPORT_FOLDER,
      region: tileGeom,
      scale: NATIVE_SCALE,
      maxPixels: 1e9,
      fileFormat: 'GeoTIFF'
    });
  });
});

print('Export tasks queued for period(s):', periodsToExport);
print('Tasks per period: tiles x 1 combined optical+SAR file =', tileCount);
print('Total tasks queued this run:', periodsToExport.length * tileCount);
print('Go to the Tasks tab to run/monitor each export.');

/*************************************************************************************
 * NOTES
 * - EXPORT_ALL_PERIODS = true (default) queues ALL 15 tiles for EVERY
 *   16-day period in a single run - the complete region, complete season,
 *   in one go. With 15 tiles x 10 periods that's ~150 tasks queued to the
 *   Tasks tab.
 * - Drive tasks run in the background and don't expire - queue them all and
 *   run each task (or "Run all") in the Tasks tab whenever convenient.
 * - EXPORT_ALL_PERIODS = false gives a single-period, complete-region QA
 *   run (15 tasks) to confirm everything works before committing to the
 *   full run.
 * - Every tile export uses NATIVE_SCALE = 10 m - nothing is downsampled.
 *   Tile count is fixed at TARGET_TILE_COUNT rather than solved from a file
 *   size cap, so check the printed "Est. size per tile" figure - lower
 *   TARGET_TILE_COUNT (more, smaller tiles) if a Drive task comes back
 *   oversized.
 * - Soil and weather layers are exported once, district-wide, since their
 *   native resolution (250 m to ~11 km) keeps them well under 100 MB even
 *   for the full district.
 * - combinedComposites keeps EVERY period that has optical data (section 3b)
 *   even if Sentinel-1 has zero passes for that window. Missing SAR bands
 *   are filled with -9999 and flagged via 'sar_available' (0 = sentinel
 *   fill, 1 = real SAR) - filter on that property before trusting SAR
 *   values, or to exclude sentinel-filled periods from SAR-dependent
 *   analysis.
 *************************************************************************************/