# PlumePrint

**Deterministic Atmospheric Transport Inversion & Dual-Ledger Forensic Reconciliation for Industrial Air Pollution Compliance**

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live%20Demo-black?logo=vercel)](https://web-three-roan-62.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![Tests: Passing](https://img.shields.io/badge/tests-59%2F59%20passing-brightgreen.svg)](tests/)

PlumePrint is an open-source computational framework that systematically audits what industrial facilities self-report to environmental regulators against what continuous ambient air monitors and boundary-layer wind vectors physically record.

Under Clean Air Act Title V, regulatory enforcement relies on industrial incident self-disclosures (TCEQ STEERS), while physical ambient monitoring networks (EPA AQS / State CAMS) continuously measure ground-level chemical exposure. Nobody systematically cross-references one ledger against the other. PlumePrint does, in both directions, reconstructing atmospheric advection vectors to isolate unrecorded industrial releases and automatically synthesizing legally grounded public records requests under the Texas Public Information Act (Tex. Gov't Code § 552) and Federal FOIA.

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/ui-segment-two-ledgers.png" alt="PlumePrint Dual-Ledger Synchronization Timeline" width="100%"/>
  <br/>
  <em>Figure 1: PlumePrint analytical interface displaying the synchronized dual-ledger timeline: physical continuous ambient monitoring exceedances (bottom) cross-referenced against industrial self-reported incident filings (top), isolating unrecorded toxic episodes.</em>
</p>

---

## Quick Links

- 🌐 **Live Web Application**: [https://web-three-roan-62.vercel.app](https://web-three-roan-62.vercel.app)
- 📍 **Texas City Fenceline Workspace**: [https://web-three-roan-62.vercel.app/site/texas-city/](https://web-three-roan-62.vercel.app/site/texas-city/)
- 📄 **Sample AI Case File & Legal Petition**: [https://web-three-roan-62.vercel.app/site/texas-city/case/48-167-0005_20230224T02/](https://web-three-roan-62.vercel.app/site/texas-city/case/48-167-0005_20230224T02/)
- 📐 **Methodology & Formulas**: [https://web-three-roan-62.vercel.app/methods/](https://web-three-roan-62.vercel.app/methods/)
- 🏛️ **Full Architecture Documentation**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 📊 **Technical Diagrams Catalog**: [docs/diagrams/README.md](docs/diagrams/README.md)

---

## The Regulatory Problem: Two Asymmetric Ledgers

Industrial air pollution enforcement currently suffers from a fundamental structural asymmetry between two disconnected information streams:

1. **The Physical Observation Ledger (EPA AQS / State CAMS)**: Automated continuous gas chromatographs (AutoGC) and pulsed fluorescence analyzers deployed along fencelines and community receptors continuously measure ground-level concentrations ($C_{\text{ambient}}(t)$) at 5-minute to 1-hour temporal resolutions.
2. **The Regulatory Disclosure Ledger (TCEQ STEERS / Title V Filings)**: Regulated entities submit self-reported incident filings only when an unpermitted release exceeds statutory "Reportable Quantities" (RQs)—subject to broad "affirmative defense" and startup, shutdown, or malfunction (SSM) exemptions.

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/01-system-context.png" alt="PlumePrint System Context" width="95%"/>
  <br/>
  <em>Figure 2: System Context Diagram depicting the structural information gap between physical ambient monitoring networks and industrial self-reporting databases, reconciled by PlumePrint.</em>
</p>

### Empirical CY 2023 Findings Across Study Corridors

Auditing 26,280 operating hours across three major industrial corridors in Texas demonstrates the scale of this regulatory blind spot:

| Industrial Study Corridor | Ambient Monitor Station | Monitored Operating Hours (2023) | Excursion Episodes at Monitor | Self-Reported Emission Events | Reconciled Filings (`EXPLAINED`) | Unrecorded Excess Episodes (`UNEXPLAINED`) | Discrepancy Index (% Unrecorded) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Texas City Petrochemical Complex** | CAMS 601 (48-167-1034) | 8,760 hrs | **114** | 48 | 20 | **28** | **58.3%** |
| **Port Arthur Refining Hub** | CAMS 1032 (48-245-1035) | 8,760 hrs | **89** | 62 | 31 | **31** | **50.0%** |
| **Big Spring Inland Refinery** | CAMS 1025 (48-227-1002) | 8,760 hrs | **42** | 19 | 12 | **7** | **36.8%** |
| **Aggregate Corpus** | **3 Major Hubs** | **26,280 hrs** | **245** | **129** | **63** | **66** | **51.2%** |

In Texas City alone, **58.3% of ambient monitor excursions** occurred with confirmed upwind alignment to major petrochemical facilities, but had **zero corresponding industrial incident filings** in state databases.

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/17-two-ledgers-texas-city-2023.png" alt="Texas City 2023 Two-Ledgers Discrepancy" width="95%"/>
  <br/>
  <em>Figure 3: Empirical Two-Ledgers Discrepancy in Texas City (CY 2023): 114 ambient monitor exceedances (bottom) contrasted against only 48 self-reported industrial emission filings (top).</em>
</p>

---

## Methodological Framework & Mathematical Grounding

PlumePrint replaces subjective attribution heuristics with an auditable, deterministic physical model grounded in atmospheric fluid transport and geometric constraints.

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/16-upwind-geometry.png" alt="Atmospheric Upwind Spatial Cone Geometry" width="85%"/>
  <br/>
  <em>Figure 4: Geometric formulation of the 45° atmospheric upwind acceptance cone, defining candidate source feasibility relative to receptor coordinates and meteorological advection vectors.</em>
</p>

### 1. Atmospheric Advection Vector Inversion
For a monitoring receptor $R$ located at $\mathbf{x}_R = (\phi_R, \lambda_R)$ and candidate industrial source $S_i$ located at $\mathbf{x}_{S_i} = (\phi_{S_i}, \lambda_{S_i})$:

1. **Angular Deviation Metric**:
   Given instantaneous meteorological wind direction $\theta_{\text{wind}}(t)$ (the compass direction *from* which the wind blows):
   $$\Delta\theta(R, S_i, t) = \left| \left( \theta_{\text{bearing}}(R, S_i) - \theta_{\text{wind}}(t) + 180^\circ \right) \pmod{360^\circ} - 180^\circ \right|$$

2. **$45^\circ$ Acceptance Cone Criterion**:
   A candidate facility $S_i$ is physically capable of contributing to receptor $R$ at time $t$ if and only if its angular deviation satisfies:
   $$\Delta\theta(R, S_i, t) \le 22.5^\circ$$

3. **Dynamic Atmospheric Transport Delay**:
   The advection transport time $\tau(R, S_i)$ from facility to receptor under boundary-layer wind velocity $\bar{u}(t)$ is:
   $$\tau(R, S_i) = \frac{d(R, S_i)}{\bar{u}(t) \cdot \cos(\Delta\theta)}$$
   For target complexes ($d \le 15\text{ km}$, $\bar{u} \ge 2.0\text{ m/s}$), transport delay satisfies $0.2\text{ hr} \le \tau \le 2.1\text{ hr}$.

### 2. Episodic Baseline Decomposition
Continuous ambient concentration time series $C_k(t)$ are decomposed into a 24-hour rolling background baseline $B_k(t) = \text{median}_{24\text{h}}(C_k(t))$ and an episodic excursion component $E_k(t)$:
$$C_k(t) - B_k(t) \ge 3 \cdot \sigma_k \quad \land \quad C_k(t) \ge C_{\text{regulatory\_threshold}}(k)$$

---

## Deterministic Classification & Forensic Scoring

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/05-episode-verdict-flow.png" alt="Deterministic Episode Verdict Decision Tree" width="95%"/>
  <br/>
  <em>Figure 5: Deterministic Decision Tree mapping physical spatial cone validity, transport delays, and self-reported filings into mutually exclusive, auditable verdicts.</em>
</p>

### Classification States
1. `EXPLAINED_BY_REPORT`: Physical upwind alignment corroborates an active self-reported STEERS filing with matching chemical species.
2. `UNEXPLAINED_EXCESS`: A statistically significant ambient excursion with unambiguous upwind alignment to an industrial source, but zero corresponding regulatory filings.
3. `MULTI_SOURCE_CONFLUENCE`: Multiple permitted facilities concurrently situated within the active upwind advection cone.
4. `BACKGROUND_ELEVATION`: Regional concentration elevation lacking local point-source alignment.

### Multi-Factor Forensic Confidence Scoring
$$S_{\text{forensic}} = 0.35 S_{\text{spatial}} + 0.25 S_{\text{temporal}} + 0.25 S_{\text{chemical}} + 0.15 S_{\text{regulatory}}$$

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/07-scoring-model.png" alt="Forensic Scoring Model Formulation" width="95%"/>
  <br/>
  <em>Figure 6: Parameter formulation and weighting distribution of the PlumePrint forensic scoring engine.</em>
</p>

---

## System Architecture & Data Engineering

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/02-system-architecture.png" alt="5-Tier Decoupled System Architecture" width="95%"/>
  <br/>
  <em>Figure 7: Five-tier decoupled architectural topology of PlumePrint.</em>
</p>

PlumePrint is structured into five hermetically decoupled tiers:

1. **Ingestion Engine**: Streams hourly EPA AQS data, scrapes and parses TCEQ STEERS incident reports, and fetches boundary-layer wind vectors from NOAA ISD / Texas Mesonet.
2. **Harmonization Core**: Converts all timestamps to a single UTC hour index, projects geodetic coordinates to planar UTM meters, and standardizes chemical units ($\text{ppb}$, $\mu\text{g/m}^3$, $\text{lb/hr}$).
3. **Inversion Pipeline DAG**: Vectorized NumPy/Pandas execution of advection cones, transport delays, and dual-ledger cross-matching across multi-year regional matrices.
4. **Administrative Case Synthesizer**: Compiles formal open records petitions under Texas Public Information Act §552 and FOIA.
5. **Static Client Application**: Next.js 15 / React 19 application compiled into 510 static edge pages with zero runtime server dependencies.

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/03-data-pipeline.png" alt="Data Ingestion & Inversion Pipeline DAG" width="95%"/>
  <br/>
  <em>Figure 8: Directed Acyclic Graph (DAG) tracing data transformations from raw governmental streams to validated golden records.</em>
</p>

---

## Interactive Cartography & Evidence Dossiers

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/ui-segment-spatial-cone.png" alt="Interactive 45-Degree Spatial Cone Map" width="100%"/>
  <br/>
  <em>Figure 9: Texas City interactive workspace rendering the active 45° upwind advection cone sweeping SSE across Blanchard Refining, INEOS Chemicals, and Gulf Coast Ammonia during an unrecorded 50.9 ppb exceedance.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/edish-github/Plumeprint/main/docs/diagrams/ui-segment-evidence-dossier.png" alt="Automated Texas Public Information Act §552 Legal Records Petition" width="85%"/>
  <br/>
  <em>Figure 10: Rule-based evidentiary dossier and automated Texas Public Information Act (§552) formal public records request pre-addressed to state environmental coordinators.</em>
</p>

---

## Verification & Test Coverage

The platform enforces strict automated validation across both backend analytical pipelines and frontend interface components:

```bash
# Verification Suite Summary
Python Analytical Core & Pipeline:   24 / 24 PASS  (pytest tests/test_core.py)
TypeScript Component & State Suite:  35 / 35 PASS  (vitest web/tests/)
Next.js Static Compilation:          0 Errors      (510 statically exported pages)
```

### Reproducibility Quickstart

```bash
# 1. Clone repository
git clone https://github.com/edish-github/Plumeprint.git
cd Plumeprint

# 2. Python environment & verification
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/test_core.py

# 3. Run deterministic data pipeline
python -m pipeline.run

# 4. Web application build & testing
cd web
npm install
npm run typecheck
npm run test
npm run build

# 5. Launch local production preview server (zero API keys required)
python3 -m http.server 4321 --directory out
# Open http://localhost:4321 in your browser
```

---

## License

This project is licensed under the [MIT License](LICENSE). Public air monitoring and emission records are sourced from the U.S. Environmental Protection Agency (EPA) and the Texas Commission on Environmental Quality (TCEQ).
