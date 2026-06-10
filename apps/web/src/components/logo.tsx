/** ExtSync brand assets, recreated as inline SVG from the brand logo:
 *  a browser window with a puzzle piece, sync arrows and a verified shield,
 *  plus the "ExtSync" wordmark (navy "Ext", blue→teal "Sync"). */

export function LogoIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      {/* browser window */}
      <rect x="6" y="4" width="46" height="40" rx="7" fill="#10243E" />
      <circle cx="14" cy="11" r="2" fill="#fff" />
      <circle cx="21" cy="11" r="2" fill="#fff" />
      <circle cx="28" cy="11" r="2" fill="#fff" />
      <rect x="10" y="17" width="38" height="23" rx="4" fill="#fff" />
      {/* sync arrows */}
      <path d="M44 23a17 17 0 0 0-25-4" stroke="#2B7DE9" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d="m44.5 14.5.3 9-8.8-1.6" fill="#2B7DE9" />
      <path d="M14 37a17 17 0 0 0 25 4.5" stroke="#11B5BA" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d="m13.4 46 0-9.2 8.8 2" fill="#11B5BA" />
      {/* puzzle piece */}
      <path
        d="M26 24h4.2c-.5-2.6.9-4.6 3-4.6s3.5 2 3 4.6H40a2 2 0 0 1 2 2v3.6c2.6-.5 4.6.9 4.6 3s-2 3.5-4.6 3V40a2 2 0 0 1-2 2H26a2 2 0 0 1-2-2V26a2 2 0 0 1 2-2Z"
        fill="#2563EB"
      />
      {/* shield + check */}
      <path d="M49 40c4 0 7 1.4 7 1.4V49c0 5-4.4 8.6-7 9.6-2.6-1-7-4.6-7-9.6v-7.6S45 40 49 40Z" fill="#0FB5BA" />
      <path d="m45.5 49 2.6 2.6 5-5.2" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
