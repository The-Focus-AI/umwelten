# 0020 — OAuth client identity is hosted per product, not centrally

Status: Accepted
Date: 2026-07-29

## Context

The MCP 2026-07-28 revision deprecates Dynamic Client Registration in
favor of Client ID Metadata Documents: an OAuth `client_id` becomes a
stable HTTPS URL serving a JSON metadata document, fetched and validated
by authorization servers on demand. The URL *is* the client's identity —
rotating it later invalidates recorded consents everywhere — so where it
lives is a lock-in decision. Central hosting on one org site
(standards.thefocus.ai) and a uniform subdomain convention were both
considered and rejected.

## Decision

Each product hosts its own Client ID Metadata Document at an org-controlled
URL of its choosing. No central registry site, no mandated URL pattern.
What is fixed is the invariant, not the location:

- the URL is HTTPS on an apex the org controls, with a path component;
- the document's `client_id` equals its URL exactly, per spec;
- the product that owns the client owns the document's liveness — the URL
  must outlive any consent granted against it.

A product's choice of URL is made when that product first needs one;
umwelten's CLI client will pick its URL when CIMD support is implemented.

## Consequences

- Client identity is decoupled from any single deploy pipeline; no one
  site outage or migration can strand every client in the org at once.
- There is no single place to audit all client documents; discovering
  them is a per-product search. (Deliberately accepted over the
  convention's auditability.)
- `mcp-serve`'s authorization server accepts URL-formatted client_ids
  (fetch, validate `client_id` equals the URL, validate redirect URIs
  against the document, cache per HTTP headers) and advertises
  `client_id_metadata_document_supported`; the RFC 7591 `/oauth/register`
  endpoint remains as a fallback through the deprecation window.
- Client-side, credentials remain keyed by issuer (never reused across
  authorization servers); CIMD client ids are the exception the spec
  makes portable.
