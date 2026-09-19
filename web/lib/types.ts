/**
 * The JSON contract, as the app sees it.
 *
 * These types mirror what pipeline/s11_export.py writes. If a field changes there, it
 * changes here, and nowhere else: no component reaches past this file into raw JSON.
 */

export type Verdict = "MATCHED" | "WEAK_MATCH" | "UNEXPLAINED" | "REGIONAL";

export type VisibilityStatus =
  | "SEEN"
  | "FAINT"
  | "UNSEEN_WIND_TOWARD"
  | "UNSEEN_WIND_AWAY"
  | "UNSEEN_UNKNOWN"
  | "NO_DATA";

export interface Monitor {
  id: string;
  role: "primary" | "secondary";
  lat: number;
  lon: number;
  county_name: string | null;
  n_hours: number;
  n_valid: number;
  has_onsite_wind: boolean;
  threshold_ppb: number | null;
  max_ppb: number;
}

export interface Facility {
  rn: string;
  name: string | null;
  operator: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  radius_m: number | null;
  /** How the centroid was obtained. Address geocodes cannot support a MATCHED verdict. */
  coord_source: "manual" | "echo_frs" | "nominatim_address" | "none";
  /** "osm:contains_point", "default_by_class:refinery", and so on. */
  footprint_source: string;
  echo_accuracy: string | null;
  frs_registry_id: string | null;
  n_reports: number;
  pollutant_lb_total: number;
  distance_m: number | null;
  bearing_deg: number | null;
  alpha_deg: number | null;
}

export interface Headline {
  episodes_total: number;
  episodes_matched: number;
  episodes_weak: number;
  episodes_unexplained: number;
  episodes_regional: number;
  reports_assessed: number;
  reports_seen: number;
  reports_faint: number;
  reports_unseen: number;
  reports_not_seen: number;
  reports_no_data: number;
  pollutant_lb_assessed: number;
  min_report_lb: number;
}

export interface Site {
  id: string;
  name: string;
  tz: string;
  counties: string[];
  center: [number, number] | null;
  years: number[];
  monitors: Monitor[];
  facilities: Facility[];
  headline: { all: Headline; by_year: Record<string, Headline> };
}

export interface ReportVisibility {
  monitor_id: string;
  status: VisibilityStatus;
  peak_ppb_during: number | null;
  baseline_ppb: number | null;
  upwind_share: number | null;
  data_share: number;
}

export interface EventReport {
  incident: number;
  rn: string;
  facility: string | null;
  operator: string | null;
  event_type: string | null;
  report_type: string | null;
  start_utc: string;
  end_utc: string;
  notified_utc: string | null;
  duration_h: number | null;
  pollutant_lb: number;
  n_emission_points: number;
  process_units: string | null;
  cause: string | null;
  actions: string | null;
  basis: string | null;
  url: string;
  visibility: ReportVisibility | null;
}

export interface Candidate {
  incident: number;
  rn: string;
  facility: string | null;
  confidence: number | null;
  s_time: number | null;
  s_spec: number | null;
  s_bearing: number | null;
  pollutant_lb: number;
  distance_m: number | null;
  bearing_deg: number | null;
  coord_source: string;
  is_best: boolean;
}

export interface EpisodeHour {
  t: string;
  ppb: number | null;
  base: number | null;
  wd: number | null;
  ws: number | null;
}

export interface Episode {
  id: string;
  monitor_id: string;
  start_utc: string;
  end_utc: string;
  t_peak_utc: string;
  n_hours: number;
  peak_ppb: number;
  mean_ppb: number;
  baseline_ppb: number;
  threshold_ppb: number;
  wd_mean_deg: number | null;
  ws_mean_ms: number | null;
  wind_source: "aqs" | "openmeteo" | "none";
  severe: boolean;
  verdict: Verdict;
  verdict_reason: string;
  best_incident: number | null;
  best_confidence: number | null;
  regional_checked: boolean;
  regional_monitors_high: number;
  concurrent_non_pollutant: number;
  candidates: Candidate[];
  hours: EpisodeHour[];
}

export interface FingerprintBin {
  deg: number;
  cpf: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
  lobe: boolean;
}

export interface FingerprintPeriod {
  bins: FingerprintBin[];
  peak_deg: number | null;
  threshold_ppb: number;
  measured_wind_share: number;
}

/** monitor id -> ("0" for all years, else the year) -> period */
export type Fingerprint = Record<string, Record<string, FingerprintPeriod>>;

export interface CoverageRow {
  monitor_id: string;
  site_id: string;
  rn: string;
  facility: string | null;
  distance_m: number;
  bearing_deg: number;
  alpha_deg: number;
  coord_source: string;
  footprint_source: string;
  n_reports: number;
  upwind_share_hours: number | null;
  usable_hours: number;
  pollutant_lb_total: number;
  pollutant_lb_while_upwind: number;
  visible_mass_share: number | null;
}

export interface Meta {
  built_at: string;
  pipeline_version: string;
  pollutant: { name: string; units: string };
  years: number[];
  parameters: Record<string, Record<string, unknown>>;
  sources: { name: string; url: string; licence: string; used_for: string }[];
  verdicts: Record<Verdict, string>;
  visibility_statuses: Record<VisibilityStatus, string>;
  caveat: string;
}

/* ------------------------------------------------------------------ case files */

/** Evidence reference, e.g. "inc:399287" or "ep:48-167-0005_20230420T13". */
export type EvidenceRef = string;

export interface ReasoningStep {
  claim: string;
  evidence: EvidenceRef[];
}

export interface CaseFile {
  verdict: Verdict;
  agrees_with_rules: boolean;
  confidence_label: "low" | "medium" | "high";
  headline: string;
  reasoning: ReasoningStep[];
  innocent_explanations: string[];
  what_would_settle_it: string[];
  request_draft: string;
}

export interface AgentStep {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface StoredCase {
  episode_id: string;
  generated_at: string;
  model: string;
  /** true when the verifier passed, "template" when it fell back to generated prose. */
  verified: boolean | "template";
  trace: AgentStep[];
  case: CaseFile;
}
