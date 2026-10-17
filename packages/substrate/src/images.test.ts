import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, parseImageDataUrl } from "./images.js";

describe("inline image validation", () => {
  it.each([
    ["image/png", "\x89PNG\r\n\x1a\n"],
    ["image/jpeg", "\xff\xd8\xff"],
    ["image/gif", "GIF89a"],
    ["image/webp", "RIFFxxxxWEBP"],
  ])("recognizes %s and preserves its bytes", (mediaType, signature) => {
    const data = Buffer.from(signature, "binary").toString("base64");
    expect(parseImageDataUrl(`data:${mediaType};base64,${data}`)).toEqual({
      mediaType,
      data,
      size: signature.length,
    });
  });

  it("accepts exactly the byte limit and rejects one byte beyond it", () => {
    const bytes = Buffer.alloc(MAX_IMAGE_BYTES);
    bytes.write("GIF89a");
    expect(
      parseImageDataUrl(`data:image/gif;base64,${bytes.toString("base64")}`)
        .size,
    ).toBe(MAX_IMAGE_BYTES);
    expect(() =>
      parseImageDataUrl(
        `data:image/gif;base64,${Buffer.concat([bytes, Buffer.from([1])]).toString("base64")}`,
      ),
    ).toThrow("5 MiB");
  });

  it.each([
    "javascript:alert(1)",
    "https://example.com/image.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,!!!!",
    "data:image/png;base64,R0lGODlh",
    "data:image/png;base64,aGVsbG8=",
  ])("rejects unsafe or mislabeled data: %s", (url) => {
    expect(() => parseImageDataUrl(url)).toThrow();
  });
});
