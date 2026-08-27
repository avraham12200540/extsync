/**
 * The one place mitmachim.top's origin is defined as a literal. Imported
 * by both the importer's fetch-capable client (importer/nodebb-client.ts)
 * and admin/source-url.ts, which only ever builds a display string and
 * never fetches - keeping the constant here (rather than re-exporting it
 * from nodebb-client.ts) means admin code never has an import path that
 * could transitively reach fetch capability.
 */
export const NODEBB_ORIGIN = "https://mitmachim.top";
