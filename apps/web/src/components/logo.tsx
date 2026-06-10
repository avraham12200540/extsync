/** ExtSync brand assets, recreated as inline SVG from the brand logo:
 *  a browser window with a puzzle piece, sync arrows and a verified shield,
 *  plus the "ExtSync" wordmark (navy "Ext", blue→teal "Sync"). */

// Faithful vector reproduction of the ExtSync brand mark: navy browser window,
// blue/teal circular sync arrows around a blue puzzle piece, teal verified shield.
export function LogoIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      {/* browser window */}
      <rect x="7" y="9" width="42" height="38" rx="6" fill="#16243B" />
      <circle cx="13" cy="15" r="1.6" fill="#fff" />
      <circle cx="18.5" cy="15" r="1.6" fill="#fff" />
      <circle cx="24" cy="15" r="1.6" fill="#fff" />
      <rect x="11" y="20.5" width="34" height="22.5" rx="3" fill="#fff" />

      {/* circular sync arrows */}
      <path d="M17.66 26.74 A11 11 0 0 1 38.34 26.74" fill="none" stroke="#2B7DE9" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M38.34 34.26 A11 11 0 0 1 17.66 34.26" fill="none" stroke="#11B5BA" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M38.34 26.74 l4.3 -0.9 l-2 3.9 z" fill="#2B7DE9" />
      <path d="M17.66 34.26 l-4.3 0.9 l2 -3.9 z" fill="#11B5BA" />

      {/* puzzle piece (Material 'extension' glyph, scaled into the ring) */}
      <g transform="translate(20.5,23) scale(0.62)" fill="#2563EB">
        <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z" />
      </g>

      {/* verified shield */}
      <path d="M43.5 35.5c4 0 7 1.3 7 1.3v6.4c0 4.6-4 7.9-7 8.8-3-.9-7-4.2-7-8.8v-6.4s3-1.3 7-1.3z" fill="#0FB5BA" />
      <path d="M40 43.7l2.5 2.5 4.7-4.9" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`} dir="ltr">
      <span className="text-[#10243E] dark:text-white">Ext</span>
      <span className="bg-gradient-to-l from-[#0FB5BA] via-[#2B7DE9] to-[#2563EB] bg-clip-text text-transparent">
        Sync
      </span>
    </span>
  );
}

export function Logo({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoIcon size={size} />
      <Wordmark className="text-[1.35rem]" />
    </span>
  );
}
