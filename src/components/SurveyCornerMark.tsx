// Holston Scout — "Survey Corner" mark.
//
// One geometric SVG that renders at every size from 16px favicon to
// 1200x630 share image. Components below provide the three lockups:
//   <SurveyCornerMark />        — inline / chrome wordmark
//   <SurveyCornerAppIcon />     — favicon / app icon (with navy-deep ring)
//   (the favicon.svg + og-image.svg files in /public mirror this art)
//
// The mark: an irregular four-vertex parcel, parchment fill, navy outline,
// copper-filled control point at the top-right corner. Geometric, no
// hand-drawn looseness, no decorative clutter.

interface SurveyCornerMarkProps {
  /** width / height in px. Default 20 (chrome wordmark size). */
  size?: number
  /** override the outline color. Defaults to currentcolor (inherits text). */
  outline?: string
  /** override the fill. Defaults to parchment. */
  fill?: string
  /** override the control-point color. Defaults to copper. */
  accent?: string
  className?: string
  ariaLabel?: string
}

export function SurveyCornerMark({
  size = 20,
  outline = 'currentColor',
  fill = '#F8FAFC',
  accent = '#F59E0B',
  className,
  ariaLabel,
}: SurveyCornerMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : 'true'}
      className={className}
    >
      {/* Parcel polygon — irregular but balanced */}
      <path
        d="M3.5 6.5 L18 4.2 L20.5 13 L16.5 19.5 L5.5 18 Z"
        fill={fill}
        stroke={outline}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Copper control point at the NE corner — the survey-corner motif */}
      <circle cx="18" cy="4.2" r="2.4" fill={accent} />
      <circle cx="18" cy="4.2" r="2.4" fill="none" stroke={outline} strokeWidth="0.8" />
    </svg>
  )
}

interface SurveyCornerAppIconProps {
  size?: number
}

/**
 * App-icon lockup — the mark on a navy-deep rounded square. Used by the
 * MapLoadingShell pulse and could back a future PNG icon export.
 */
export function SurveyCornerAppIcon({ size = 64 }: SurveyCornerAppIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#02040A" />
      <g transform="translate(8, 8) scale(2)">
        <path
          d="M3.5 6.5 L18 4.2 L20.5 13 L16.5 19.5 L5.5 18 Z"
          fill="#F8FAFC"
          stroke="#334155"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="18" cy="4.2" r="2.4" fill="#F59E0B" />
        <circle cx="18" cy="4.2" r="2.4" fill="none" stroke="#334155" strokeWidth="0.8" />
      </g>
    </svg>
  )
}
