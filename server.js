import "dotenv/config";
import express from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { getGenerationAdapter } from "./server/adapters/index.js";

const scrypt = promisify(scryptCallback);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const workerConcurrency = Math.max(1, Number(process.env.JOB_WORKER_CONCURRENCY || 2));
const jobRetryDelayMs = 10_000;
const jobMaxAttempts = 3;
const upstreamTimeoutMs = 1000 * 60 * 8;
const maxEditImages = 6;
const maxUploadBytes = 10 * 1024 * 1024;
const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "panghu.sqlite");
const generatedImagesDir = path.join(dataDir, "generated-images");
const jobInputsDir = path.join(dataDir, "job-inputs");
const logsDir = path.join(__dirname, "logs");
const serverLogFile = path.join(logsDir, "server.log");
const sessionCookie = "panghu_session";
const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 7;
const previewMaxEdge = 1600;
const thumbnailMaxEdge = 320;

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(generatedImagesDir, { recursive: true });
await fs.mkdir(jobInputsDir, { recursive: true });

const db = new DatabaseSync(dbFile);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

app.use(express.json({ limit: "2mb" }));

function nowIso() {
  return new Date().toISOString();
}

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logServer(event, details = {}) {
  const line = `${JSON.stringify({
    time: nowIso(),
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

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      quota_remaining INTEGER NOT NULL DEFAULT 10,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      user_id INTEGER,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      revised_prompt TEXT,
      size TEXT NOT NULL,
      quality TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL,
      image_url TEXT,
      original_image_url TEXT,
      stored_image_path TEXT,
      preview_image_url TEXT,
      preview_image_path TEXT,
      thumbnail_image_url TEXT,
      thumbnail_image_path TEXT,
      image_content_type TEXT,
      status TEXT NOT NULL,
      usage_json TEXT,
      raw_json TEXT,
      request_json TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      provider_id TEXT,
      model TEXT,
      prompt TEXT,
      size TEXT,
      quality TEXT,
      count INTEGER,
      mode TEXT,
      status TEXT NOT NULL,
      generation_id TEXT,
      job_id TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      params_json TEXT,
      image_url TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('generate', 'edit')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'retrying', 'done', 'failed')),
      request_json TEXT NOT NULL,
      input_files_json TEXT,
      generation_id TEXT,
      log_id INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      available_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL,
      FOREIGN KEY (log_id) REFERENCES generation_logs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_generations_user_created ON generations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_logs_created ON generation_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_logs_user_created ON generation_logs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_created ON generation_jobs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_available ON generation_jobs(status, available_at, created_at);
  `);
}

function getTableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = new Set(getTableColumns(tableName));
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function runMigrations() {
  // 兼容已有 SQLite 数据库，避免因为新增字段导致老环境启动失败。
  ensureColumn("generations", "request_json", "TEXT");
  ensureColumn("generations", "preview_image_url", "TEXT");
  ensureColumn("generations", "preview_image_path", "TEXT");
  ensureColumn("generations", "thumbnail_image_url", "TEXT");
  ensureColumn("generations", "thumbnail_image_path", "TEXT");
  ensureColumn("generation_logs", "updated_at", "TEXT");
  ensureColumn("generation_logs", "job_id", "TEXT");
  ensureColumn("generation_logs", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("generation_logs", "image_url", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_generation_logs_job_id ON generation_logs(job_id)");
}

initDb();
runMigrations();

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function tokenHash(token) {
  const secret = process.env.SESSION_SECRET || "panghu-dev-session-secret";
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

function setSessionCookie(res, token) {
  const isSecure = process.env.NODE_ENV === "production";
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    maxAge: sessionMaxAgeMs,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(sessionCookie, { path: "/" });
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash || "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    quotaRemaining: row.quota_remaining,
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonValue(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function userImageFolderName(username) {
  return String(username || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function userImageDir(username) {
  return path.join(generatedImagesDir, userImageFolderName(username));
}

function jobInputDir(jobId) {
  return path.join(jobInputsDir, jobId);
}

function absoluteStoredPath(storedPath) {
  return storedPath ? path.join(__dirname, storedPath) : null;
}

function imageAssetRelativePath(username, filename) {
  return `data/generated-images/${userImageFolderName(username)}/${filename}`;
}

function imageAssetAbsolutePath(username, filename) {
  return path.join(__dirname, imageAssetRelativePath(username, filename));
}

function imageAssetUrl(username, filename) {
  return `/api/generated-images/${userImageFolderName(username)}/${filename}`;
}

function buildImageAssetRecord(generationId, username, originalExtension) {
  const safeExtension = String(originalExtension || "png").replace(/^\./, "") || "png";
  const originalFilename = `${generationId}.orig.${safeExtension}`;
  const previewFilename = `${generationId}.preview.webp`;
  const thumbnailFilename = `${generationId}.thumb.webp`;

  return {
    originalFilename,
    previewFilename,
    thumbnailFilename,
    originalRelativePath: imageAssetRelativePath(username, originalFilename),
    previewRelativePath: imageAssetRelativePath(username, previewFilename),
    thumbnailRelativePath: imageAssetRelativePath(username, thumbnailFilename),
    originalAbsolutePath: imageAssetAbsolutePath(username, originalFilename),
    previewAbsolutePath: imageAssetAbsolutePath(username, previewFilename),
    thumbnailAbsolutePath: imageAssetAbsolutePath(username, thumbnailFilename),
    previewUrl: imageAssetUrl(username, previewFilename),
    thumbnailUrl: imageAssetUrl(username, thumbnailFilename),
  };
}

function isServableDerivedFilename(filename = "") {
  return /\.((preview|thumb)\.webp)$/i.test(filename);
}

async function clearUserImageDir(username) {
  await fs.rm(userImageDir(username), { recursive: true, force: true });
}

function createSession({ role, userId = null }) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionMaxAgeMs).toISOString();
  db.prepare(
    "INSERT INTO sessions (token_hash, role, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(tokenHash(token), role, userId, expiresAt, createdAt);
  return token;
}

function deleteCurrentSession(req) {
  const token = parseCookies(req.headers.cookie || "")[sessionCookie];
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie || "")[sessionCookie];
  if (!token) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash(token));
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return null;
  }
  return session;
}

function getAuthContext(req) {
  const session = getSession(req);
  if (!session) return null;
  if (session.role === "admin") return { role: "admin", session };
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  if (!user || !user.is_enabled) return null;
  return { role: "user", session, user };
}

function requireUser(req, res, next) {
  const auth = getAuthContext(req);
  if (!auth || auth.role !== "user") {
    return res.status(401).json({ error: "请先登录后再使用生图功能。" });
  }
  req.auth = auth;
  next();
}

function requireAdmin(req, res, next) {
  const auth = getAuthContext(req);
  if (!auth || auth.role !== "admin") {
    return res.status(auth ? 403 : 401).json({ error: "需要管理员登录。" });
  }
  req.auth = auth;
  next();
}

function generationFromRow(row) {
  const previewUrl = row.preview_image_url || row.image_url || null;
  const thumbnailUrl = row.thumbnail_image_url || previewUrl;
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    providerId: row.provider_id,
    adapterId: row.adapter_id,
    model: row.model,
    prompt: row.prompt,
    revisedPrompt: row.revised_prompt,
    size: row.size,
    quality: row.quality,
    count: row.count,
    mode: row.mode,
    imageUrl: previewUrl,
    previewUrl,
    thumbnailUrl,
    downloadUrl: `/api/images/history/${row.id}/download`,
    status: row.status,
    usage: parseJsonValue(row.usage_json),
    request: parseJsonValue(row.request_json, {}),
  };
}

function saveGeneration(record) {
  db.prepare(`
    INSERT INTO generations (
      id, user_id, created_at, provider_id, adapter_id, model, prompt, revised_prompt,
      size, quality, count, mode, image_url, original_image_url, stored_image_path,
      preview_image_url, preview_image_path, thumbnail_image_url, thumbnail_image_path,
      image_content_type, status, usage_json, raw_json, request_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.userId,
    record.createdAt,
    record.providerId,
    record.adapterId,
    record.model,
    record.prompt,
    record.revisedPrompt,
    record.size,
    record.quality,
    record.count,
    record.mode,
    record.imageUrl,
    record.originalImageUrl,
    record.storedImagePath,
    record.previewImageUrl,
    record.previewImagePath,
    record.thumbnailImageUrl,
    record.thumbnailImagePath,
    record.imageContentType,
    record.status,
    JSON.stringify(record.usage || null),
    JSON.stringify(record.raw || null),
    JSON.stringify(record.request || null),
  );
}

function createGenerationLog({ user, request, status, jobId, attemptCount = 0, errorMessage = null, imageUrl = null }) {
  const createdAt = nowIso();
  const result = db.prepare(`
    INSERT INTO generation_logs (
      user_id, username, display_name, created_at, updated_at, provider_id, model, prompt,
      size, quality, count, mode, status, generation_id, job_id, error_message, duration_ms,
      attempt_count, params_json, image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user?.id || null,
    user?.username || null,
    user?.display_name || null,
    createdAt,
    createdAt,
    request?.providerId || null,
    request?.model || null,
    request?.prompt || null,
    request?.size || null,
    request?.quality || null,
    Number(request?.count || 1),
    request?.mode || null,
    status,
    null,
    jobId,
    errorMessage,
    null,
    attemptCount,
    JSON.stringify(request || null),
    imageUrl,
  );
  return Number(result.lastInsertRowid);
}

function updateGenerationLog(logId, patch = {}) {
  const existing = db.prepare("SELECT * FROM generation_logs WHERE id = ?").get(logId);
  if (!existing) return;
  db.prepare(`
    UPDATE generation_logs
    SET status = ?, generation_id = ?, error_message = ?, duration_ms = ?, updated_at = ?, attempt_count = ?, image_url = ?
    WHERE id = ?
  `).run(
    patch.status ?? existing.status,
    patch.generationId ?? existing.generation_id,
    patch.errorMessage ?? existing.error_message,
    patch.durationMs ?? existing.duration_ms,
    nowIso(),
    patch.attemptCount ?? existing.attempt_count,
    patch.imageUrl ?? existing.image_url,
    logId,
  );
}

function extensionFromContentType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

function parseDataUrl(value = "") {
  const match = /^data:([^;,]+)?(?:;base64)?,([\s\S]+)$/i.exec(value);
  if (!match) return null;
  return {
    contentType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function fetchSourceImagePayload(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.startsWith("data:")) {
    return parseDataUrl(sourceUrl);
  }
  if (!sourceUrl.startsWith("http://") && !sourceUrl.startsWith("https://")) {
    return null;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  return { contentType, buffer: Buffer.from(arrayBuffer) };
}

async function writeDerivedImagesFromBuffer(buffer, assets) {
  await fs.mkdir(path.dirname(assets.originalAbsolutePath), { recursive: true });
  await sharp(buffer)
    .resize({
      width: previewMaxEdge,
      height: previewMaxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toFile(assets.previewAbsolutePath);
  await sharp(buffer)
    .resize({
      width: thumbnailMaxEdge,
      height: thumbnailMaxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 76 })
    .toFile(assets.thumbnailAbsolutePath);
}

async function cacheGeneratedImage(id, sourceUrl, username) {
  const payload = await fetchSourceImagePayload(sourceUrl);
  if (!payload?.buffer?.length) return null;

  const contentType = payload.contentType || "image/png";
  const extension = extensionFromContentType(contentType);
  const assets = buildImageAssetRecord(id, username, extension);
  await fs.mkdir(path.dirname(assets.originalAbsolutePath), { recursive: true });
  await fs.writeFile(assets.originalAbsolutePath, payload.buffer);
  await writeDerivedImagesFromBuffer(payload.buffer, assets);

  return {
    storedImagePath: assets.originalRelativePath,
    previewImageUrl: assets.previewUrl,
    previewImagePath: assets.previewRelativePath,
    thumbnailImageUrl: assets.thumbnailUrl,
    thumbnailImagePath: assets.thumbnailRelativePath,
    contentType,
  };
}

async function safeMoveFile(fromPath, toPath) {
  if (fromPath === toPath) return;
  await fs.mkdir(path.dirname(toPath), { recursive: true });
  try {
    await fs.rename(fromPath, toPath);
  } catch (error) {
    if (error?.code === "EXDEV" || error?.code === "EPERM" || error?.code === "EACCES") {
      await fs.copyFile(fromPath, toPath);
      await fs.unlink(fromPath).catch(() => null);
      return;
    }
    throw error;
  }
}

async function deleteFileIfExists(filePath) {
  if (!filePath) return;
  await fs.rm(filePath, { force: true }).catch(() => null);
}

async function cleanupJobInputFiles(job) {
  const files = parseJsonValue(job.input_files_json, []);
  await Promise.all(files.map((file) => deleteFileIfExists(file.absolutePath)));
  await fs.rm(jobInputDir(job.id), { recursive: true, force: true }).catch(() => null);
}

async function deleteGenerationAssetFiles(row) {
  await Promise.all(
    [row.stored_image_path, row.preview_image_path, row.thumbnail_image_path]
      .filter(Boolean)
      .map((assetPath) => deleteFileIfExists(absoluteStoredPath(assetPath))),
  );
}

function sourceImageUrlFromRow(row) {
  if (row.original_image_url) return row.original_image_url;
  if (row.image_url?.startsWith("http://") || row.image_url?.startsWith("https://") || row.image_url?.startsWith("data:")) {
    return row.image_url;
  }
  return null;
}

async function persistDerivedImageFields(generationId, fields) {
  db.prepare(`
    UPDATE generations
    SET image_url = ?,
        stored_image_path = ?,
        preview_image_url = ?,
        preview_image_path = ?,
        thumbnail_image_url = ?,
        thumbnail_image_path = ?,
        image_content_type = COALESCE(?, image_content_type)
    WHERE id = ?
  `).run(
    fields.previewImageUrl || null,
    fields.storedImagePath || null,
    fields.previewImageUrl || null,
    fields.previewImagePath || null,
    fields.thumbnailImageUrl || null,
    fields.thumbnailImagePath || null,
    fields.contentType || null,
    generationId,
  );
}

async function ensureDerivedImages(row) {
  const hasPreview = row.preview_image_url && row.preview_image_path;
  const hasThumb = row.thumbnail_image_url && row.thumbnail_image_path;
  const hasOriginal = row.stored_image_path && syncFs.existsSync(absoluteStoredPath(row.stored_image_path));
  if (hasPreview && hasThumb && hasOriginal) return row;

  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(row.user_id);
  if (!user?.username) return row;

  let fields = null;
  if (hasOriginal) {
    const buffer = await fs.readFile(absoluteStoredPath(row.stored_image_path));
    const extension = path.extname(row.stored_image_path).replace(/^\./, "") || extensionFromContentType(row.image_content_type || "");
    const assets = buildImageAssetRecord(row.id, user.username, extension);
    await writeDerivedImagesFromBuffer(buffer, assets);
    fields = {
      storedImagePath: row.stored_image_path,
      previewImageUrl: assets.previewUrl,
      previewImagePath: assets.previewRelativePath,
      thumbnailImageUrl: assets.thumbnailUrl,
      thumbnailImagePath: assets.thumbnailRelativePath,
      contentType: row.image_content_type || null,
    };
  } else {
    fields = await cacheGeneratedImage(row.id, sourceImageUrlFromRow(row), user.username);
  }

  if (!fields) return row;

  await persistDerivedImageFields(row.id, fields);
  return { ...row, image_url: fields.previewImageUrl, stored_image_path: fields.storedImagePath, preview_image_url: fields.previewImageUrl, preview_image_path: fields.previewImagePath, thumbnail_image_url: fields.thumbnailImageUrl, thumbnail_image_path: fields.thumbnailImagePath, image_content_type: fields.contentType || row.image_content_type };
}

async function moveGenerationImagesToUser(generationRows, targetUser) {
  const targetDir = userImageDir(targetUser.username);
  await fs.mkdir(targetDir, { recursive: true });

  const movedFiles = [];
  const updates = [];

  for (const row of generationRows) {
    const assetPairs = [
      ["stored_image_path", "storedImagePath"],
      ["preview_image_path", "previewImagePath"],
      ["thumbnail_image_path", "thumbnailImagePath"],
    ];
    const nextFields = {};

    for (const [dbKey, updateKey] of assetPairs) {
      const currentRelativePath = row[dbKey];
      if (!currentRelativePath) continue;
      const currentPath = absoluteStoredPath(currentRelativePath);
      const filename = path.basename(currentRelativePath);
      const nextRelativePath = imageAssetRelativePath(targetUser.username, filename);
      const nextPath = path.join(__dirname, nextRelativePath);

      if (currentPath && syncFs.existsSync(currentPath)) {
        if (currentPath !== nextPath) {
          await safeMoveFile(currentPath, nextPath);
          movedFiles.push({ fromPath: currentPath, toPath: nextPath });
        }
      } else {
        await logServer("generation.transfer_missing_source", {
          generationId: row.id,
          asset: dbKey,
          storedImagePath: currentRelativePath,
        });
      }

      nextFields[updateKey] = nextRelativePath;
    }

    updates.push({
      id: row.id,
      storedImagePath: nextFields.storedImagePath || null,
      previewImagePath: nextFields.previewImagePath || null,
      thumbnailImagePath: nextFields.thumbnailImagePath || null,
      previewImageUrl: nextFields.previewImagePath ? imageAssetUrl(targetUser.username, path.basename(nextFields.previewImagePath)) : null,
      thumbnailImageUrl: nextFields.thumbnailImagePath ? imageAssetUrl(targetUser.username, path.basename(nextFields.thumbnailImagePath)) : null,
    });
  }

  db.exec("BEGIN");
  try {
    for (const update of updates) {
      db.prepare(`
        UPDATE generations
        SET image_url = ?,
            stored_image_path = ?,
            preview_image_url = ?,
            preview_image_path = ?,
            thumbnail_image_url = ?,
            thumbnail_image_path = ?,
            user_id = ?
        WHERE id = ?
      `).run(
        update.previewImageUrl,
        update.storedImagePath,
        update.previewImageUrl,
        update.previewImagePath,
        update.thumbnailImageUrl,
        update.thumbnailImagePath,
        targetUser.id,
        update.id,
      );
    }
    db.prepare("UPDATE generation_logs SET user_id = ?, username = ?, display_name = ? WHERE user_id = ?").run(
      targetUser.id,
      targetUser.username,
      targetUser.display_name,
      generationRows[0]?.user_id || null,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    await Promise.all(
      movedFiles
        .slice()
        .reverse()
        .map(({ fromPath, toPath }) => safeMoveFile(toPath, fromPath).catch(() => null)),
    );
    throw error;
  }
}

function validateUserPayload(body, { requirePassword = true } = {}) {
  const username = String(body?.username || "").trim();
  const displayName = String(body?.displayName || body?.display_name || "").trim();
  const password = String(body?.password || "");
  const quotaRemaining = body?.quotaRemaining ?? body?.quota_remaining ?? 10;

  if (!username || username.length < 2) return { error: "用户名至少需要 2 个字符。" };
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return { error: "用户名只能包含字母、数字、下划线、点和短横线。" };
  if (!displayName) return { error: "显示名称不能为空。" };
  if (requirePassword && password.length < 6) return { error: "密码至少需要 6 个字符。" };
  const quota = Number(quotaRemaining);
  if (!Number.isInteger(quota) || quota < 0) return { error: "可用次数必须是非负整数。" };

  return { username, displayName, password, quotaRemaining: quota };
}

function validateRequestShape(body = {}, { requireImages = false } = {}) {
  const providerId = String(body.providerId || "panghu");
  const model = String(body.model || "gpt-image-2");
  const prompt = String(body.prompt || "").trim();
  const size = String(body.size || "auto");
  const quality = String(body.quality || "auto");
  const count = Math.max(1, Number(body.count || 1));
  const mode = requireImages ? "edit" : String(body.mode || "generate");

  if (!model || !prompt) return { error: "Model and prompt are required." };
  if (prompt.length < 1 || prompt.length > 32000) {
    return { error: "提示词长度需在 1 到 32000 个字符之间。" };
  }
  if (count !== 1) return { error: "当前仅支持单张输出。" };

  return {
    providerId,
    model,
    prompt,
    size,
    quality,
    count,
    mode,
  };
}

function createJobId(prefix = "job") {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function isTransientJobError(error) {
  if (!error) return false;
  if (error.transient === true) return true;
  if (error.statusCode && Number(error.statusCode) >= 500) return true;
  return ["AbortError", "TypeError"].includes(error.name);
}

function makeJobError(message, { statusCode = 502, transient = false } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.transient = transient;
  return error;
}

function loadJob(jobId) {
  return db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(jobId);
}

function enqueueJob({ user, type, request, inputFiles = [] }) {
  const createdAt = nowIso();
  const jobId = inputFiles[0]?.jobId || createJobId("job");
  const logId = createGenerationLog({ user, request, status: "queued", jobId, attemptCount: 0 });

  db.exec("BEGIN");
  try {
    // 任务提交即先扣配额，只有最终失败才退还，避免用户连续重复点击超发请求。
    const quotaResult = db
      .prepare("UPDATE users SET quota_remaining = quota_remaining - 1, updated_at = ? WHERE id = ? AND quota_remaining > 0")
      .run(createdAt, user.id);
    if (!quotaResult.changes) {
      throw new Error("可用生图次数不足，请联系管理员增加次数。");
    }
    db.prepare(`
      INSERT INTO generation_jobs (
        id, user_id, type, status, request_json, input_files_json, generation_id, log_id, attempt_count,
        last_error, created_at, started_at, updated_at, finished_at, available_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      user.id,
      type,
      "queued",
      JSON.stringify(request),
      JSON.stringify(inputFiles),
      null,
      logId,
      0,
      null,
      createdAt,
      null,
      createdAt,
      null,
      createdAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.prepare("DELETE FROM generation_logs WHERE id = ?").run(logId);
    throw error;
  }

  return { jobId, logId };
}

function claimNextJob() {
  db.exec("BEGIN IMMEDIATE");
  try {
    // 单进程下通过 SQLite 锁来串行领取任务，后续即使并发 worker 增加也不会重复消费同一条任务。
    const job = db.prepare(`
      SELECT * FROM generation_jobs
      WHERE status IN ('queued', 'retrying')
        AND available_at <= ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(nowIso());

    if (!job) {
      db.exec("COMMIT");
      return null;
    }

    const startedAt = job.started_at || nowIso();
    db.prepare(`
      UPDATE generation_jobs
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          started_at = ?,
          updated_at = ?,
          last_error = NULL
      WHERE id = ?
    `).run(startedAt, nowIso(), job.id);

    db.exec("COMMIT");
    return loadJob(job.id);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function finalizeFailedJob(job, errorMessage) {
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE generation_jobs
      SET status = 'failed',
          last_error = ?,
          updated_at = ?,
          finished_at = ?
      WHERE id = ?
    `).run(errorMessage, nowIso(), nowIso(), job.id);
    db.prepare("UPDATE users SET quota_remaining = quota_remaining + 1, updated_at = ? WHERE id = ?").run(nowIso(), job.user_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function finalizeSucceededJob(jobId, generationId) {
  db.prepare(`
    UPDATE generation_jobs
    SET status = 'done',
        generation_id = ?,
        updated_at = ?,
        finished_at = ?
    WHERE id = ?
  `).run(generationId, nowIso(), nowIso(), jobId);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider(job, request, adapter, user) {
  const inputFiles = parseJsonValue(job.input_files_json, []);
  const upstreamRequest = await adapter.buildRequest({ ...request, userId: user.id, files: inputFiles });
  await logServer("generation.upstream_start", { adapterId: adapter.id, jobId: job.id, type: job.type });
  const upstream = await fetchWithTimeout(upstreamRequest.url, upstreamRequest.options);
  await logServer("generation.upstream_response", { adapterId: adapter.id, status: upstream.status, jobId: job.id });

  const text = await upstream.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!upstream.ok) {
    const message = payload?.error?.message || payload?.error || "Image generation failed.";
    throw makeJobError(message, { statusCode: upstream.status, transient: upstream.status >= 500 });
  }

  const parsed = adapter.parseResponse(payload);
  if (!parsed?.imageUrl && !parsed?.originalImageUrl) {
    throw makeJobError("上游返回了无效的图片结果。", { transient: true });
  }

  return parsed;
}

async function executeJob(job) {
  const request = parseJsonValue(job.request_json, {});
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(job.user_id);
  if (!user || !user.is_enabled) {
    throw makeJobError("用户不存在或已被禁用。", { statusCode: 400 });
  }

  const adapter = getGenerationAdapter(request.providerId, request.model);
  if (!adapter) {
    throw makeJobError("Unsupported provider/model combination.", { statusCode: 400 });
  }

  adapter.assertConfigured();
  const parsed = await callProvider(job, request, adapter, user);
  const generationId = `gen_${Date.now()}_${randomBytes(3).toString("hex")}`;

  let cachedImage = null;
  try {
    cachedImage = await cacheGeneratedImage(generationId, parsed.originalImageUrl || parsed.imageUrl, user.username);
  } catch {
    cachedImage = null;
  }

  const inputFiles = parseJsonValue(job.input_files_json, []);
  const requestRecord = {
    ...request,
    // 历史里保留输入图摘要，便于后台排查具体用了哪些参考图。
    inputImages: inputFiles.map((file) => ({
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
    })),
  };

  const record = {
    id: generationId,
    userId: user.id,
    createdAt: nowIso(),
    providerId: request.providerId,
    adapterId: adapter.id,
    model: parsed.model,
    prompt: request.prompt,
    revisedPrompt: parsed.revisedPrompt,
    size: request.size,
    quality: request.quality,
    count: request.count,
    mode: request.mode,
    imageUrl: cachedImage?.previewImageUrl || parsed.imageUrl,
    originalImageUrl: parsed.originalImageUrl,
    storedImagePath: cachedImage?.storedImagePath || null,
    previewImageUrl: cachedImage?.previewImageUrl || parsed.imageUrl,
    previewImagePath: cachedImage?.previewImagePath || null,
    thumbnailImageUrl: cachedImage?.thumbnailImageUrl || parsed.imageUrl,
    thumbnailImagePath: cachedImage?.thumbnailImagePath || null,
    imageContentType: cachedImage?.contentType || null,
    status: "done",
    usage: parsed.usage,
    raw: parsed.raw,
    request: requestRecord,
  };

  saveGeneration(record);
  finalizeSucceededJob(job.id, record.id);
  updateGenerationLog(job.log_id, {
    status: "success",
    generationId: record.id,
    errorMessage: null,
    durationMs: Date.now() - new Date(job.created_at).getTime(),
    attemptCount: job.attempt_count,
    imageUrl: record.imageUrl,
  });
  await cleanupJobInputFiles(job);

  await logServer("generation.success", {
    id: record.id,
    jobId: job.id,
    adapterId: adapter.id,
    storedImage: Boolean(record.storedImagePath),
    hasOriginalUrl: Boolean(record.originalImageUrl),
  });
}

async function handleJobFailure(job, error) {
  const transient = isTransientJobError(error);
  const message = error?.message || "Unable to call image provider.";
  const latestJob = loadJob(job.id);
  const currentAttempts = latestJob?.attempt_count || job.attempt_count || 1;

  if (transient && currentAttempts < jobMaxAttempts) {
    // 只对瞬时错误重试，避免把参数错误或鉴权错误反复打给上游。
    db.prepare(`
      UPDATE generation_jobs
      SET status = 'retrying',
          last_error = ?,
          updated_at = ?,
          available_at = ?
      WHERE id = ?
    `).run(message, nowIso(), isoAfter(jobRetryDelayMs), job.id);
    updateGenerationLog(job.log_id, {
      status: "retrying",
      errorMessage: message,
      attemptCount: currentAttempts,
      durationMs: Date.now() - new Date(job.created_at).getTime(),
    });
    setTimeout(() => void scheduleWorkers(), jobRetryDelayMs + 50);
    return;
  }

  finalizeFailedJob(job, message);
  updateGenerationLog(job.log_id, {
    status: "failed",
    errorMessage: message,
    attemptCount: currentAttempts,
    durationMs: Date.now() - new Date(job.created_at).getTime(),
  });
  await cleanupJobInputFiles(job);
  await logServer("generation.failed", {
    providerId: parseJsonValue(job.request_json, {})?.providerId,
    model: parseJsonValue(job.request_json, {})?.model,
    jobId: job.id,
    error: message,
  });
}

let runningJobs = 0;
let workerLoopScheduled = false;

async function runWorkerLoop() {
  workerLoopScheduled = false;
  while (runningJobs < workerConcurrency) {
    const job = claimNextJob();
    if (!job) break;

    runningJobs += 1;
    updateGenerationLog(job.log_id, {
      status: "processing",
      attemptCount: job.attempt_count,
      durationMs: Date.now() - new Date(job.created_at).getTime(),
    });

    void (async () => {
      try {
        await executeJob(job);
      } catch (error) {
        await handleJobFailure(job, error);
      } finally {
        runningJobs -= 1;
        void scheduleWorkers();
      }
    })();
  }
}

async function scheduleWorkers() {
  if (workerLoopScheduled) return;
  workerLoopScheduled = true;
  queueMicrotask(() => {
    void runWorkerLoop();
  });
}

function getJobResult(job) {
  if (!job?.generation_id) return null;
  const generation = db.prepare("SELECT * FROM generations WHERE id = ?").get(job.generation_id);
  return generation ? generationFromRow(generation) : null;
}

function jobResponse(job) {
  return {
    jobId: job.id,
    status: job.status,
    attemptCount: job.attempt_count,
    error: job.last_error || null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.finished_at,
    result: job.status === "done" ? getJobResult(job) : null,
  };
}

async function recoverIncompleteJobs() {
  // 服务重启后，把卡在处理中/重试中的任务重新放回队列继续跑。
  db.prepare(`
    UPDATE generation_jobs
    SET status = 'queued',
        updated_at = ?,
        available_at = ?,
        last_error = COALESCE(last_error, '服务重启后自动恢复任务。')
    WHERE status IN ('processing', 'retrying')
  `).run(nowIso(), nowIso());
}

async function repairStoredGenerationFiles() {
  const rows = db.prepare(`
    SELECT g.id, g.user_id, g.image_url, g.stored_image_path, g.preview_image_path, g.thumbnail_image_path, u.username
    FROM generations g
    JOIN users u ON u.id = g.user_id
    WHERE g.stored_image_path IS NOT NULL AND g.stored_image_path != ''
  `).all();

  for (const row of rows) {
    const assetKeys = [
      ["stored_image_path", false],
      ["preview_image_path", true],
      ["thumbnail_image_path", true],
    ];

    try {
      const updates = {};
      for (const [key, isDerived] of assetKeys) {
        const currentRelativePath = row[key];
        if (!currentRelativePath) continue;
        const expectedRelativePath = imageAssetRelativePath(row.username, path.basename(currentRelativePath));
        const currentPath = absoluteStoredPath(currentRelativePath);
        const expectedPath = path.join(__dirname, expectedRelativePath);
        const folderMismatch = !currentRelativePath.includes(`/generated-images/${userImageFolderName(row.username)}/`) && !currentRelativePath.includes(`\\generated-images\\${userImageFolderName(row.username)}\\`);

        if (!folderMismatch && syncFs.existsSync(expectedPath)) {
          updates[key] = expectedRelativePath;
          if (isDerived) {
            updates[key === "preview_image_path" ? "preview_image_url" : "thumbnail_image_url"] = imageAssetUrl(row.username, path.basename(expectedRelativePath));
          }
          continue;
        }
        if (!currentPath || !syncFs.existsSync(currentPath)) continue;
        await safeMoveFile(currentPath, expectedPath);
        updates[key] = expectedRelativePath;
        if (isDerived) {
          updates[key === "preview_image_path" ? "preview_image_url" : "thumbnail_image_url"] = imageAssetUrl(row.username, path.basename(expectedRelativePath));
        }
      }

      if (Object.keys(updates).length) {
        db.prepare(`
          UPDATE generations
          SET stored_image_path = COALESCE(?, stored_image_path),
              preview_image_path = COALESCE(?, preview_image_path),
              preview_image_url = COALESCE(?, preview_image_url),
              thumbnail_image_path = COALESCE(?, thumbnail_image_path),
              thumbnail_image_url = COALESCE(?, thumbnail_image_url),
              image_url = COALESCE(?, image_url)
          WHERE id = ?
        `).run(
          updates.stored_image_path || null,
          updates.preview_image_path || null,
          updates.preview_image_url || null,
          updates.thumbnail_image_path || null,
          updates.thumbnail_image_url || null,
          updates.preview_image_url || null,
          row.id,
        );
      }
    } catch (error) {
      await logServer("generation.repair_failed", {
        generationId: row.id,
        error: error?.message || "repair failed",
      });
    }
  }
}

async function backfillMissingDerivedImages() {
  const rows = db.prepare(`
    SELECT *
    FROM generations
    WHERE stored_image_path IS NOT NULL
      AND stored_image_path != ''
      AND (
        preview_image_path IS NULL OR preview_image_path = ''
        OR thumbnail_image_path IS NULL OR thumbnail_image_path = ''
      )
    ORDER BY created_at DESC
  `).all();

  for (const row of rows) {
    try {
      await ensureDerivedImages(row);
    } catch (error) {
      await logServer("generation.backfill_derived_failed", {
        generationId: row.id,
        error: error?.message || "backfill failed",
      });
    }
  }
}

function prepareEditUpload(req, res, next) {
  req.pendingUploadId = createJobId("job");
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = jobInputDir(req.pendingUploadId || createJobId("job"));
      req.pendingUploadId = path.basename(dir);
      syncFs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9_.-]/g, "_");
      cb(null, `${Date.now()}-${randomBytes(3).toString("hex")}-${safeName}`);
    },
  }),
  limits: {
    fileSize: maxUploadBytes,
    files: maxEditImages,
  },
  fileFilter(req, file, cb) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      cb(new Error("仅支持 PNG、JPG、JPEG、WEBP 图片。"));
      return;
    }
    cb(null, true);
  },
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, workerConcurrency });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !user.is_enabled || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "用户名或密码不正确。" });
  }
  const token = createSession({ role: "user", userId: user.id });
  setSessionCookie(res, token);
  res.json({ user: sanitizeUser(user), role: "user" });
});

app.post("/api/auth/logout", (req, res) => {
  deleteCurrentSession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const auth = getAuthContext(req);
  if (!auth) return res.status(401).json({ user: null });
  if (auth.role === "admin") return res.json({ role: "admin", user: null });
  res.json({ role: "user", user: sanitizeUser(auth.user) });
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  const adminUsername = process.env.ADMIN_USERNAME || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "";

  if (!adminUsername || !adminPassword) {
    return res.status(503).json({ error: "管理员账号未配置。" });
  }
  if (!safeCompare(username, adminUsername) || !safeCompare(password, adminPassword)) {
    return res.status(401).json({ error: "管理员账号或密码不正确。" });
  }

  const token = createSession({ role: "admin" });
  setSessionCookie(res, token);
  res.json({ role: "admin", user: { username: adminUsername, displayName: "管理员" } });
});

app.post("/api/admin/logout", (req, res) => {
  deleteCurrentSession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const auth = getAuthContext(req);
  if (!auth || auth.role !== "admin") return res.status(401).json({ user: null });
  res.json({ role: "admin", user: { username: process.env.ADMIN_USERNAME || "admin", displayName: "管理员" } });
});

app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS value FROM users").get().value;
  const enabledUsers = db.prepare("SELECT COUNT(*) AS value FROM users WHERE is_enabled = 1").get().value;
  const totalCalls = db.prepare("SELECT COUNT(*) AS value FROM generation_logs").get().value;
  const successCalls = db.prepare("SELECT COUNT(*) AS value FROM generation_logs WHERE status = 'success'").get().value;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCalls = db.prepare("SELECT COUNT(*) AS value FROM generation_logs WHERE created_at >= ?").get(todayStart.toISOString()).value;
  const totalRemaining = db.prepare("SELECT COALESCE(SUM(quota_remaining), 0) AS value FROM users").get().value;
  const recentLogs = db
    .prepare(
      `SELECT id, username, display_name, created_at, model, prompt, size, quality, status, error_message, image_url
       FROM generation_logs
       ORDER BY created_at DESC
       LIMIT 8`,
    )
    .all();

  res.json({
    stats: { users, enabledUsers, totalCalls, successCalls, todayCalls, totalRemaining },
    recentLogs,
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(sanitizeUser);
  res.json({ data: users });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const payload = validateUserPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  const createdAt = nowIso();
  try {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(payload.username);
    if (existing) return res.status(409).json({ error: "用户名已存在。" });
    await clearUserImageDir(payload.username);
    const passwordHash = await hashPassword(payload.password);
    const result = db
      .prepare(
        "INSERT INTO users (username, display_name, password_hash, quota_remaining, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
      )
      .run(payload.username, payload.displayName, passwordHash, payload.quotaRemaining, createdAt, createdAt);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "用户名已存在。" });
    }
    res.status(500).json({ error: error?.message || "无法创建用户。" });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "用户不存在。" });

  const deleteImages = Boolean(req.body?.deleteImages);
  const rows = db.prepare("SELECT stored_image_path FROM generations WHERE user_id = ?").all(id);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM generation_jobs WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM generations WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  if (deleteImages) {
    await clearUserImageDir(user.username);
    await Promise.all(
      rows
        .map((row) => row.stored_image_path)
        .filter(Boolean)
        .map((storedPath) => fs.rm(path.join(__dirname, storedPath), { force: true }).catch(() => null)),
    );
  }

  res.json({ ok: true });
});

app.post("/api/admin/generations/transfer", requireAdmin, async (req, res) => {
  const fromUserId = Number(req.body?.fromUserId);
  const toUserId = Number(req.body?.toUserId);
  if (!fromUserId || !toUserId) {
    return res.status(400).json({ error: "请选择来源用户和目标用户。" });
  }
  if (fromUserId === toUserId) {
    return res.status(400).json({ error: "同一个用户无法转移图片，请选择不同的目标用户。" });
  }

  const fromUser = db.prepare("SELECT * FROM users WHERE id = ?").get(fromUserId);
  const toUser = db.prepare("SELECT * FROM users WHERE id = ?").get(toUserId);
  if (!fromUser || !toUser) return res.status(404).json({ error: "用户不存在。" });

  try {
    const rows = db.prepare(`
      SELECT id, user_id, image_url, stored_image_path, preview_image_path, thumbnail_image_path
      FROM generations
      WHERE user_id = ?
    `).all(fromUserId);
    await moveGenerationImagesToUser(rows, toUser);
    res.json({ ok: true, transferred: rows.length });
  } catch (error) {
    await logServer("admin.generations_transfer_failed", {
      fromUserId,
      toUserId,
      error: error?.message || "Unable to transfer generations.",
    });
    res.status(500).json({ error: error?.message || "图片转移失败，请检查本地图片文件是否可访问。" });
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "用户不存在。" });

  const displayName = req.body.displayName === undefined ? existing.display_name : String(req.body.displayName || "").trim();
  const quotaRemaining = req.body.quotaRemaining === undefined ? existing.quota_remaining : Number(req.body.quotaRemaining);
  const isEnabled = req.body.isEnabled === undefined ? Boolean(existing.is_enabled) : Boolean(req.body.isEnabled);
  const password = req.body.password === undefined ? "" : String(req.body.password || "");

  if (!displayName) return res.status(400).json({ error: "显示名称不能为空。" });
  if (!Number.isInteger(quotaRemaining) || quotaRemaining < 0) return res.status(400).json({ error: "可用次数必须是非负整数。" });
  if (req.body.password !== undefined && password.length > 0 && password.length < 6) {
    return res.status(400).json({ error: "密码至少需要 6 个字符。" });
  }

  const passwordHash = password ? await hashPassword(password) : existing.password_hash;
  db.prepare(
    "UPDATE users SET display_name = ?, password_hash = ?, quota_remaining = ?, is_enabled = ?, updated_at = ? WHERE id = ?",
  ).run(displayName, passwordHash, quotaRemaining, isEnabled ? 1 : 0, nowIso(), id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  res.json({ user: sanitizeUser(user) });
});

app.get("/api/admin/generation-logs", requireAdmin, async (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.userId) {
    filters.push("gl.user_id = ?");
    params.push(Number(req.query.userId));
  }
  if (req.query.status) {
    filters.push("gl.status = ?");
    params.push(String(req.query.status));
  }
  if (req.query.from) {
    filters.push("gl.created_at >= ?");
    params.push(String(req.query.from));
  }
  if (req.query.to) {
    filters.push("gl.created_at <= ?");
    params.push(String(req.query.to));
  }

  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 30)));
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS value FROM generation_logs gl ${where}`).get(...params).value;
  const rows = db
    .prepare(
      `SELECT gl.id, gl.user_id, gl.username, gl.display_name, gl.created_at, gl.updated_at, gl.provider_id, gl.model, gl.prompt,
              gl.size, gl.quality, gl.count, gl.mode, gl.status, gl.generation_id, gl.job_id, gl.error_message, gl.duration_ms,
              gl.params_json, gl.attempt_count, COALESCE(gl.image_url, g.image_url) AS image_url,
              g.preview_image_url, g.preview_image_path, g.thumbnail_image_url, g.thumbnail_image_path, g.stored_image_path, g.original_image_url
       FROM generation_logs gl
       LEFT JOIN generations g ON g.id = gl.generation_id
       ${where}
       ORDER BY gl.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  const data = await Promise.all(
    rows.map(async (row) => {
      let derived = null;
      if (row.generation_id) {
        derived = await ensureDerivedImages({
          id: row.generation_id,
          user_id: row.user_id,
          image_url: row.image_url,
          preview_image_url: row.preview_image_url,
          preview_image_path: row.preview_image_path,
          thumbnail_image_url: row.thumbnail_image_url,
          thumbnail_image_path: row.thumbnail_image_path,
          stored_image_path: row.stored_image_path,
          original_image_url: row.original_image_url,
          image_content_type: null,
        }).catch(() => null);
      }
      const previewUrl = derived?.preview_image_url || row.preview_image_url || row.image_url || null;
      const thumbnailUrl = derived?.thumbnail_image_url || row.thumbnail_image_url || previewUrl;
      return {
        id: row.id,
        user_id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        provider_id: row.provider_id,
        model: row.model,
        prompt: row.prompt,
        size: row.size,
        quality: row.quality,
        count: row.count,
        mode: row.mode,
        status: row.status,
        error_message: row.error_message,
        duration_ms: row.duration_ms,
        attempt_count: row.attempt_count,
        image_url: previewUrl,
        thumbnail_url: thumbnailUrl,
      };
    }),
  );
  res.json({ data, page, pageSize, total });
});

app.get("/api/images/history", requireUser, async (req, res) => {
  const rows = db.prepare("SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(req.auth.user.id);
  const data = await Promise.all(rows.map((row) => ensureDerivedImages(row).catch(() => row)));
  res.json({ data: data.map(generationFromRow) });
});

app.get("/api/images/history/:id/download", requireUser, async (req, res) => {
  const row = db.prepare("SELECT * FROM generations WHERE id = ? AND user_id = ?").get(req.params.id, req.auth.user.id);
  if (!row) return res.status(404).json({ error: "历史记录不存在。" });

  const hydrated = await ensureDerivedImages(row).catch(() => row);
  const absolutePath = absoluteStoredPath(hydrated.stored_image_path);
  if (!absolutePath || !syncFs.existsSync(absolutePath)) {
    return res.status(404).json({ error: "原图不存在或已丢失。" });
  }

  res.setHeader("Content-Type", hydrated.image_content_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename=\"panghu-image-${req.params.id}${path.extname(absolutePath) || ".png"}\"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(absolutePath);
});

app.delete("/api/images/history/:id", requireUser, async (req, res) => {
  const row = db.prepare("SELECT * FROM generations WHERE id = ? AND user_id = ?").get(req.params.id, req.auth.user.id);
  if (!row) return res.status(404).json({ error: "历史记录不存在。" });

  db.prepare("DELETE FROM generations WHERE id = ?").run(row.id);
  await deleteGenerationAssetFiles(row);
  if (row.stored_image_path && !row.preview_image_path && !row.thumbnail_image_path) {
    await logServer("generation.history_delete_missing_file", {
      generationId: row.id,
      storedImagePath: row.stored_image_path,
      userId: req.auth.user.id,
    });
  }

  res.json({ ok: true });
});

app.use("/api/generated-images", (req, res, next) => {
  if (!isServableDerivedFilename(path.basename(req.path || ""))) {
    return res.status(404).json({ error: "图片不存在。" });
  }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  next();
});

app.use("/api/generated-images", express.static(generatedImagesDir));

app.post("/api/images/generations", requireUser, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.user.id);
  const requestShape = validateRequestShape(req.body);

  await logServer("generation.request", {
    providerId: req.body?.providerId,
    model: req.body?.model,
    size: req.body?.size,
    quality: req.body?.quality,
    userId: user.id,
    username: user.username,
    promptLength: String(req.body?.prompt || "").trim().length,
    mode: "generate",
  });

  if (requestShape.error) {
    return res.status(400).json({ error: requestShape.error });
  }
  if (user.quota_remaining <= 0) {
    return res.status(403).json({ error: "可用生图次数不足，请联系管理员增加次数。" });
  }
  if (!getGenerationAdapter(requestShape.providerId, requestShape.model)) {
    return res.status(400).json({ error: "Unsupported provider/model combination." });
  }

  try {
    const { jobId } = enqueueJob({
      user,
      type: "generate",
      request: { ...requestShape, mode: "generate" },
      inputFiles: [],
    });
    void scheduleWorkers();
    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    res.status(202).json({ jobId, status: "queued", quotaRemaining: updatedUser.quota_remaining });
  } catch (error) {
    res.status(500).json({ error: error?.message || "任务提交失败，请稍后重试。" });
  }
});

app.post("/api/images/edits", requireUser, prepareEditUpload, upload.array("image", maxEditImages), async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.user.id);
  const requestShape = validateRequestShape(req.body, { requireImages: true });
  const uploadedFiles = (req.files || []).map((file) => ({
    jobId: req.pendingUploadId,
    fieldName: file.fieldname,
    originalName: file.originalname,
    fileName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    absolutePath: file.path,
    relativePath: path.relative(__dirname, file.path).replaceAll("\\", "/"),
  }));

  await logServer("generation.request", {
    providerId: req.body?.providerId,
    model: req.body?.model,
    size: req.body?.size,
    quality: req.body?.quality,
    userId: user.id,
    username: user.username,
    promptLength: String(req.body?.prompt || "").trim().length,
    mode: "edit",
    images: uploadedFiles.length,
  });

  if (requestShape.error) {
    await fs.rm(jobInputDir(req.pendingUploadId), { recursive: true, force: true }).catch(() => null);
    return res.status(400).json({ error: requestShape.error });
  }
  if (!uploadedFiles.length) {
    await fs.rm(jobInputDir(req.pendingUploadId), { recursive: true, force: true }).catch(() => null);
    return res.status(400).json({ error: "请至少上传一张参考图。" });
  }
  if (user.quota_remaining <= 0) {
    await fs.rm(jobInputDir(req.pendingUploadId), { recursive: true, force: true }).catch(() => null);
    return res.status(403).json({ error: "可用生图次数不足，请联系管理员增加次数。" });
  }
  if (!getGenerationAdapter(requestShape.providerId, requestShape.model)) {
    await fs.rm(jobInputDir(req.pendingUploadId), { recursive: true, force: true }).catch(() => null);
    return res.status(400).json({ error: "Unsupported provider/model combination." });
  }

  try {
    const { jobId } = enqueueJob({
      user,
      type: "edit",
      request: { ...requestShape, mode: "edit" },
      inputFiles: uploadedFiles,
    });
    void scheduleWorkers();
    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    res.status(202).json({ jobId, status: "queued", quotaRemaining: updatedUser.quota_remaining });
  } catch (error) {
    await fs.rm(jobInputDir(req.pendingUploadId), { recursive: true, force: true }).catch(() => null);
    res.status(500).json({ error: error?.message || "任务提交失败，请稍后重试。" });
  }
});

app.get("/api/jobs/:id", requireUser, (req, res) => {
  const job = db.prepare("SELECT * FROM generation_jobs WHERE id = ? AND user_id = ?").get(req.params.id, req.auth.user.id);
  if (!job) return res.status(404).json({ error: "任务不存在。" });
  res.json(jobResponse(job));
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

app.use((error, req, res, next) => {
  if (!(error instanceof multer.MulterError) && !error?.message) {
    next(error);
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "单张参考图不能超过 10MB。" });
      return;
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      res.status(400).json({ error: `最多只能上传 ${maxEditImages} 张参考图。` });
      return;
    }
  }

  res.status(400).json({ error: error.message || "上传图片失败，请检查文件格式和大小。" });
});

app.use(express.static(path.join(__dirname, "dist")));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

await recoverIncompleteJobs();
await repairStoredGenerationFiles();
void backfillMissingDerivedImages();
void scheduleWorkers();

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
