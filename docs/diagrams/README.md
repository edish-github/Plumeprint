# PlumePrint diagrams

Every diagram ships as Mermaid source (`.mmd`) and a rendered PNG. Figures 16-18 are matplotlib (PNG only).

| # | File | What it shows |
|---|------|---------------|
| 01 | system-context | People, public records, services around PlumePrint |
| 02 | system-architecture | Five bands: sources, Python pipeline, static data contract, LLM precompute, web app |
| 03 | data-pipeline | Stage DAG S0-S12 and T1-T3, colour-coded by who does the work |
| 04 | time-alignment | How three time conventions land on one UTC hour index |
| 05 | episode-verdict-flow | Rules that label a monitor episode MATCHED / WEAK MATCH / UNEXPLAINED / REGIONAL |
| 06 | report-visibility-flow | Rules that label a self-report SEEN / FAINT / UNSEEN (wind away or toward) / NO DATA |
| 07 | scoring-model | Component scores and the confidence formula |
| 08 | data-model | Entity-relationship model behind the JSON contract |
| 09 | agent-sequence | Live investigation: tool loop, verifier, cached fallback |
| 10 | agent-states | State machine of one investigation run |
| 11 | frontend-architecture | Routes, components, hooks, libraries |
| 12 | deployment | Laptop to GitHub to production deployment, and the static data pipeline |
| 15 | user-flow | What a visitor does, screen by screen |
| 16 | upwind-geometry | The bearing test: cone, facility span, per-hour score |
| 17 | two-ledgers-texas-city-2023 | Prototype of the hero visual, drawn from real 2023 data |
| 18 | roses-three-sites-2023 | Directional fingerprints for three Texas monitors, real 2023 data |

## Re-render

```bash
npm i @mermaid-js/mermaid-cli
python3 build_diagrams.py            # rewrites the .mmd files from one themed source
for f in *.mmd; do npx mmdc -i "$f" -o "${f%.mmd}.png" -s 2 -w 1800 -b white; done
```

Mermaid gotcha found while building these: theme values inside an `%%{init}%%` directive are dropped silently
if they contain a hyphen, so a font stack ending in `sans-serif` leaves the diagram with no font at all.
