import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared Markdown renderer for extension descriptions.
 * - remark-gfm enables GitHub-flavored Markdown, so a pasted raw URL auto-links
 *   (plain react-markdown only links [text](url) syntax).
 * - Links open in a new tab and carry rel="nofollow ugc noopener" (user content).
 *   react-markdown sanitizes hrefs (no javascript:/data:), so this is XSS-safe.
 * Wrap the output in a `.md-body` container for the description styles.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
