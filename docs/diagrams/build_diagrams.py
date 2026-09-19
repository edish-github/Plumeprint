# Writes standalone .mmd files (each carries its own theme) for the PlumePrint docs.
import json, pathlib
THEME = {"theme":"base","themeVariables":{"fontFamily":"Inter, Liberation Sans, Arial, Helvetica","fontSize":"15px",
  "primaryColor":"#FFFFFF","primaryBorderColor":"#1B1B1F","primaryTextColor":"#1B1B1F","lineColor":"#44474F",
  "secondaryColor":"#F6F3EC","tertiaryColor":"#FBFAF7","clusterBkg":"#FBFAF7","clusterBorder":"#B9B4A6",
  "edgeLabelBackground":"#FFFFFF","noteBkgColor":"#FFF7E8","noteBorderColor":"#C2571A",
  "actorBkg":"#FFFFFF","actorBorder":"#1B1B1F","signalColor":"#44474F","labelBoxBkgColor":"#F6F3EC","labelBoxBorderColor":"#B9B4A6",
  "loopTextColor":"#1B1B1F","activationBkgColor":"#FCE8D5","activationBorderColor":"#C2571A"}}
def init(extra=None):
    cfg = dict(THEME)
    if extra: cfg.update(extra)
    return "%%{init: " + json.dumps(cfg) + "}%%\n"
CLASSES = """
  classDef src fill:#EFE7D3,stroke:#8A7A4F,color:#1B1B1F;
  classDef det fill:#DCE6F2,stroke:#33558B,color:#10233F;
  classDef stat fill:#E7E0F5,stroke:#5B3FA0,color:#24124D;
  classDef llm fill:#FCE8D5,stroke:#C2571A,color:#4A1F05;
  classDef ui fill:#DDF0E8,stroke:#1B7F6B,color:#0B3A30;
  classDef store fill:#F1F1F1,stroke:#555555,color:#1B1B1F;
  classDef user fill:#2D3142,stroke:#2D3142,color:#FFFFFF;
  classDef core fill:#FFF7E8,stroke:#D9381E,stroke-width:2px,color:#1B1B1F;
  classDef bad fill:#FBE3DE,stroke:#D9381E,color:#5A1207;
  classDef good fill:#D8EFE9,stroke:#1B7F6B,color:#0B3A30;
  classDef warn fill:#FFF1CC,stroke:#B7791F,color:#4A3000;
  classDef mute fill:#E6EAF0,stroke:#64748B,color:#1F2937;
"""
FLOW = {"flowchart":{"curve":"basis","htmlLabels":True,"nodeSpacing":38,"rankSpacing":52,"padding":10,"wrappingWidth":340}}
D = {}

D["01-system-context"] = init(FLOW) + """flowchart LR
  subgraph USERS["People"]
    direction TB
    U1["Community advocate<br/>fenceline resident"]:::user
    U2["Local journalist"]:::user
    U3["Student researcher<br/>or hackathon judge"]:::user
    U1 ~~~ U2 ~~~ U3
  end
  subgraph PUBLIC["Public records · no API keys"]
    direction TB
    D1["EPA AQS bulk files<br/>hourly SO2 + on-site wind"]:::src
    D2["TCEQ AEER database<br/>self-reported emission events"]:::src
    D3["Open-Meteo archive<br/>modelled hourly wind"]:::src
    D4["OSM Nominatim<br/>facility geocoding"]:::src
    D1 ~~~ D2 ~~~ D3 ~~~ D4
  end
  PP(["<b>PlumePrint</b><br/>audits self-reported pollution<br/>against the air's own record"]):::core
  C1["Claude API<br/>narrative extraction + investigator"]:::llm
  M1["Keyless map tiles<br/>OpenFreeMap · Esri imagery"]:::store
  R1["TCEQ public records office<br/>receives requests the user sends"]:::mute
  USERS -->|"read case files,<br/>pull leads"| PP
  PUBLIC -->|"offline ingest,<br/>cached scrape"| PP
  PP <-->|"tool-use loop"| C1
  PP -->|"basemap"| M1
  PP -.->|"drafts request"| R1
""" + CLASSES

D["02-system-architecture"] = init(FLOW) + """flowchart TB
  subgraph EXT["1 · External sources · public, keyless"]
    direction LR
    AQS["EPA AQS bulk zips<br/>hourly SO2 + on-site wind"]:::src
    AEER["TCEQ AEER<br/>search + detail pages"]:::src
    OM["Open-Meteo archive<br/>modelled wind"]:::src
    GEO["Nominatim<br/>facility geocoding"]:::src
    AQS ~~~ AEER ~~~ OM ~~~ GEO
  end
  subgraph PIPE["2 · Offline pipeline · Python · deterministic + statistical"]
    direction LR
    ING["Ingest + cache<br/>raw zips, raw HTML"]:::det
    NORM["Normalize<br/>UTC hours, units, IDs"]:::det
    EPI["Episode<br/>detection"]:::det
    FP["Directional fingerprint<br/>CPF + bootstrap CI"]:::stat
    REC["Two-way reconciliation<br/>+ match confidence"]:::stat
    COV["Monitor coverage<br/>blind-spot statistics"]:::stat
    EXP["Export + validate<br/>golden-number tests"]:::det
    ING --> NORM --> EPI --> REC --> EXP
    NORM --> FP --> EXP
    NORM --> COV --> EXP
  end
  subgraph DATA["3 · Static data contract · web/public/data"]
    direction LR
    J1["sites.json"]:::store
    J2["series / site / year"]:::store
    J3["events · episodes · matches"]:::store
    J5["fingerprint · coverage"]:::store
    J1 ~~~ J2 ~~~ J3 ~~~ J5
  end
  subgraph LLMPRE["4 · LLM precompute · TypeScript scripts"]
    direction LR
    EX1["extract-narratives.ts<br/>Claude Haiku 4.5 · JSON schema"]:::llm
    AG1["run-agent.ts<br/>Claude Sonnet 5 · tool use"]:::llm
    VER["verifier.ts<br/>numbers · refs · language lint"]:::det
    OUT1["narratives.json<br/>cases / episode.json"]:::store
    EX1 --> AG1 --> VER --> OUT1
  end
  subgraph WEB["5 · Web app · Next.js on Vercel"]
    direction LR
    UI["Investigation workspace<br/>map + rose + two ledgers"]:::ui
    CASE["Case file view<br/>evidence board + request draft"]:::ui
    API["/api/investigate · SSE<br/>rate-limited · falls back to cache"]:::llm
    UI --> CASE --> API
  end
  CL["Claude API"]:::llm
  USER(["Advocate · journalist · judge"]):::user
  EXT --> PIPE --> DATA --> LLMPRE --> WEB
  DATA --> WEB
  LLMPRE <--> CL
  WEB <--> CL
  USER --> WEB
""" + CLASSES

D["03-data-pipeline"] = init(FLOW) + """flowchart TD
  CFG["S0 · config/sites.yaml<br/>monitors, counties, years, thresholds"]:::store
  S1["S1 · ingest_aqs_so2<br/>stream the zip, keep state 48"]:::det
  S2["S2 · ingest_aqs_wind<br/>params 61103 + 61104"]:::det
  S3["S3 · ingest_openmeteo<br/>GMT, m/s, retry with backoff"]:::det
  S4["S4 · scrape_aeer<br/>search, paginate, fetch details"]:::det
  S5["S5 · facilities<br/>geocode + manual overrides"]:::det
  S6["S6 · normalize<br/>everything onto UTC hours"]:::det
  S7["S7 · episodes<br/>top 1% and at least 5 ppb<br/>merge gaps up to 3 h"]:::det
  S8["S8 · fingerprint<br/>CPF per 10° bin<br/>day-block bootstrap"]:::stat
  S9["S9 · reconcile<br/>episodes to reports and back<br/>confidence score"]:::stat
  S10["S10 · coverage<br/>when was each facility upwind?"]:::stat
  S11["S11 · export JSON<br/>web/public/data"]:::det
  S12["S12 · validate<br/>golden numbers from<br/>the feasibility run"]:::good
  T1["T1 · extract-narratives<br/>cause taxonomy per report"]:::llm
  T2["T2 · run-agent<br/>investigate flagged episodes"]:::llm
  T3["T3 · verify<br/>reject unsupported numbers"]:::det
  CASES["web/public/data/cases"]:::store
  CFG --> S1 & S2 & S3 & S4
  S1 & S2 & S3 & S4 --> S6
  S4 --> S5
  S6 --> S8
  S6 --> S7 --> S9
  S6 --> S10
  S5 --> S9
  S5 --> S10
  S8 & S9 & S10 --> S11
  S11 --> S12
  S11 --> T1 --> T2 --> T3 --> CASES
  subgraph LEGEND["Legend"]
    direction LR
    LG1["deterministic code"]:::det
    LG2["statistics"]:::stat
    LG3["Claude"]:::llm
    LG4["files"]:::store
    LG1 ~~~ LG2 ~~~ LG3 ~~~ LG4
  end
""" + CLASSES

D["04-time-alignment"] = init(FLOW) + """flowchart LR
  A["<b>EPA AQS hourly file</b><br/>Date/Time Local = local STANDARD time<br/>Date/Time GMT columns also present<br/>values are hour-beginning averages"]:::src
  B["<b>TCEQ AEER reports</b><br/>local CLOCK time, DST applies<br/>e.g. 04/20/2023 08:00 AM"]:::src
  C["<b>Open-Meteo archive</b><br/>request timezone=GMT<br/>values are instantaneous on the hour"]:::src
  U(["<b>UTC hour index</b><br/>the single source of truth"]):::core
  A -->|"use the GMT columns"| U
  B -->|"America/Chicago to UTC<br/>ambiguous: first · nonexistent: shift forward"| U
  C -->|"vector-mean of t and t+1 h"| U
  U --> V["Verified alignment<br/>report start 08:00 AM CDT<br/>= 13:00 UTC = 07:00 LST monitor peak"]:::good
  U --> D["UI converts to site local time<br/>only at render"]:::ui
""" + CLASSES

D["05-episode-verdict-flow"] = init(FLOW) + """flowchart TD
  E["Monitor episode<br/>contiguous high-SO2 hours"]:::det --> Q1{{"Any report overlaps the window<br/>2 h before to 2 h after?"}}
  Q1 -- no --> Q0{{"Other SO2 monitors<br/>also high right then?"}}
  Q0 -- yes --> V5["REGIONAL<br/>not a local source"]:::mute
  Q0 -- "no, or none nearby" --> V1["UNEXPLAINED<br/>no matching report"]:::bad
  Q1 -- yes --> Q2{{"Does any of them<br/>list SO2 above 0 lb?"}}
  Q2 -- no --> V2["UNEXPLAINED<br/>concurrent non-SO2 report noted"]:::bad
  Q2 -- yes --> Q3{{"Report covers at least half<br/>of the episode hours?"}}
  Q3 -- no --> V3["WEAK MATCH<br/>partial or indirect fit"]:::warn
  Q3 -- yes --> Q4{{"Facility located, and upwind-consistent<br/>S_bearing at least 0.5?"}}
  Q4 -- no --> V3
  Q4 -- yes --> Q5{{"Report window<br/>longer than 7 days?"}}
  Q5 -- yes --> V3
  Q5 -- no --> V4["MATCHED<br/>time + direction + pollutant"]:::good
""" + CLASSES

D["06-report-visibility-flow"] = init(FLOW) + """flowchart TD
  R["Self-reported event<br/>SO2 at least 1,000 lb · configurable"]:::src --> Q1{{"Monitor has data for at least<br/>half of the event hours?"}}
  Q1 -- no --> V0["NO DATA"]:::mute
  Q1 -- yes --> Q2{{"Matched to an episode?"}}
  Q2 -- yes --> V1["SEEN"]:::good
  Q2 -- no --> Q3{{"Peak at least baseline + 1 ppb<br/>during the event?"}}
  Q3 -- yes --> V2["FAINT<br/>a bump below the episode threshold"]:::warn
  Q3 -- no --> Q4{{"Facility upwind of the monitor for<br/>at least a quarter of event hours?"}}
  Q4 -- no --> V3["UNSEEN · WIND AWAY<br/>the monitor could not have seen it"]:::mute
  Q4 -- yes --> V4["UNSEEN · WIND TOWARD<br/>plume likely passed overhead"]:::bad
""" + CLASSES

D["07-scoring-model"] = init(FLOW) + """flowchart LR
  subgraph IN["Inputs per episode–report pair"]
    I1["Episode hours + ppb"]:::det
    I2["Report start and end · UTC"]:::src
    I3["Report contaminants"]:::src
    I4["Hourly wind direction + speed<br/>and which wind source"]:::det
    I5["Facility bearing, distance,<br/>angular half-width"]:::det
  end
  subgraph SC["Component scores · 0 to 1"]
    S1["<b>S_time</b><br/>share of episode hours inside<br/>the report window −2 h / +2 h"]:::stat
    S2["<b>S_spec</b><br/>clip of 72 h ÷ report duration<br/>to the range 0.15 – 1"]:::stat
    S3["<b>S_poll</b><br/>1 if SO2 listed, else 0"]:::stat
    S4["<b>S_bearing</b><br/>ppb-weighted mean of exp(−½ (Δ/σ)²)<br/>Δ = angle beyond the facility's span"]:::stat
  end
  I1 & I2 --> S1
  I2 --> S2
  I3 --> S3
  I1 & I4 & I5 --> S4
  S1 & S2 & S3 & S4 --> C["<b>confidence</b> =<br/>S_poll × √(S_time · S_spec) × (0.4 + 0.6 · S_bearing)"]:::core
  C --> L1["Ranks candidate reports<br/>best one becomes the match"]:::det
  C --> L2["Confidence meter in the UI"]:::ui
  C --> L3["Verdict itself comes from<br/>the rule flow in diagram 05"]:::mute
""" + CLASSES

D["08-data-model"] = init() + """erDiagram
  SITE ||--o{ MONITOR : has
  SITE ||--o{ FACILITY : includes
  MONITOR ||--o{ HOURLY_OBS : records
  MONITOR ||--o{ EPISODE : yields
  MONITOR ||--o{ FINGERPRINT_BIN : "summarised by"
  FACILITY ||--o{ EVENT_REPORT : files
  EVENT_REPORT ||--o{ EMISSION_POINT : lists
  EMISSION_POINT ||--o{ CONTAMINANT : releases
  EVENT_REPORT ||--o| NARRATIVE : "parsed into"
  EPISODE ||--o{ MATCH : "candidate for"
  EVENT_REPORT ||--o{ MATCH : "candidate for"
  EVENT_REPORT ||--o{ REPORT_VISIBILITY : "assessed at"
  MONITOR ||--o{ REPORT_VISIBILITY : assesses
  FACILITY ||--o{ COVERAGE : "upwind share"
  MONITOR ||--o{ COVERAGE : sees
  EPISODE ||--o| CASE_FILE : "investigated in"
  CASE_FILE ||--o{ AGENT_STEP : traces

  SITE {
    string site_id PK "texas-city"
    string name
    string county "AEER county filter"
    string tz "America/Chicago"
  }
  MONITOR {
    string monitor_id PK "48-167-0005"
    string site_id FK
    float lat
    float lon
    float threshold_ppb "max(5, p99)"
    float baseline_ppb
    string wind_source "aqs or openmeteo"
  }
  HOURLY_OBS {
    string monitor_id FK
    datetime t_utc PK "hour beginning"
    float so2_ppb
    float wd_deg "direction wind comes FROM"
    float ws_ms
    string wind_source
  }
  FACILITY {
    string rn PK "TCEQ RN number"
    string name
    float lat
    float lon
    float radius_m "plant footprint"
    string coord_quality "manual, geocoded"
  }
  EVENT_REPORT {
    int incident_id PK
    string rn FK
    string event_type
    datetime start_utc
    datetime end_utc
    datetime notified_utc
    float so2_lb "sum over emission points"
    string cause_text
    string source_url
  }
  EMISSION_POINT {
    int incident_id FK
    string epn
    string common_name
  }
  CONTAMINANT {
    int incident_id FK
    string epn FK
    string name
    float quantity
    string units
    float limit
    string authorization
  }
  NARRATIVE {
    int incident_id FK
    string cause_category
    string release_pathway
    bool elevated_release
    bool intermittent
    string summary
  }
  EPISODE {
    string episode_id PK "monitor + start hour"
    string monitor_id FK
    datetime start_utc
    datetime end_utc
    float peak_ppb
    float wd_mean_deg "ppb-weighted circular mean"
    string verdict
  }
  MATCH {
    string episode_id FK
    int incident_id FK
    float s_time
    float s_spec
    float s_bearing
    float confidence
    bool is_best
  }
  REPORT_VISIBILITY {
    int incident_id FK
    string monitor_id FK
    string status "SEEN, FAINT, UNSEEN..."
    float peak_ppb_during
    float upwind_share
  }
  FINGERPRINT_BIN {
    string monitor_id FK
    int bin_deg PK "0 to 350 step 10"
    int year "0 = all years"
    float cpf
    float ci_low
    float ci_high
    int n_hours
  }
  COVERAGE {
    string monitor_id FK
    string rn FK
    float upwind_share_hours
    float so2_lb_while_upwind
    float so2_lb_total
  }
  CASE_FILE {
    string episode_id FK
    string verdict
    string confidence
    string headline
    string request_draft
    bool verified
    string model
  }
  AGENT_STEP {
    string episode_id FK
    int seq
    string tool
    string args_json
    string summary
  }
"""

D["09-agent-sequence"] = init({"sequence":{"mirrorActors":False,"messageMargin":28,"boxMargin":8,"wrap":True,"width":170}}) + """sequenceDiagram
  autonumber
  actor U as User
  participant UI as Case view
  participant C as Cached cases
  participant API as /api/investigate
  participant CL as Claude Sonnet 5
  participant T as Tools · pure functions over JSON
  participant V as Verifier
  U->>UI: Open episode
  UI->>C: GET cases/{episode}.json
  C-->>UI: Cached case renders instantly
  U->>UI: Click "Re-run investigation"
  UI->>API: POST siteId + episodeId
  API->>API: Rate limit + daily budget check
  alt over budget, key missing, or timeout
    API-->>UI: cached = true, keep cached case
  else live run
    API->>CL: System prompt + tools + episode brief
    loop until submit_case_file · max 8 turns
      CL-->>API: tool_use · name + input
      API->>T: Run tool
      T-->>API: JSON result, numbers carry ids
      API-->>UI: SSE step · tool, args, one-line summary
      API->>CL: tool_result
    end
    CL-->>API: tool_use · submit_case_file
    API->>V: Check numbers, references, language
    alt passes
      V-->>API: ok
    else violations
      API->>CL: One retry, violations listed
      CL-->>API: Revised draft
      API->>V: Re-check, else template fallback
    end
    API-->>UI: SSE case_file
  end
  UI-->>U: Evidence board + verdict + request draft
"""

D["10-agent-states"] = init() + """stateDiagram-v2
  direction TB
  [*] --> CachedShown: page load
  CachedShown --> Requesting: user clicks Re-run
  Requesting --> CachedShown: over budget · no key · timeout
  Requesting --> Planning: stream opened
  Planning --> CallingTool: model requests a tool
  CallingTool --> Observing: tool result returned
  Observing --> CallingTool: needs more evidence
  Observing --> Drafting: enough evidence, or 8 turns used
  Drafting --> Verifying: submit_case_file
  Verifying --> Published: all checks pass
  Verifying --> Retrying: violations found
  Retrying --> Verifying: revised draft
  Retrying --> TemplateFallback: second failure
  TemplateFallback --> Published
  Published --> [*]
"""

D["11-frontend-architecture"] = init(FLOW) + """flowchart TD
  R1["/ · landing<br/>hook + three sites"]:::ui
  R4["/methods<br/>methods + limits"]:::ui
  R2["/site/[siteId]<br/>investigation workspace"]:::ui
  R3["/site/[siteId]/case/[episodeId]<br/>case file"]:::ui
  R1 --> R2 --> R3
  R1 --> R4
  subgraph WS["Workspace components"]
    C1["SiteMap<br/>MapLibre + GeoJSON layers"]:::ui
    C4["TwoLedgers<br/>SVG lanes + threads"]:::ui
    C5["StatStrip<br/>the 2×2 headline numbers"]:::ui
    C6["EpisodeList<br/>+ filters"]:::ui
    C2["RoseLayer<br/>CPF wedges as geo polygons"]:::ui
    C3["UpwindCone<br/>per-hour wedges + playback"]:::ui
    C1 --> C2 & C3
  end
  subgraph CS["Case components"]
    C7["EvidenceBoard<br/>agent steps"]:::ui
    C8["CaseFile<br/>+ RequestDraft"]:::ui
  end
  R2 --> C1 & C4 & C5 & C6
  R3 --> C7 & C8
  subgraph ST["Hooks + state"]
    S2["selection store · zustand<br/>episode, report, year, brush"]:::det
    S1["useSiteData<br/>lazy JSON by year"]:::det
    S3["useInvestigation<br/>SSE client + cached fallback"]:::det
  end
  C4 & C6 --> S2
  C5 --> S1
  C7 --> S3
  C8 --> S1
  subgraph LB["Libraries + backends"]
    S4["lib/geo.ts<br/>bearing, destination, wedge"]:::det
    DATA["public/data/*.json"]:::store
    R5["/api/investigate<br/>route handler · SSE"]:::llm
  end
  C2 & C3 --> S4
  S1 --> DATA
  S3 --> R5
  S3 -.->|"fallback"| DATA
""" + CLASSES

D["12-deployment"] = init(FLOW) + """flowchart TD
  subgraph DEV["Developer laptop"]
    direction LR
    P["make data<br/>Python pipeline"]:::det
    L["pnpm llm:all<br/>narratives + cases"]:::llm
    G["git commit + push<br/>data JSON included"]:::store
    P --> L --> G
  end
  GH["GitHub repo · public · MIT<br/>the link judges open"]:::store
  subgraph VERCEL["Vercel project"]
    direction LR
    B["Build<br/>next build"]:::det
    CDN["Static pages + data JSON<br/>edge CDN"]:::ui
    FN["Serverless function<br/>/api/investigate"]:::llm
    B --> CDN
    B --> FN
  end
  ENV["Env vars · ANTHROPIC_API_KEY<br/>DAILY_BUDGET_USD · LIVE_AGENT"]:::store
  AN["Claude API"]:::llm
  J(["Judge's browser"]):::user
  DEV --> GH --> VERCEL
  ENV -.-> VERCEL
  VERCEL <--> AN
  J --> VERCEL
""" + CLASSES

D["13-build-timeline"] = init({"gantt":{"barHeight":30,"fontSize":15,"sectionFontSize":16,"leftPadding":130,"topPadding":70,"barGap":8,"gridLineStartPadding":40},"themeVariables":dict(THEME["themeVariables"],taskBkgColor="#DCE6F2",taskBorderColor="#33558B",taskTextColor="#10233F",taskTextOutsideColor="#1B1B1F",taskTextLightColor="#1B1B1F",taskTextDarkColor="#1B1B1F",activeTaskBkgColor="#DCE6F2",activeTaskBorderColor="#33558B",critBkgColor="#FBE3DE",critBorderColor="#D9381E",sectionBkgColor="#F6F3EC",altSectionBkgColor="#FFFFFF",sectionBkgColor2="#F6F3EC",gridColor="#B9B4A6",todayLineColor="#FFFFFF")}) + """gantt
  title Build plan in IST · hard deadline Mon 21 Sep 02:30
  dateFormat YYYY-MM-DD HH:mm
  axisFormat %a %H:%M
  tickInterval 12hour
  section Data
  Repo, config, AQS ingest            :d1, 2026-09-17 21:00, 5h
  AEER scraper, 3 counties            :d2, 2026-09-18 09:00, 5h
  Wind, facilities, normalize         :d3, 2026-09-18 12:00, 4h
  section Analytics
  Episodes + fingerprint              :a1, 2026-09-18 15:00, 4h
  Reconcile, coverage, validate       :a2, 2026-09-18 18:00, 5h
  GATE 1 two clean sites              :milestone, g1, 2026-09-18 23:00, 0h
  section Frontend
  Shell, tokens, map + rose           :f1, 2026-09-19 09:00, 5h
  Two ledgers + stat strip            :f2, 2026-09-19 13:00, 6h
  Case file view + methods page       :f3, 2026-09-19 18:00, 4h
  GATE 2 end-to-end on one site       :milestone, g2, 2026-09-19 23:00, 0h
  section Claude
  Narrative extraction batch          :c1, 2026-09-19 10:00, 3h
  Agent, verifier, precompute         :c2, 2026-09-20 09:00, 5h
  Live SSE route + fallback           :c3, 2026-09-20 13:00, 3h
  section Ship
  Polish, empty states, mobile        :s1, 2026-09-20 14:00, 4h
  README, methods, Devpost text       :s2, 2026-09-20 16:00, 3h
  Record + edit video                 :s3, 2026-09-20 18:00, 4h
  Submit                              :milestone, s4, 2026-09-20 23:00, 0h
  Buffer before deadline              :crit, s5, 2026-09-20 23:00, 3h
"""

D["14-demo-storyboard"] = init(FLOW) + """flowchart TD
  B1["<b>0:00 – 0:20 · HOOK</b><br/>8,800 lb released, a city shelters in place,<br/>the monitor 1 km away reads 1.5 ppb"]:::bad
  B2["<b>0:20 – 1:10 · TWO LEDGERS</b><br/>company reports on top, the air below,<br/>threads connect only a few"]:::core
  B3["<b>1:10 – 1:50 · THE ROSE</b><br/>one lobe on the satellite map,<br/>stable across years and sites"]:::stat
  B4["<b>1:50 – 3:00 · OPEN A CASE</b><br/>the agent gathers evidence live,<br/>verdict + innocent explanations"]:::llm
  B5["<b>3:00 – 3:50 · HOW IT WORKS</b><br/>three public records · code + stats + Claude,<br/>every number verified"]:::det
  B6["<b>3:50 – 4:30 · HONEST LIMITS</b><br/>no report is not illegal · blind spots,<br/>how this differs from Air Tracker"]:::mute
  B7["<b>4:30 – 5:00 · SO WHAT</b><br/>a records request in one click,<br/>any monitor, any state with self-reports"]:::good
  B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7
""" + CLASSES

D["15-user-flow"] = init(FLOW) + """flowchart TD
  A(["Lands on home"]):::user --> B["Reads the punchline<br/>picks a site"]:::ui
  B --> C["Workspace<br/>map + rose + two ledgers"]:::ui
  C --> D{{"What catches the eye?"}}
  D -- "a red episode" --> E["Select episode<br/>cone sweeps upwind on the map"]:::ui
  D -- "a grey report bar" --> F["Select report<br/>see why the monitor missed it"]:::ui
  E --> G["Open case file"]:::ui
  F --> G
  G --> H["Evidence board<br/>steps, numbers, source links"]:::llm
  H --> I{{"Worth following up?"}}
  I -- yes --> J["Copy the records request draft<br/>review it, send it themselves"]:::good
  I -- no --> K["Read innocent explanations<br/>and what would settle it"]:::mute
  J --> L(["Shares the case link"]):::user
  K --> C
""" + CLASSES

for name, text in D.items():
    pathlib.Path(f"{name}.mmd").write_text(text)
print(len(D), "files written:", ", ".join(D))
