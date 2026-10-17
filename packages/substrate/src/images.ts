/** The inline image contract shared by chat clients, rendering, and ingestion. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;
export const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;

/** No remote URLs, SVG, HTML, or filesystem paths cross this boundary. */
export function parseImageDataUrl(url: unknown): {
  mediaType: string;
  data: string;
  size: number;
} {
  if (
    typeof url !== "string" ||
    url.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
  )
    throw new Error("Each image must be 5 MiB or smaller.");
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      url,
    );
  if (!match || match[2].length % 4 !== 0)
    throw new Error("Use PNG, JPEG, WebP, or GIF image files.");
  const [, mediaType, data] = match;
  const bytes = atob(data);
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new Error("Each image must be 5 MiB or smaller.");
  const valid =
    mediaType === "image/png"
      ? bytes.startsWith("\x89PNG\r\n\x1a\n")
      : mediaType === "image/jpeg"
        ? bytes.startsWith("\xff\xd8\xff")
        : mediaType === "image/gif"
          ? /^GIF8[79]a/.test(bytes)
          : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("The file contents do not match the image type.");
  return { mediaType, data, size: bytes.length };
}
