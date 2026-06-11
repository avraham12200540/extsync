import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private/transactional areas: dashboard, device activation, personal
        // install links and one-time token pages have no business being indexed.
        disallow: ["/app", "/activate", "/install/", "/verify-email", "/reset-password"],
      },
    ],
    sitemap: "https://extsync.com/sitemap.xml",
  };
}
