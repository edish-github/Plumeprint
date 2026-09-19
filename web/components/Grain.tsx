/** A fine paper grain, generated rather than downloaded, so the hero has texture
 *  without a network request or a licence question. */
export function Grain({ opacity = 0.32 }: { opacity?: number }) {
  return (
    <svg className="grain" style={{ opacity }} aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <filter id="plume-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#plume-grain)" />
    </svg>
  );
}
