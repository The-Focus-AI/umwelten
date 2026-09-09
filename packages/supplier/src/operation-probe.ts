/** Explicit endpoint probes for capabilities outside the language-model API. */

import type { CapabilityName, CapabilityProbe } from "./types.js";

/** Valid 2×2 red PNG used for a semantic vision check. */
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkJFSUaBG/3uQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0wOVQyMTozNzoyNiswMDowMBtm/WYAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMDlUMjE6Mzc6MjYrMDA6MDBqO0XaAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTA5VDIxOjM3OjI2KzAwOjAwPS5kBQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==";

/** Valid one-frame red WebM; generation probes remain separately opt-in. */
const RED_WEBM =
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHwEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggHa7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNTkuMjcuMTAwV0GNTGF2ZjU5LjI3LjEwMESJiEBEAAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYg46p8CvjoK/JyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgibCBELqBEJqBAhJUw2dAgXNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNTkuMjcuMTAwc3PbY8CLY8WIOOqfAr46CvxnyKVFo4dFTkNPREVSRIeYTGF2YzU5LjM3LjEwMCBsaWJ2cHgtdnA5Z8iiRaOIRFVSQVRJT05Eh5QwMDowMDowMC4wNDAwMDAwMDAAAB9DtnWw54EAo6uBAACAgkmDQgAA8AD2ADgkHBhKAAAwYAAAEL//9x2v////X9/////yKsAAHFO7a5G7j7OBALeK94EB8YIBpfCBAw==";

export interface OperationProbeOptions {
  runtimeUrl: string;
  model: string;
  credential?: string;
  /** Image and video generation can be materially billable and are opt-in. */
  generativeMedia?: boolean;
  fetchImpl?: typeof fetch;
}

interface OperationProbeResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  data?: Array<{ embedding?: unknown; b64_json?: unknown; url?: unknown }>;
  video?: unknown;
}

function silentWav(): Buffer {
  const sampleRate = 8_000;
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = sampleRate / 4;
  const dataBytes = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

async function probe(
  name: CapabilityName,
  task: () => Promise<boolean>,
): Promise<CapabilityProbe> {
  const start = Date.now();
  try {
    const supported = await task();
    return {
      name,
      supported,
      evidence: supported ? "runtime returned the expected contract" : "unexpected response shape",
      elapsedMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      supported: false,
      evidence: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - start,
    };
  }
}

/**
 * Probe real operation endpoints. Callers must opt in; this function never runs
 * during the ordinary chat probe battery, and generative media needs a second
 * explicit opt-in because it may trigger paid work.
 */
export async function probeOperationCapabilities(
  options: OperationProbeOptions,
): Promise<CapabilityProbe[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.runtimeUrl.replace(/\/$/, "");
  const headers = {
    ...(options.credential
      ? { authorization: `Bearer ${options.credential}` }
      : {}),
  };
  const json = async (path: string, body: Record<string, unknown>) => {
    const response = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json() as Promise<OperationProbeResponse>;
  };

  const results: CapabilityProbe[] = [];
  results.push(
    await probe("image-input", async () => {
      const body = await json("/chat/completions", {
        model: options.model,
        max_tokens: 16,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Name the image color in one word." },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${RED_PNG}` },
              },
            ],
          },
        ],
      });
      const answer = body.choices?.[0]?.message?.content;
      return typeof answer === "string" && /\bred\b/i.test(answer);
    }),
  );
  results.push(
    await probe("embeddings", async () => {
      const body = await json("/embeddings", {
        model: options.model,
        input: "capability probe",
      });
      return Array.isArray(body.data?.[0]?.embedding);
    }),
  );
  results.push(
    await probe("transcription", async () => {
      const form = new FormData();
      form.set("model", options.model);
      const wav = silentWav();
      form.set(
        "file",
        new Blob(
          [
            wav.buffer.slice(
              wav.byteOffset,
              wav.byteOffset + wav.byteLength,
            ) as ArrayBuffer,
          ],
          { type: "audio/wav" },
        ),
        "probe.wav",
      );
      const response = await doFetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!response.ok) throw new Error(`/audio/transcriptions returned ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      return typeof body.text === "string";
    }),
  );

  if (options.generativeMedia) {
    results.push(
      await probe("image-generation", async () => {
        const body = await json("/images/generations", {
          model: options.model,
          prompt: "one black pixel",
          n: 1,
          size: "256x256",
        });
        return Boolean(body.data?.[0]?.b64_json || body.data?.[0]?.url);
      }),
    );
    const videoBody = {
      model: options.model,
      prompt: "a still black frame",
      seconds: 1,
    };
    results.push(
      await probe("video-generation", async () => {
        const body = await json("/videos/generations", videoBody);
        return Boolean(body.data?.[0] || body.video);
      }),
    );
    results.push(
      await probe("video-input", async () => {
        const body = await json("/videos/generations", {
          ...videoBody,
          input_video: {
            media_type: "video/webm",
            // A real one-frame clip verifies that the runtime accepts the
            // media protocol rather than merely tolerating arbitrary bytes.
            data: RED_WEBM,
          },
        });
        return Boolean(body.data?.[0] || body.video);
      }),
    );
  }
  return results;
}
