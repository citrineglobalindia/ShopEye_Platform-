// Aperture-eye mark: six blades around an iris
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="#E8A317" strokeWidth="8" />
      <g fill="#fff">{[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} d="M50 12 L66 40 L50 50 Z" transform={`rotate(${a} 50 50)`} opacity=".9" />))}</g>
      <circle cx="50" cy="50" r="9" fill="#E8A317" />
    </svg>
  );
}
export function Aperture() {
  return (
    <svg className="aperture" viewBox="0 0 200 200" role="img" aria-label="Shopeye aperture">
      <circle cx="100" cy="100" r="92" fill="#1C2554" />
      <circle cx="100" cy="100" r="92" fill="none" stroke="#E8A317" strokeWidth="10" />
      <g className="blades">{[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
        <path key={a} d="M100 22 L134 76 L100 100 Z" transform={`rotate(${a} 100 100)`} fill={i % 2 ? '#3A4478' : '#4B5690'} />))}</g>
      <circle cx="100" cy="100" r="22" fill="#E8A317" /><circle cx="92" cy="92" r="6" fill="#fff" opacity=".85" />
    </svg>
  );
}
