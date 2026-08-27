import { NODEBB_ORIGIN } from "../lib/nodebb-origin";

/**
 * Reconstructs a safe, public, read-only NodeBB post URL for admins to
 * open in their own browser - server-side, from a validated numeric id
 * and the hardcoded origin only. Never accepts or stores a caller-supplied
 * URL/host, and this module has no fetch capability at all (it returns a
 * string; opening it is something the admin's own browser does, never
 * this server) - see the module doc on lib/nodebb-origin.ts for why this
 * file cannot even transitively import the fetch-capable importer client.
 */

export class InvalidNodebbIdError extends Error {}

/** NodeBB ids are positive integers; the length cap is generous but bounded so an absurd input can never bloat the constructed URL. */
const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

export function buildForumPostSourceUrl(forumPid: string): string {
  if (!NUMERIC_ID_PATTERN.test(forumPid)) {
    throw new InvalidNodebbIdError(`forumPid "${forumPid}" is not a valid numeric NodeBB post id`);
  }
  return `${NODEBB_ORIGIN}/post/${forumPid}`;
}
