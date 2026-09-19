# PlumePrint

**Audits what industrial facilities told the regulator against what the air monitors and
the wind actually recorded.**

Texas facilities must self-report accidental releases. Separately, EPA monitors record
hourly pollution. Nobody checks one against the other. PlumePrint does, in both
directions, and finds that the two records disagree far more often than they agree.

For detailed system design, data models, and workflow specifications, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the [technical diagrams](docs/diagrams/README.md).

---

## What it finds

Three Texas fenceline sites, 2021 to 2025, sulfur dioxide, from public records only:

| | Texas City | Port Arthur / Beaumont | Big Spring |
|---|---|---|---|
| Episodes at the monitor | 36 | 377 | 122 |
| …with no matching report | 23 | 265 | 112 |
| Large reports assessed | 66 | 103 | 14 |
| …the monitor never clearly saw | 60 | 95 | 14 |

The reference case: on 27 June 2023 the Galveston Bay Refinery reported releasing
**8,830 lb of SO2** and Texas City sheltered in place. The county's only SO2 monitor, about
1.4 km away, peaked at **1.5 ppb** — 228 other hours that year read higher. The audit
labels that report `FAINT`, not `SEEN`.

Running the same rules over the 2023 slice reproduces the hand analysis exactly:
**10 episodes, 6 unexplained, 3 matched, 1 weak.**

## What it does not claim

**No matching report is not the same as an illegal release.** Releases below the
reportable quantity, permitted emissions in poor dispersion, ships and other mobile
sources, and sources outside the searched counties all look identical here. The product
says "no matching report" and never accuses anyone.

Other honest limits:

- Hourly averages blur short releases.
- One monitor only sees what the wind brings it; `UNSEEN` often means "not downwind".
- Hot, elevated plumes can pass clean over a nearby ground monitor. The June 2023 event is
  exactly that.
- The fingerprint shows direction, not distance; several facilities can share a bearing.

## How it works

```
EPA AQS bulk files ─┐
TCEQ AEER reports ──┼─> Python pipeline ─> static JSON ─> web app
Open-Meteo wind ────┤    (S1 … S12)
EPA FRS / ECHO ─────┘
```

1. **One clock.** AQS local columns are standard time, TCEQ reports are local clock time
   with DST, Open-Meteo is requested in GMT. Everything is converted to a UTC hour index
   before anything is compared. A wrong offset here would silently break every match.
2. **Episodes.** Runs of hours above a per-monitor threshold: the higher of 5 ppb and the
   monitor's own 99th percentile, with gaps up to 3 h absorbed.
3. **Directional fingerprint.** For each 10° wind bin, the share of hours landing in the
   monitor's top 5%. This is the conditional probability function from receptor modelling.
   Intervals come from a day-block bootstrap, because consecutive hours share weather.
4. **Bearing test.** A facility is upwind for an hour when the wind arrives from its
   direction, allowing for the plant's own angular width and the wind's uncertainty
   (15° for measured wind, 25° for modelled, 45° when light).
5. **Reconciliation.** Rules decide verdicts, so they can be explained. The confidence
   score only ranks candidate reports; it never decides.

## The Claude layer

Claude does two jobs, and only the two that code cannot do:

1. **Narrative extraction** (`claude-haiku-4-5`). Reads the free-text cause on each filed
   report into a taxonomy: what failed, whether the release went up a flare, whether it
   was intermittent, whether the operator knew the cause. A flare release is elevated,
   which is how a large release can pass over a nearby ground monitor and barely register.
2. **The investigator** (`claude-sonnet-5`). Works through eight read-only tools over the
   exported JSON, then submits a case file: verdict, reasoning with evidence ids, innocent
   explanations, what would settle it, and a records request the resident can send.

Everything else is deterministic. The model never computes a verdict and never sees data
the tools did not hand it.

### The verifier

Every case file passes plain-code checks before anyone sees it:

- **Numbers.** Every numeric claim must appear in a tool result from that run. An invented
  figure is rejected.
- **Evidence.** Every cited id must be one a tool returned.
- **Language.** Accusation words are blocked outright. The product says "no matching
  report", never "illegal" or "violation".

One retry is allowed, with the violations spelled out. A second failure falls back to a
deterministic case file built from pipeline output.

### Any model, or none

The investigator talks to whatever model you can get. Provider is chosen by environment,
so switching costs nothing:

```bash
# Google AI Studio: free, no credit card, roughly 1,500 requests a day
GEMINI_API_KEY=... npm run llm:cases

# Any OpenAI-compatible endpoint: NVIDIA NIM, Groq, OpenRouter, Together, local Ollama
OPENAI_API_KEY=... OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1 \
  PLUMEPRINT_MODEL=meta/llama-3.3-70b-instruct npm run llm:cases

# Anthropic
ANTHROPIC_API_KEY=... npm run llm:cases

# Force a provider or model explicitly
PLUMEPRINT_PROVIDER=gemini PLUMEPRINT_MODEL=gemini-2.5-flash-lite npm run llm:cases
```

Model names move. If a default is rejected, check which models your key can call and set
`PLUMEPRINT_MODEL`.

The verifier matters *more* with a smaller model, not less: a weaker model is likelier to
invent a figure, and an invented figure is exactly what gets rejected. A draft that fails
twice falls back to the template, so nothing unverified reaches a reader whichever model
wrote it. If a call fails mid-batch, which free tiers do, that episode falls back to the
template and the run continues.

### It works without an API key

`npx tsx scripts/run-agent.ts` with no key writes template case files for every episode,
assembled from pipeline output. A fresh clone produces a complete, honest site with no
model access at all. That fallback is also the baseline the model has to beat.

```bash
cd web && npm install
npm test                    # 25 tests, no API key needed
npm run llm:cases           # cached case files
ANTHROPIC_API_KEY=... npm run llm:all   # with the model
```

## Data sources

| Source | Used for | Access |
|---|---|---|
| [EPA AQS bulk hourly files](https://aqs.epa.gov/aqsweb/airdata/download_files.html) | hourly SO2, on-site wind | public domain, no key |
| [TCEQ Air Emission Event Reports](https://www2.tceq.texas.gov/oce/eer/index.cfm) | self-reported releases | Texas public records |
| [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api) | modelled wind where no on-site wind | CC BY 4.0 |
| [EPA FRS / ECHO](https://echo.epa.gov/) | facility coordinates, joined on the TCEQ RN | public domain |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass | industrial footprints | ODbL |

Weather data by Open-Meteo.com. Facility footprints © OpenStreetMap contributors.

## Running it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

python -m pipeline.cli all          # every stage, in order
python -m pipeline.cli check        # acceptance checks only
python -m pipeline.cli s9 s11       # selected stages
python -m pytest -q                 # unit tests
```

Every external fetch is cached under `data/raw/`, so a second run works offline. The first
run downloads roughly 500 MB of EPA files and fetches around 950 TCEQ pages at one every
0.4 s, so allow half an hour. Stages resume where they stopped.

### Stages

| | Stage | Does |
|---|---|---|
| S1 | `s1_ingest_aqs` | Stream EPA yearly zips, keep configured monitors |
| S3 | `s3_ingest_openmeteo` | Modelled wind per monitor-year |
| S4 | `s4_scrape_aeer` | Search, paginate and parse TCEQ reports |
| S5 | `s5_facilities` | Coordinates from FRS/ECHO, footprints from OSM |
| S6 | `s6_normalize` | One UTC hour index, one chosen wind source |
| S7 | `s7_episodes` | Episode detection |
| S8 | `s8_fingerprint` | Conditional probability by wind bin, bootstrapped |
| S9 | `s9_reconcile` | Verdicts both directions |
| S10 | `s10_coverage` | Upwind share and visible mass per facility |
| S11 | `s11_export` | Static JSON for the web app |
| S12 | `s12_validate` | Golden-number gate |

Every tunable lives in `config/sites.yaml`. Nothing downstream hardcodes a threshold.

## Verdicts

| Episode verdict | Meaning |
|---|---|
| `MATCHED` | time, direction and pollutant all agree with a filed report |
| `WEAK_MATCH` | a report overlaps but the fit is partial or indirect |
| `UNEXPLAINED` | no filed report matches |
| `REGIONAL` | other monitors were high too, so the cause is not local |

| Report visibility | Meaning |
|---|---|
| `SEEN` | the monitor recorded a matching episode |
| `FAINT` | a bump above background, below the episode threshold |
| `UNSEEN_WIND_TOWARD` | no bump, though the monitor was downwind for part of it |
| `UNSEEN_WIND_AWAY` | no bump, and the wind was not blowing toward the monitor |
| `NO_DATA` | the monitor was not reporting for enough of the window |

## Validation

`data/golden/feasibility_2023.json` holds numbers measured by hand on 17 Sep 2026, before
this code existed. `python -m pipeline.cli s12` checks the pipeline still reproduces them.
58 pipeline acceptance checks, 24 Python unit tests and 25 TypeScript tests currently pass.

One known convention difference, documented rather than papered over: the 2023 hour count
is 7,998 on a local-standard-time basis and 8,003 on UTC years, because the 2022 file's
last local hours fall into 2023 UTC.

## Notes on accuracy

- Facility coordinates come from EPA FRS joined on the facility's own TCEQ RN number, so
  the join is exact rather than fuzzy name matching. Facilities placed only by geocoding a
  street address cannot reach `MATCHED`: a mailing address is not a plant centroid.
- Footprint radii come from OpenStreetMap polygons where Overpass responds, otherwise from
  documented per-class defaults in `config/sites.yaml`. Every facility records which it
  got in its `footprint_source` field. Defaults are assumptions, labelled as assumptions,
  and they only widen the angular window.
- 99.9% of reported pollutant mass belongs to facilities with resolved coordinates. A few
  pipeline segments and tank batteries have no public coordinates and are excluded from
  bearing tests rather than guessed at.

## Licence

MIT. Data belongs to its original publishers under the licences listed above.
