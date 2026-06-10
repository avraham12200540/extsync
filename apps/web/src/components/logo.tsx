/** ExtSync brand assets, recreated as inline SVG from the brand logo:
 *  a browser window with a puzzle piece, sync arrows and a verified shield,
 *  plus the "ExtSync" wordmark (navy "Ext", blue→teal "Sync"). */

// The actual ExtSync brand mark (public/logo.png).
export function LogoIcon({ size = 36 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="ExtSync"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="object-contain"
    />
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
