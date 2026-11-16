import React from 'react';

/** NAXORA-Logo: Ring + „N“. Reines Schwarz-Weiß (currentColor), skaliert beliebig. */
export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`naxora-logo ${className}`}
      width={size} height={size} viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="NAXORA"
    >
      <rect className="nl-ring" x="2" y="2" width="44" height="44" rx="13" stroke="currentColor" strokeWidth="2" />
      <path className="nl-n" d="M16 34V14l16 20V14" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="nl-dot" cx="36.5" cy="11.5" r="2.2" fill="currentColor" />
    </svg>
  );
}
