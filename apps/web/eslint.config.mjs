// ESLint 9 flat config. Next 16 removed `next lint` (and builds no longer
// lint), so `npm run lint` invokes the ESLint CLI directly with this config.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
];

export default config;
