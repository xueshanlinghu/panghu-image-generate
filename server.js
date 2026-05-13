import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGenerationAdapter } from "./server/adapters/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const dataDir = path.join(__dirname, "data");
const generationsFile = path.join(dataDir, "generations.json");
const generatedImagesDir = path.join(dataDir, "generated-images");
const logsDir = path.join(__dirname, "logs");
const serverLogFile = path.join(logsDir, "server.log");

app.use(express.json({ limit: "2mb" }));

async function logServer(event, details = {}) {
  const line = `${JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...details,
  })}\n`;
  console.log(line.trim());
  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(serverLogFile, line, "utf-8");
  } catch {
    // Logging must never break image generation.
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

async function readGenerations() {
  try {
    const content = await fs.readFile(generationsFile, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function saveGeneration(record) {
  await fs.mkdir(dataDir, { recursive: true });
  const records = await readGenerations();
  records.unshift(record);
  await fs.writeFile(generationsFile, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}

function extensionFromContentType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

async function cacheGeneratedImage(id, imageUrl) {
  if (!imageUrl?.startsWith("http")) return null;

  const response = await fetch(imageUrl);
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "image/png";
  const extension = extensionFromContentType(contentType);
  const filename = `${id}.${extension}`;
  await fs.mkdir(generatedImagesDir, { recursive: true });
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(path.join(generatedImagesDir, filename), Buffer.from(arrayBuffer));

  return {
    storedImageUrl: `/api/generated-images/${filename}`,
    storedImagePath: `data/generated-images/${filename}`,
    contentType,
  };
}

app.get("/api/images/history", async (req, res) => {
  try {
    const userId = String(req.query.userId || "local-preview-user");
    const records = await readGenerations();
    res.json({
      data: records.filter((record) => record.userId === userId).slice(0, 100),
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Unable to read image history." });
  }
});

app.use("/api/generated-images", express.static(generatedImagesDir));

app.post("/api/images/generations", async (req, res) => {
  const { providerId, model, prompt, size, quality, count, mode, userId = "local-preview-user" } = req.body ?? {};
  await logServer("generation.request", {
    providerId,
    model,
    size,
    quality,
    userId,
    promptLength: typeof prompt === "string" ? prompt.length : 0,
  });

  if (!model || !prompt?.trim()) {
    await logServer("generation.validation_failed", { reason: "missing_model_or_prompt" });
    return res.status(400).json({ error: "Model and prompt are required." });
  }

  const adapter = getGenerationAdapter(providerId, model);
  if (!adapter) {
    await logServer("generation.unsupported_adapter", { providerId, model });
    return res.status(400).json({ error: "Unsupported provider/model combination." });
  }

  try {
    adapter.assertConfigured();
    const request = adapter.buildRequest({ providerId, model, prompt, size, quality, count, mode, userId });
    await logServer("generation.upstream_start", { adapterId: adapter.id });
    const upstream = await fetch(request.url, request.options);
    await logServer("generation.upstream_response", { adapterId: adapter.id, status: upstream.status });

    const text = await upstream.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!upstream.ok) {
      await logServer("generation.upstream_error", {
        adapterId: adapter.id,
        status: upstream.status,
        error: payload?.error?.message || payload?.error || "Image generation failed.",
      });
      return res.status(upstream.status).json({
        error: payload?.error?.message || payload?.error || "Image generation failed.",
        details: payload,
      });
    }

    const parsed = adapter.parseResponse(payload);

    const id = `gen_${Date.now()}`;
    let cachedImage = null;
    try {
      cachedImage = await cacheGeneratedImage(id, parsed.originalImageUrl);
    } catch {
      cachedImage = null;
    }

    const record = {
      id,
      userId,
      createdAt: new Date().toISOString(),
      providerId,
      adapterId: adapter.id,
      model: parsed.model,
      prompt: prompt.trim(),
      revisedPrompt: parsed.revisedPrompt,
      size: size || "auto",
      quality: quality || "auto",
      count: Number(count || 1),
      mode: mode || "generate",
      imageUrl: cachedImage?.storedImageUrl || parsed.imageUrl,
      originalImageUrl: parsed.originalImageUrl,
      storedImagePath: cachedImage?.storedImagePath || null,
      imageContentType: cachedImage?.contentType || null,
      status: "done",
      usage: parsed.usage,
      raw: parsed.raw,
    };

    await saveGeneration(record);
    await logServer("generation.success", {
      id: record.id,
      adapterId: adapter.id,
      storedImage: Boolean(record.storedImagePath),
      hasOriginalUrl: Boolean(record.originalImageUrl),
    });

    res.json({
      id: record.id,
      userId: record.userId,
      createdAt: record.createdAt,
      providerId: record.providerId,
      model: record.model,
      prompt: record.prompt,
      revisedPrompt: record.revisedPrompt,
      size: record.size,
      quality: record.quality,
      count: record.count,
      mode: record.mode,
      imageUrl: record.imageUrl,
      originalImageUrl: record.originalImageUrl,
      status: record.status,
      usage: record.usage,
    });
  } catch (error) {
    await logServer("generation.failed", {
      providerId,
      model,
      error: error?.message || "Unable to call image provider.",
    });
    res.status(502).json({ error: error?.message || "Unable to call image provider." });
  }
});

app.get("/api/images/proxy", async (req, res) => {
  const imageUrl = String(req.query.url || "");
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
    return res.status(400).json({ error: "A valid image URL is required." });
  }

  try {
    const upstream = await fetch(imageUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Unable to fetch image." });
    }
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(502).json({ error: error?.message || "Unable to proxy image." });
  }
});

app.use(express.static(path.join(__dirname, "dist")));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const server = app.listen(port, () => {
  console.log(`Panghu API server listening on http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing API service or set API_PORT to another port.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
