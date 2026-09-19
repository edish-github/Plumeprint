"""Stage S4: TCEQ Air Emission Event Reports -> events and contaminants tables.

The AEER site is a ColdFusion app with a session-bound search. Two things bite, both
verified live (spec 3.2):

  1. The submit control is an image input literally named "_fuseaction=main.searchresults",
     so its '=' must survive encoding or the server returns an error page. The body is
     therefore built by hand.
  2. Paging is a GET carrying CurrentPage on the same session, so one search must be
     finished before the next begins.

Outputs  data/interim/events.parquet        one row per incident
         data/interim/contaminants.parquet  one row per (incident, emission point, compound)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import quote

import pandas as pd
from bs4 import BeautifulSoup

from .config import Config, load_config
from .http import get_text, post_text, session
from .logging_setup import get
from .paths import RAW_AEER_DETAIL, RAW_AEER_SEARCH, interim
from .timeutil import aeer_series_to_utc

log = get("s4.aeer")

BASE = "https://www2.tceq.texas.gov/oce/eer/index.cfm"
PAGE_SIZE = 50
POLITE_SLEEP = 0.4   # detail pages are static once FINAL; cached on first fetch

SEARCH_FIELDS = [
    "newsearch", "incid_track_num", "event_start_beg_dt", "event_start_end_dt",
    "event_end_beg_dt", "event_end_end_dt", "cn_txt", "cust_name", "rn_txt", "re_name",
    "ls_cnty_name", "ls_region_cd", "ls_event_typ_cd",
]
SUBMIT = "_fuseaction%3Dmain.searchresults.x=10&_fuseaction%3Dmain.searchresults.y=10"


@dataclass
class SearchResult:
    total: int
    rows: list[dict]


def _clean(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def _to_float(x: str | None) -> float | None:
    if x is None:
        return None
    try:
        return float(str(x).replace(",", "").strip())
    except ValueError:
        return None


def _search_body(county: str, d0: str, d1: str) -> str:
    """Encode the search form by hand so the submit field name keeps its '='."""
    values = {
        "newsearch": "yes", "incid_track_num": "",
        "event_start_beg_dt": d0, "event_start_end_dt": d1,
        "event_end_beg_dt": "", "event_end_end_dt": "",
        "cn_txt": "", "cust_name": "", "rn_txt": "", "re_name": "",
        "ls_cnty_name": county.upper(), "ls_region_cd": "", "ls_event_typ_cd": "",
    }
    body = "&".join(f"{k}={quote(values[k], safe='')}" for k in SEARCH_FIELDS)
    return f"{body}&{SUBMIT}"


def parse_results_page(html: str) -> SearchResult:
    """Rows of one search-results page, plus the reported record total."""
    soup = BeautifulSoup(html, "lxml")
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    m = re.search(r"returned\s+([\d,]+)\s+records", text, re.I)
    total = int(m.group(1).replace(",", "")) if m else 0
    rows: list[dict] = []
    for tr in soup.select("table.datadisplay tr"):
        cells = [_clean(td) for td in tr.find_all("td")]
        if len(cells) >= 6 and cells[0].isdigit():
            rows.append({
                "incident": int(cells[0]), "rn": cells[1], "facility": cells[2],
                "began_local": cells[3], "ended_local": cells[4], "event_type": cells[5],
                "report_type": cells[6] if len(cells) > 6 else None,
                "report_date": cells[7] if len(cells) > 7 else None,
                "customer": cells[8] if len(cells) > 8 else None,
            })
    return SearchResult(total=total, rows=rows)


def parse_detail(html: str) -> dict:
    """One incident detail page -> a flat record plus its contaminant rows.

    Tables are addressed by their `summary` attribute, which is stable across pages.
    """
    soup = BeautifulSoup(html, "lxml")
    out: dict = {"kv": {}, "process_units": [], "facilities": [], "emission_points": [],
                 "cause": None, "actions": None, "basis": None}

    for table in soup.select("table.aeme"):
        summary = (table.get("summary") or "").lower()
        rows = table.find_all("tr")

        if summary.startswith("emission point"):
            names = [_clean(td) for td in rows[1].find_all("td")] if len(rows) > 1 else []
            point = {"name": names[0] if names else None,
                     "epn": names[1] if len(names) > 1 else None,
                     "contaminants": []}
            for tr in rows:
                cells = [_clean(td) for td in tr.find_all("td")]
                if len(cells) >= 3 and _to_float(cells[1]) is not None and cells[2]:
                    point["contaminants"].append({
                        "name": cells[0],
                        "quantity": _to_float(cells[1]),
                        "units": cells[2],
                        "limit": _to_float(cells[3]) if len(cells) > 3 else None,
                        "limit_units": cells[4] if len(cells) > 4 else None,
                        "authorization": cells[5] if len(cells) > 5 else None,
                    })
            out["emission_points"].append(point)

        elif "comment" in summary:
            tds = [_clean(td) for td in table.find_all("td")]
            out["cause"], out["actions"], out["basis"] = (tds + [None, None, None])[:3]

        elif "process area" in summary:
            out["process_units"] = [_clean(td) for td in table.find_all("td") if _clean(td)]

        elif "facility list" in summary:
            for tr in rows[1:]:
                cells = [_clean(td) for td in tr.find_all("td")]
                if cells:
                    out["facilities"].append({"name": cells[0],
                                              "fin": cells[1] if len(cells) > 1 else None})

        else:  # key/value tables: incident, owner, duration, notification
            for th in table.find_all("th"):
                td = th.find_next_sibling("td")
                if td is not None:
                    key = _clean(th).rstrip(":").strip()
                    if key:
                        out["kv"][key] = _clean(td)
    return out


def _detail_to_row(incident: int, parsed: dict, label: str) -> tuple[dict, list[dict]]:
    kv = parsed["kv"]
    rows: list[dict] = []
    total = 0.0
    for point in parsed["emission_points"]:
        for c in point["contaminants"]:
            rows.append({"incident": incident, "epn": point["epn"], "point_name": point["name"],
                         "name": c["name"], "quantity": c["quantity"], "units": c["units"],
                         "limit": c["limit"], "limit_units": c["limit_units"],
                         "authorization": c["authorization"]})
            if (c["name"] or "").strip().lower().startswith(label) and \
               (c["units"] or "").upper().startswith("POUND"):
                total += c["quantity"] or 0.0
    event = {
        "incident": incident,
        "rn": kv.get("RN"),
        "cn": kv.get("CN"),
        "facility": kv.get("Regulated Entity Name"),
        "operator": kv.get("Name of Owner or Operator"),
        "address": kv.get("Physical Location"),
        "county": kv.get("County"),
        "event_type": kv.get("Event/Activity Type"),
        "status": kv.get("Incident Status"),
        "report_type": kv.get("Report Type"),
        "report_date": kv.get("Report Date"),
        "began_local": kv.get("Date and Time Event Discovered or Scheduled Activity Start"),
        "ended_local": kv.get("Date and Time Event or Scheduled Activity Ended"),
        "duration_text": kv.get("Event Duration"),
        "notified_local": kv.get("Initial Notification Date/Time"),
        "notify_method": kv.get("Method"),
        "publication_status": kv.get("Publication Status"),
        "process_units": "; ".join(parsed["process_units"]) or None,
        "cause": parsed["cause"], "actions": parsed["actions"], "basis": parsed["basis"],
        "pollutant_lb": round(total, 2),
        "n_emission_points": len(parsed["emission_points"]),
        "url": f"{BASE}?fuseaction=main.getDetails&target={incident}",
    }
    return event, rows


def search_county_year(sess, county: str, year: int, force: bool = False) -> list[dict]:
    """Every report whose event START falls in `year` for one county."""
    body = _search_body(county, f"01/01/{year}", f"12/31/{year}")
    cache = RAW_AEER_SEARCH / f"{county.lower()}_{year}_p1.html"
    html = post_text(BASE, body, sess=sess, cache=cache, force=force, referer=BASE)
    if html is None:
        log.error("search failed for %s %s", county, year)
        return []
    first = parse_results_page(html)
    rows = list(first.rows)
    pages = (first.total + PAGE_SIZE - 1) // PAGE_SIZE
    for page in range(2, pages + 1):
        cache_p = RAW_AEER_SEARCH / f"{county.lower()}_{year}_p{page}.html"
        html_p = get_text(BASE, cache=cache_p, force=force, sess=sess, sleep=POLITE_SLEEP,
                          params={"CurrentPage": page, "fuseaction": "main.searchresults",
                                  "sortorder": "1D"})
        if html_p is None:
            log.error("page %d failed for %s %s", page, county, year)
            break
        rows.extend(parse_results_page(html_p).rows)
    log.info("%s %s: %d reported, %d parsed", county, year, first.total, len(rows))
    if rows and first.total != len(rows):
        log.warning("%s %s: parsed %d of %d rows", county, year, len(rows), first.total)
    return rows


def fetch_detail(sess, incident: int, force: bool = False) -> str | None:
    cache = RAW_AEER_DETAIL / f"{incident}.html"
    return get_text(BASE, cache=cache, force=force, sess=sess, sleep=POLITE_SLEEP,
                    params={"fuseaction": "main.getDetails", "target": incident})


def run(cfg: Config | None = None, years: list[int] | None = None, sites: list[str] | None = None,
        force: bool = False) -> dict:
    cfg = cfg or load_config()
    years = years or list(cfg.years)
    site_list = [s for s in cfg.sites if not sites or s.id in sites]
    label = cfg.pollutant.report_label.lower()

    sess = session()
    sess.get(BASE, timeout=60)  # establish the session cookie the search depends on

    index: list[dict] = []
    for site in site_list:
        for county in site.aeer_counties:
            for year in years:
                for row in search_county_year(sess, county, year, force=force):
                    row["site_id"] = site.id
                    row["county_searched"] = county
                    index.append(row)

    seen: dict[int, dict] = {}
    for row in index:                       # a county can appear under two sites
        seen.setdefault(row["incident"], row)
    log.info("unique incidents: %d", len(seen))

    events, contaminants = [], []
    for i, (incident, row) in enumerate(sorted(seen.items()), 1):
        html = fetch_detail(sess, incident, force=force)
        if html is None:
            log.warning("detail failed for %s", incident)
            continue
        event, rows = _detail_to_row(incident, parse_detail(html), label)
        event["site_id"] = row["site_id"]
        events.append(event)
        contaminants.extend(rows)
        if i % 100 == 0:
            log.info("details %d/%d", i, len(seen))

    ev = pd.DataFrame(events)
    ct = pd.DataFrame(contaminants)
    if not ev.empty:
        ev["start_utc"] = aeer_series_to_utc(ev.began_local)
        ev["end_utc"] = aeer_series_to_utc(ev.ended_local)
        ev["notified_utc"] = aeer_series_to_utc(ev.notified_local)
        ev["duration_h"] = (ev.end_utc - ev.start_utc).dt.total_seconds() / 3600.0
        ev = ev.sort_values("start_utc").reset_index(drop=True)

    ev.to_parquet(interim("events"), index=False)
    ct.to_parquet(interim("contaminants"), index=False)
    log.info("wrote events=%d contaminants=%d pollutant_lb_total=%.0f",
             len(ev), len(ct), ev.pollutant_lb.sum() if not ev.empty else 0)
    return {"events": interim("events"), "contaminants": interim("contaminants")}


def acceptance() -> list[tuple[str, bool, str]]:
    """Golden numbers from the 17 Sep 2026 feasibility run (spec section 11)."""
    ev = pd.read_parquet(interim("events"))
    g = ev[(ev.county == "GALVESTON") & (ev.start_utc.dt.year == 2023)]
    checks = [
        ("galveston 2023 reports == 48", len(g) == 48, f"got {len(g)}"),
        ("galveston 2023 with SO2 == 37", int((g.pollutant_lb > 0).sum()) == 37,
         f"got {int((g.pollutant_lb > 0).sum())}"),
        ("galveston 2023 SO2 total == 159019 lb", abs(g.pollutant_lb.sum() - 159019) < 5,
         f"got {g.pollutant_lb.sum():.0f}"),
    ]
    for incident, expected in ((399287, 1675.85), (398929, 3716.55), (403267, 8830.73)):
        row = ev[ev.incident == incident]
        got = float(row.pollutant_lb.iloc[0]) if len(row) else float("nan")
        checks.append((f"incident {incident} SO2 == {expected} lb", abs(got - expected) < 0.05,
                       f"got {got}"))
    row = ev[ev.incident == 399287]
    if len(row):
        start = row.start_utc.iloc[0]
        checks.append(("incident 399287 starts 2023-04-20 13:00 UTC",
                       str(start) == "2023-04-20 13:00:00", f"got {start}"))
    return checks


if __name__ == "__main__":
    from .logging_setup import setup

    setup()
    run()
    for name, ok, detail in acceptance():
        print(("PASS  " if ok else "FAIL  ") + name + "   " + detail)
