# Soil Moisture Forecasting with Probabilistic Graphical Models

**Aim:** compare probabilistic models of soil moisture, quantify predictive uncertainty, and assess transfer between sites and robustness to sensor failures.

**Problem statement:** Soil moisture changes across time, depth and location. Sensor gaps and drift can undermine point predictions. Can temporal dependence, hidden regimes and bounded predictive distributions improve forecasting over persistence on held-out stations and years?

This notebook presents completed NOAA USCRN, USDA SCAN and USDA-ARS sunflower experiments. It documents variables, assumptions, fitted CPDs, inference, learning and results. It evaluates predictions; it does not claim irrigation action effects or water savings.

**How to run:** upload this file to Google Colab and select **Runtime → Run all**. Upload this notebook together with `Soil_Moisture_PGM_Final_Evidence.zip`. The notebook auto-detects the companion ZIP; no data-path edits are required. Package installation needs an internet connection.

**Reproducibility:** clean-test metrics and figures are recalculated from completed row-level predictions; all ten daily families are refitted on a documented representative training fold, and the sunflower comparison is refitted in full. The completed daily hyperparameter/corruption sweeps are retained as recorded evidence rather than repeated on each run. Saved results and newly executed checks are identified separately.

## 1. Hypotheses and expected evidence
These hypotheses organize the completed analysis and are **not presented as preregistered**.

| ID | Hypothesis | Evaluation |
|---|---|---|
| H1 | Temporal PGMs improve on persistence. | Held-out station–year RMSE/MAE; paired selected-pipeline MAE differences with block-bootstrap intervals. |
| H2 | State propagation tolerates missing observations better than direct prediction. | Identical recurring 7-/30-day outages and gradual ±0.03 m³/m³ drift. |
| H3 | Bounded emissions eliminate physically impossible predictive mass. | Probability outside [0,1], with accuracy and interval coverage reported separately. |
| H4 | Low-moisture probabilities discriminate events when both classes occur. | Class-support audit, Brier score and average precision; no discrimination claim for single-class groups. |
| H5 | Realized interval forcing improves sunflower endpoint estimates. | Leave-treatment-out, future-year conditional prediction against persistence. |

For H1, a negative model-minus-persistence MAE difference favors the model. Test-set family rankings are descriptive; model choice uses inner validation. More complex models are not assumed to win.

## 3. Measured variables and data quality
NOAA uses three stations in 2016–2024; SCAN uses six stations in 2016–2025. The networks are evaluated separately. SCAN sensors at 2, 8 and 20 inches correspond to approximately 5.08, 20.32 and 50.8 cm; the shared names below approximate these depths.

| Variable / node | Meaning | Domain and unit |
|---|---|---|
| $Y_t$, `sm20` | Mid-depth volumetric moisture | [0,1], m³/m³; prediction target |
| `sm5`, `sm50` | Shallow/deep moisture | [0,1], m³/m³ |
| $P_t$, `rain` | Daily precipitation | Nonnegative mm/day |
| $T_t$, `temp` | Daily mean air temperature | °C |
| $X_t$ | (`sm20`, `sm5`, `sm50`, `rain`, `temp`) | Five continuous observed variables |
| $h$ | Lead time | 1, 3, 7 days |

Station and date identify sequences; they are not fitted categorical predictors. Daily hindcasts assume complete day-$t$ summaries are available before the next-day forecast. Operational reporting delays were not tested. No realized future weather enters the daily model inputs.

## 4. Evaluation design and learning
For outer test year $Y$, fit through $Y-2$, calibrate on $Y-1$, and test on $Y$. Inner validation uses $Y-4$ and $Y-3$, each fitted on earlier years. The held-out station is excluded from fitting, tuning and calibration; its observed past is allowed for filtering. Medians, scales, bins and the pooled 20th-percentile event threshold are training-derived.

| Parameter | Evaluated values |
|---|---|
| BN / DBN lags | 1, 3 |
| Ridge penalty | 0.01, 1.0 |
| HMM / logit-HMM state count | 2, 3 |
| Kalman / IMM observation SD | 0.002, 0.01 m³/m³ |
| IMM assignment / regimes | Soft or hard; two regimes; three GMM starts |
| Beta CPD | One lag; tree depth 1 or 2; 60 boosting estimators |

HMM inner/final fits use 12/30 EM iterations; final fitting compares two fixed initialization seeds. The inner objective averages station/horizon RMSE. Graphs are specified in advance: this is parameter learning, not causal structure discovery.

Probability calibration uses logistic regression on logit probabilities when the calibration partition has at least ten observations of each class. Otherwise raw probabilities remain. Nominal 90% intervals expand using a calibration residual quantile. Temporal dependence and site shift limit coverage guarantees; empirical coverage and width must be checked.

## 5. Models: nodes, states, CPDs and fitted inference
Each subsection pairs its implementation with fitted parameters and a worked prediction. The example is NOAA fold **Y2024__TX_Bronte_11_NNE**, trained through 2022, at a three-day lead. Blue squares are observed variables; orange circles are latent variables. Vector nodes expand into the feature/lag variables listed in the accompanying table. These examples illustrate inference and do not select a test-set winner.

### 5.1 Persistence

**Nodes:** observed $Y_t$ and future continuous $Y_{t+h}$; no latent state. Missing history is forward-filled for at most three days, then uses the training median.

**CPD:** $Y_{t+h}\mid Y_t\sim\mathcal N(Y_t,\sigma_h^2)$, with horizon-specific training error variance.

**Expected:** strong short-horizon performance from moisture persistence; abrupt wetting and long outages can defeat it.

### 5.2 Seasonal climatology

**Nodes:** calendar month $M_{t+h}\in\{1,\ldots,12\}$ and continuous $Y_{t+h}$; no latent variable.

**CPD:** $Y_{t+h}\mid M_{t+h}=m\sim\mathcal N(\mu_m,\sigma_m^2)$. Parameters pool training stations.

**Expected:** capture seasonality, but miss local rainfall responses and station-specific moisture levels.

### 5.3 Markov chain

**States:** observed discretized moisture $B_t\in\{0,1,2\}$: lower, middle and upper training terciles. These are relative bins, not crop-stress labels. Continuous future moisture is represented by a Gaussian emission for each bin.

**CPD:** $P(B_{t+h}\mid B_t)=T^h$; $p(y)=\sum_k w_k\mathcal N(y;\mu_k,\sigma_k^2)$.

**Expected:** interpretable persistence between regimes, with accuracy limited by discretization.

### 5.4 Gaussian BN

**Nodes:** every observed feature in $X_t,\ldots,X_{t-L+1}$ and target $Y_{t+h}$: $5L$ continuous parents and one child. No hidden states. A separate conditional model is fitted at each horizon; parent joint densities are not estimated.

**CPD:** $Y_{t+h}\mid x\sim\mathcal N(\beta_{0,h}+\beta_h^\top\operatorname{scale}(x),\sigma_h^2)$.

**Expected:** use lagged cross-depth/weather associations; linearity and site shift can limit transfer.

### 5.5 Gaussian DBN

**State:** $S_t=[X_t,\ldots,X_{t-L+1}]\in\mathbb R^{5L}$. The first five variables are moisture at three depths, rain and temperature; older lag components shift deterministically. Available measurements condition the state. Missing components retain propagated uncertainty.

**CPD:** $S_{t+1}\mid S_t\sim\mathcal N(b+AS_t,Q)$. New-slice innovations have diagonal covariance; lag shifts have zero innovation.

**Expected:** propagate multivariate information through gaps. This statistical weather/moisture system does not impose a physical water balance.

### 5.6 Gaussian HMM

**Nodes/states:** hidden $Z_t\in\{0,\ldots,K-1\}$, $K\in\{2,3\}$ chosen by validation; observed continuous moisture $Y_t$. State numbers are arbitrary mixture labels, not measured stress classes.

**Factorization:** $p(z,y)=\pi_{z_1}\prod_{t=2}^T T_{z_{t-1},z_t}\prod_t\mathcal N(y_t;\mu_{z_t},\sigma_{z_t}^2)$.

**Expected:** represent persistent hidden regimes. Shared emission levels may transfer poorly across different soil baselines.

### 5.7 Logit-normal HMM

**Nodes/states:** hidden $Z_t$ as in the Gaussian HMM; observed $Y_t\in(0,1)$ and transform $U_t=\operatorname{logit}(Y_t)$. Boundary inputs are clipped to $[10^{-5},1-10^{-5}]$.

**CPD:** $U_t\mid Z_t=k\sim\mathcal N(\mu_k,\sigma_k^2)$; $p(y\mid k)=\mathcal N(\operatorname{logit}y;\mu_k,\sigma_k^2)/[y(1-y)]$.

**Expected:** predictions respect fractional support. This does not itself guarantee improved RMSE or calibration.

### 5.8 Kalman LDS

**Nodes:** continuous latent moisture $x_t$ and observed moisture $Y_t$; no discrete wet/dry regime. Implemented as the one-regime switching model.

**CPDs:** $x_{t+1}\mid x_t\sim\mathcal N(ax_t+b,q)$; $Y_t\mid x_t\sim\mathcal N(x_t,r)$. Kalman updates combine process uncertainty and measurement uncertainty.

**Expected:** smooth noisy observations and bridge gaps; a single linear response may miss abrupt transitions.

### 5.9 Switching LDS (IMM)

**Nodes/states:** $R_t\in\{0,1\}$ discrete regime, continuous latent moisture $x_t$, and observed $Y_t$. Regimes have separate $(a_k,b_k,q_k)$ and shared observation variance $r$.

**CPDs:** $R_{t+1}\mid R_t\sim T$; $x_{t+1}\mid x_t,R_{t+1}=k\sim\mathcal N(a_kx_t+b_k,q_k)$; $Y_t\mid x_t\sim\mathcal N(x_t,r)$. IMM moment-matches regime-conditioned Gaussian beliefs. Training fits a GMM on moisture/change pairs, then weighted regressions and transition counts; it is not full switching-state EM.

**Expected:** adapt to multiple dynamics, with additional estimation error from greater complexity.

### 5.10 Nonlinear beta CPD

**Nodes:** observed lagged feature parents and bounded $Y_{t+h}\in(0,1)$; no latent regime. Tree leaves are predictor partitions, not HMM states.

**CPD:** $\mu_h(x)=\operatorname{sigmoid}(g_h(x))$; $Y_{t+h}\mid x\sim\operatorname{Beta}(\mu_h\phi_h,(1-\mu_h)\phi_h)$. Boosted trees estimate the logit mean; a constant precision is fitted per horizon.

**Expected:** nonlinear relationships with bounded support, but limited extrapolation to unfamiliar stations.

## 6. Held-out station results
RMSE and MAE are in m³/m³. RMSE emphasizes large errors; MAE uses linear error cost. Brier score evaluates a probability for a specified event. Average precision depends on prevalence and is undefined here for single-class groups. Coverage must be read with interval width.

The following clean-test metrics are recomputed from row-level predictions and reconciled against the completed run. Macro averages weight station–year groups equally. NOAA and SCAN remain separate.

### 6.2 Selection and paired uncertainty
Station-cluster resampling and circular day blocks preserve part of the dependence structure. Block lengths 7/14/30/60 days are sensitivity choices. Three NOAA and six SCAN station clusters limit confidence in broad geographic generalization.

## 7. Sensor failures and feature ablations
The completed sweeps remove all three moisture readings for the first 7 or 30 days of every 90-day block in the test year, or add drift growing to ±0.03 m³/m³. Weather inputs and target truth remain unchanged. The reported scores average full test years, not outage periods alone.

Feature ablations retain the selected hyperparameters while removing predictors. They are sensitivity tests, not newly optimized alternatives. Corruption/ablation tables are recorded per-fold results; row-level corrupted forecasts were not archived.

## 8. Climate-cluster transfer
Three clusters use 2016–2023 weather: mean temperature, monthly temperature range, annual rainfall and monthly rainfall variability. Standardized features have fixed weights [1,1,2,1.5]. Entire clusters are excluded from fitting/calibration. Pre-test weather from all sites defines the clusters; this is transfer between predefined climate groups, not discovery at wholly unseen sites.

## 9. Soil-normalized moisture events
For five SCAN sites with direct USDA SSURGO retention estimates,
$$r=\frac{\theta-\theta_{WP}}{\theta_{FC}-\theta_{WP}},\qquad E=\mathbf1[r<0.30].$$
The sensor-scale threshold is $c=\theta_{WP}+0.30(\theta_{FC}-\theta_{WP})$. Soil-survey estimates average the 0–30 cm layer while the sensor samples near 20 cm, so this event is a physical approximation, not measured crop physiological stress. Values of $r$ are not clipped.

Only direct survey sites and **raw predictive probabilities** are retained. The empirical-proxy station and its shared probability calibration are excluded from this interpretation. The predictive models use the original SCAN-selected parameters. Thresholds 0.20/0.30/0.40 assess event-support sensitivity; they are not optimized on test scores.

## 10. Sunflower field trial: irregular observation intervals
USDA-ARS Colorado data (2008–2016) contain measured moisture profiles, irrigation and weather. Depth-weighted moisture over **0–135 cm** is averaged over replicate plots within each treatment/year. Consecutive measured endpoints define intervals; daily target values are not interpolated.

| Node | Domain / unit | Interpretation |
|---|---|---|
| $\theta_s$, $\theta_e$ | Moisture, m³/m³ | Measured start/end root-zone averages |
| $I$, $P$, $ET_0$ | mm over interval | Realized irrigation, rainfall and reference ET |
| $\Delta t$ | 1–60 days admitted | Irregular time between observations |
| $G_s$ | Numeric stage code | Derived from recorded stage at interval start; an ordinal proxy |
| $Z$ | 2/3 mixture regimes | Inferred statistical states |

Test years are 2015/2016, with each treatment held out in turn. Other treatments through $Y-2$ fit the model; year $Y-1$ calibrates intervals. The inner fit is through $Y-3$, with validation in $Y-2$. This tests treatment/year transfer at one farm, not independent farm generalization. Missing forcing values use fitting medians.

**The displayed names reflect the actual implementation:**

| Displayed model (source label) | Conditional model and states | Expected behavior |
|---|---|---|
| Persistence | $\theta_e\sim N(\theta_s,\sigma^2)$; no latent state | Strong short-interval baseline |
| Gaussian transition regression (“Irregular Gaussian DBN”) | $N(\beta_0+\beta^\top\mathrm{scale}(u),\sigma^2)$, $u=(\theta_s,I,P,ET_0,\Delta t,G_s)$ | Use interval forcing and duration |
| Duration-dependent Gaussian transition (“Irregular Kalman LDS”) | $\phi=e^{-\lambda\Delta t}$; mean $\phi\theta_s+g(1-\phi,I,P,ET_0,G_s)$; variance $q\Delta t+r$ | Represent duration-dependent response/uncertainty; no recursive measurement update |
| HMM-gated Gaussian regression (“Irregular Gaussian HMM”) | HMM states gate regressions; weights propagate by $T^{\max(1,\mathrm{round}(\Delta t/\widetilde{\Delta t}))}$ | Represent regime-dependent endpoint response; not a continuous-time HMM likelihood |

The mixture intervals use a moment-matched Gaussian. Stage coding sets planting to 0, emergence to 0.5, vegetative stages to V-number, reproductive stages to 30 + R-number, and harvest to 40. These are features, not measured latent states.

**Scope:** interval weather and irrigation are already realized, so this is retrospective conditional prediction, not an operational forecast or causal irrigation recommendation.

### 11.1 Syllabus and Koller–Friedman concept map
| Syllabus module | Relevant concepts | Where demonstrated | Koller & Friedman [1] |
|---|---|---|---|
| 1 · Foundations | Joint/conditional densities, random variables, expectation/variance; nodes/paths/cycles | Variable dictionary, mixture moments, DAG diagrams | Chapters 2–3 |
| 2 · Bayesian networks | Factorization, independence, reasoning with evidence, d-separation, tabular/deterministic/continuous CPDs, elimination | Model CPDs, fitted matrices, explicit variable-elimination equality and chain-separation checks | Chapters 3, 5, 7, 9 |
| 3 · Markov networks | Gibbs factors, partition function, reduced networks, conditioning, elimination complexity | Conceptual comparison with temporal chains; no separately fitted MRF | Chapters 4, 9 |
| 4 · HMMs | Temporal templates, hidden state, transition/emission assumptions, filtering and prediction | HMM/logit-HMM/LDS/IMM implementations and diagrams | Chapters 6, 14–15 |
| 5 · Learning | Likelihood, MLE, smoothing priors, EM, empirical risk, regularization, generalization | Parameter estimates and nested splits | Chapters 16–17, 19 |
| 5 · Causality and decisions | Conditioning/intervention, identifiability, utility | Prediction-only interpretation below | Chapters 21–23 |
| 6 · Applications | Forecasting and event classification | Daily station transfer and sunflower interval experiments | Prediction and temporal-model chapters |

**Conditioning versus intervention.** Observing irrigation $I=i$ gives $p(\theta_e\mid I=i,\ldots)$, not necessarily $p(\theta_e\mid\mathrm{do}(I=i))$. Farmers may choose irrigation because soil is already dry. An identified action-response model and an elicited utility $U$ are needed before maximizing $E[U\mid\mathrm{do}(a)]$. No disabled decision-tree, influence-diagram or POMDP experiment is retained.

**Limitations relevant to the findings.** Site and treatment counts are small; adjacent observations are dependent. Gaussian support is unbounded. Soil-survey thresholds approximate point-sensor conditions. Sunflower forcing is partly imputed and already realized. The HMM-gated interval model uses rounded transition steps, not continuous-time estimation. The results do not establish plant physiological stress, yield gains or irrigation savings.

**Conclusion.** Model choice depends on forecast horizon, transfer setting and sensor quality. The completed comparison supports examining simple baselines alongside temporal PGMs, reporting uncertainty and class support, and interpreting model complexity through measured evidence rather than assumed benefit.

## References
1. D. Koller and N. Friedman, *Probabilistic Graphical Models: Principles and Techniques*, MIT Press, 2009. Theory is paraphrased and adapted to this experiment; chapter mappings are listed above.
2. K. J. Somaiya Institute of Technology, *Probabilistic Graphical Models*, CEDLC5044 / CEDLL5044, syllabus 2025–26, supplied course document.
3. NOAA NCEI, [US Climate Reference Network products](https://www.ncei.noaa.gov/access/crn/products.html). Original file URLs and hashes are retained in the verified companion evidence archive.
4. USDA NRCS, [Soil Climate Analysis Network](https://www.nrcs.usda.gov/resources/data-and-reports/soil-climate-analysis-network), observations through the Air and Water Database REST API.
5. T. J. Trout, L. H. Comas, K. C. DeJonge and H. Zhang (2025), [Colorado Sunflower Water Use and Productivity Dataset](https://agdatacommons.nal.usda.gov/articles/dataset/USDA-ARS_Colorado_Sunflower_Water_Use_and_Productivity_Dataset/28586066), 2008–2016 field measurements. DOI: 10.15482/USDA.ADC/28586066.
6. USDA NRCS, [Soil Data Access](https://sdmdataaccess.sc.egov.usda.gov/WebServiceHelp.aspx), SSURGO retention attributes.
7. [NetworkX drawing](https://networkx.org/documentation/stable/reference/drawing.html); [Plotly 3D scatter plots](https://plotly.com/python/3d-scatter-plots/); [Plotly surfaces](https://plotly.com/python/3d-surface-plots/).

Empirical evidence comes from the supplied completed notebook and its verified companion evidence archive, with archive and table hashes recorded in this submission. No synthetic observations or invented performance values are used.