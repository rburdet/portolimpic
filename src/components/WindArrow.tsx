interface WindArrowProps {
  direction: number; // Wind direction in degrees
  size?: number; // Size of the arrow
  className?: string;
}

export function WindArrow({ direction, size = 20, className = "" }: WindArrowProps) {
  // Wind direction indicates where wind is coming FROM
  // So we need to add 180 degrees to show the arrow pointing in the direction the wind is coming from
  // A south wind (180°) should show arrow pointing UP (north) because wind comes from south
  const arrowDirection = (direction + 180) % 360;
  
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{
        transform: `rotate(${arrowDirection}deg)`,
        transformOrigin: 'center',
      }}
    >
      {/* Arrow pointing up (0 degrees = North) */}
      <path
        d="M12 2 L16 10 L14 10 L14 22 L10 22 L10 10 L8 10 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
      />
      {/* Optional: Add a small circle at the center for better visual reference */}
      <circle
        cx="12"
        cy="12"
        r="1.5"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
} 