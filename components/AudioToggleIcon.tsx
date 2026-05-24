"use client";

export function AudioToggleIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden
      className="block h-5 w-5 shrink-0"
    >
      <path
        d="M3.3 8h3.2l4.2-3.5v11L6.5 12H3.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {muted ? (
        <path
          d="M14.1 7.4l3.2 3.2M17.3 7.4l-3.2 3.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d="M13.4 7.1c.7.7 1 1.6 1 2.9s-.3 2.2-1 2.9"
            stroke="currentColor"
            strokeWidth="1.45"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M15.4 5.2c1.2 1.2 1.9 2.8 1.9 4.8s-.7 3.6-1.9 4.8"
            stroke="currentColor"
            strokeWidth="1.45"
            fill="none"
            strokeLinecap="round"
            opacity="0.72"
          />
        </>
      )}
    </svg>
  );
}
