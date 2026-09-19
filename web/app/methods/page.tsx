import { getMeta } from "@/lib/data";

export const dynamic = "force-static";

export default async function MethodsPage() {
  const meta = await getMeta();
  const p = meta.parameters;

  return (
    <div className="page-narrow" style={{ paddingTop: "var(--s7)" }}>
      <h1>Methods and limits</h1>
      <p className="lead" style={{ marginTop: "var(--s5)" }}>
        This page exists so you can disagree with us precisely. Every threshold below is a
        choice, and every choice is visible.
      </p>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>What is compared</h2>
      <p>
        Three public records: hourly {meta.pollutant.name} from EPA monitors, hourly wind
        (measured at the monitor where it exists, modelled where it does not), and the
        emission events facilities file with the state. All three are put on one UTC clock
        before anything is compared, because the three sources use three different time
        conventions and a wrong offset would silently break every match.
      </p>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>Episodes</h2>
      <p>
        A run of hours at or above the higher of {String(p.episode?.abs_min_ppb)} ppb and
        this monitor&rsquo;s own {Math.round(Number(p.episode?.pct) * 100)}th percentile,
        with gaps of up to {String(p.episode?.merge_gap_h)} hours absorbed into one episode.
        The threshold is per-monitor because a reading that is ordinary at one site is
        extraordinary at another.
      </p>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>Whether a facility was upwind</h2>
      <p>
        The wind must arrive from the facility&rsquo;s direction, allowing for the width of
        the plant itself and for the uncertainty of the wind reading:{" "}
        {String(p.wind?.sigma_measured)}° when measured on site,{" "}
        {String(p.wind?.sigma_modelled)}° when modelled, and{" "}
        {String(p.wind?.sigma_light)}° when the wind is lighter than{" "}
        {String(p.wind?.light_ms)} m/s. Hours below {String(p.wind?.calm_ms)} m/s carry no
        direction at all and are excluded rather than counted as a miss.
      </p>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>Verdicts</h2>
      <table className="rows">
        <tbody>
          {Object.entries(meta.verdicts).map(([k, v]) => (
            <tr key={k}>
              <td><span className={`verdict d-${k}`}>{k.replace(/_/g, " ")}</span></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        Verdicts come from explicit rules, not from a score and not from a model, so they
        can be explained to a resident and argued with by a regulator. The confidence score
        only ranks candidate reports against each other.
      </p>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>What the monitor saw of each report</h2>
      <table className="rows">
        <tbody>
          {Object.entries(meta.visibility_statuses).map(([k, v]) => (
            <tr key={k}>
              <td><span className={`verdict d-${k}`}>{k.replace(/_/g, " ")}</span></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>What this cannot tell you</h2>
      <ul>
        <li>{meta.caveat}</li>
        <li>
          Hourly averages blur short releases. A sharp fifteen-minute plume and a slow
          three-hour build can produce the same hourly number.
        </li>
        <li>
          One monitor only sees what the wind brings it. &ldquo;Unseen&rdquo; often means
          &ldquo;not downwind&rdquo;, which is a statement about where monitors are placed.
        </li>
        <li>
          Releases from a flare or a tall stack go up. A large release can pass over a
          nearby ground monitor and barely register there.
        </li>
        <li>
          The direction pattern shows direction, not distance. Several facilities can sit
          along the same bearing.
        </li>
        <li>
          Facilities placed only by geocoding a street address cannot reach a matched
          verdict here: a mailing address is not a plant centroid.
        </li>
      </ul>

      <h2 style={{ fontSize: "1.8rem", marginTop: "var(--s7)", marginBottom: "var(--s4)" }}>Sources</h2>
      <table className="rows">
        <thead>
          <tr><th>Source</th><th>Used for</th><th>Licence</th></tr>
        </thead>
        <tbody>
          {meta.sources.map((s) => (
            <tr key={s.name}>
              <td><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></td>
              <td>{s.used_for}</td>
              <td className="faint">{s.licence}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        Data built {meta.built_at.slice(0, 10)} with pipeline {meta.pipeline_version},
        covering {meta.years[0]} to {meta.years.at(-1)}.
      </p>
    </div>
  );
}
