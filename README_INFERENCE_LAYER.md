# AgriSense Persistent AI Inference Layer

## Replace
- app.js
- server.js

## Add
- pipeline/inference_service.py
- pipeline/requirements_inference.txt
- private_models/README.md
- start_agrisense_with_ai.bat

## Copy from AI_Model_Artifacts into private_models/
- crop_engine__random_forest.joblib
- crop_type_label_encoder.joblib
- stress_engine__xgboost.joblib
- moisture_stress_label_encoder.joblib
- phenology_lstm.keras
- phenology_lstm_imputer.joblib
- phenology_lstm_scaler.joblib
- phenology_lstm_label_encoder.joblib
- phenology_lstm_metadata.json

Keep:
- data/karnal_real_temporal_table.csv

## Install
pip install -r pipeline/requirements_inference.txt
npm install

## Start
npm start

The Node server auto-starts the Python service on port 8001.

## Check
http://localhost:3000/api/inference/health
http://localhost:3000/api/inference/models

Expected health values once artifacts are copied:
- crop_ready: true
- phenology_ready: true
- stress_ready: true
- field_count: 4311
- period_count: 10

## UI
Agriculture Officer:
- sees detailed Crop RF / Phenology LSTM / Stress XGBoost output in field modal.

Farmer:
- sees simplified AI Field Assessment on the two assigned demo plots.

Irrigation Officer / WUA:
- live model card remains hidden so those interfaces stay water-focused.

## Important
The service genuinely runs the serialized trained artifacts. It does not reuse the old
hard-coded display labels. Current crop/stress targets and LSTM phenology targets are
still prototype/derived labels, so keep the existing validation disclaimer.
