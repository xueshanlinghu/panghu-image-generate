import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
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
const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "panghu.sqlite");
const generatedImagesDir = path.join(dataDir, "generated-images");
const logsDir = path.join(__dirname, "logs");
const serverLogFile = path.join(logsDir, "server.log");
const sessionCookie = "panghu_session";
const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 7;

await fs.mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

app.use(express.json({ limit: "2mb" }));

function nowIso() {
  return new Date().toISOString();
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
      image_content_type TEXT,
      status TEXT NOT NULL,
      usage_json TEXT,
      raw_json TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      prompt TEXT,
      size TEXT,
      quality TEXT,
      count INTEGER,
      mode TEXT,
      status TEXT NOT NULL,
      generation_id TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      params_json TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_generations_user_created ON generations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_logs_created ON generation_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_logs_user_created ON generation_logs(user_id, created_at DESC);
  `);
}

initDb();

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

function userImageFolderName(username) {
  return String(username || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function userImageDir(username) {
  return path.join(generatedImagesDir, userImageFolderName(username));
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
    imageUrl: row.image_url,
    originalImageUrl: row.original_image_url,
    storedImagePath: row.stored_image_path,
    imageContentType: row.image_content_type,
    status: row.status,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
  };
}

function saveGeneration(record) {
  db.prepare(`
    INSERT INTO generations (
      id, user_id, created_at, provider_id, adapter_id, model, prompt, revised_prompt,
      size, quality, count, mode, image_url, original_image_url, stored_image_path,
      image_content_type, status, usage_json, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    record.imageContentType,
    record.status,
    JSON.stringify(record.usage || null),
    JSON.stringify(record.raw || null),
  );
}

function writeGenerationLog({ user, request, status, generationId = null, errorMessage = null, startedAt }) {
  const duration = Number.isFinite(startedAt) ? Date.now() - startedAt : null;
  db.prepare(`
    INSERT INTO generation_logs (
      user_id, username, display_name, created_at, provider_id, model, prompt,
      size, quality, count, mode, status, generation_id, error_message, duration_ms, params_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user?.id || null,
    user?.username || null,
    user?.display_name || null,
    nowIso(),
    request?.providerId || null,
    request?.model || null,
    request?.prompt || null,
    request?.size || null,
    request?.quality || null,
    Number(request?.count || 1),
    request?.mode || null,
    status,
    generationId,
    errorMessage,
    duration,
    JSON.stringify({
      providerId: request?.providerId,
      model: request?.model,
      size: request?.size,
      quality: request?.quality,
      count: Number(request?.count || 1),
      mode: request?.mode,
    }),
  );
}

function extensionFromContentType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

async function cacheGeneratedImage(id, imageUrl, username) {
  if (!imageUrl?.startsWith("http")) return null;

  const response = await fetch(imageUrl);
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "image/png";
  const extension = extensionFromContentType(contentType);
  const filename = `${id}.${extension}`;
  const targetDir = userImageDir(username);
  await fs.mkdir(targetDir, { recursive: true });
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(path.join(targetDir, filename), Buffer.from(arrayBuffer));
  const folder = userImageFolderName(username);

  return {
    storedImageUrl: `/api/generated-images/${folder}/${filename}`,
    storedImagePath: `data/generated-images/${folder}/${filename}`,
    contentType,
  };
}

async function moveGenerationImagesToUser(generationRows, targetUsername) {
  const targetFolder = userImageFolderName(targetUsername);
  const targetDir = userImageDir(targetUsername);
  await fs.mkdir(targetDir, { recursive: true });

  for (const row of generationRows) {
    const currentPath = row.stored_image_path ? path.join(__dirname, row.stored_image_path) : null;
    const imageUrlPath = row.image_url?.startsWith("/api/generated-images/") ? row.image_url.replace("/api/generated-images/", "") : "";
    const filename = path.basename(currentPath || imageUrlPath || `${row.id}.png`);
    const nextRelativePath = `data/generated-images/${targetFolder}/${filename}`;
    const nextApiUrl = `/api/generated-images/${targetFolder}/${filename}`;
    const nextPath = path.join(__dirname, nextRelativePath);

    try {
      if (currentPath && currentPath !== nextPath) {
        await fs.mkdir(path.dirname(nextPath), { recursive: true });
        await fs.rm(nextPath, { force: true });
        await fs.rename(currentPath, nextPath);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    db.prepare("UPDATE generations SET image_url = ?, stored_image_path = ? WHERE id = ?").run(nextApiUrl, nextRelativePath, row.id);
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

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
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
  const todayCalls = db
    .prepare("SELECT COUNT(*) AS value FROM generation_logs WHERE created_at >= ?")
    .get(todayStart.toISOString()).value;
  const totalRemaining = db.prepare("SELECT COALESCE(SUM(quota_remaining), 0) AS value FROM users").get().value;
  const recentLogs = db
    .prepare(
      "SELECT id, username, display_name, created_at, model, prompt, size, quality, status, error_message FROM generation_logs ORDER BY created_at DESC LIMIT 8",
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
    const rows = db.prepare("SELECT id, image_url, stored_image_path FROM generations WHERE user_id = ?").all(fromUserId);
    await moveGenerationImagesToUser(rows, toUser.username);
    db.prepare("UPDATE generations SET user_id = ? WHERE user_id = ?").run(toUserId, fromUserId);
    db.prepare("UPDATE generation_logs SET user_id = ?, username = ?, display_name = ? WHERE user_id = ?").run(
      toUserId,
      toUser.username,
      toUser.display_name,
      fromUserId,
    );

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

app.get("/api/admin/generation-logs", requireAdmin, (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.userId) {
    filters.push("user_id = ?");
    params.push(Number(req.query.userId));
  }
  if (req.query.status) {
    filters.push("status = ?");
    params.push(String(req.query.status));
  }
  if (req.query.from) {
    filters.push("created_at >= ?");
    params.push(String(req.query.from));
  }
  if (req.query.to) {
    filters.push("created_at <= ?");
    params.push(String(req.query.to));
  }

  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 30)));
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS value FROM generation_logs ${where}`).get(...params).value;
  const data = db
    .prepare(
      `SELECT id, user_id, username, display_name, created_at, provider_id, model, prompt, size, quality, count, mode, status, generation_id, error_message, duration_ms, params_json
       FROM generation_logs ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ data, page, pageSize, total });
});

app.get("/api/images/history", requireUser, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
    .all(req.auth.user.id);
  res.json({ data: rows.map(generationFromRow) });
});

app.use("/api/generated-images", express.static(generatedImagesDir));

app.post("/api/images/generations", requireUser, async (req, res) => {
  const startedAt = Date.now();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.user.id);
  const { providerId, model, prompt, size, quality, count, mode } = req.body ?? {};
  const requestShape = {
    providerId,
    model,
    prompt: typeof prompt === "string" ? prompt.trim() : "",
    size: size || "auto",
    quality: quality || "auto",
    count: Number(count || 1),
    mode: mode || "generate",
  };

  await logServer("generation.request", {
    providerId,
    model,
    size,
    quality,
    userId: user.id,
    username: user.username,
    promptLength: requestShape.prompt.length,
  });

  if (!requestShape.model || !requestShape.prompt) {
    writeGenerationLog({ user, request: requestShape, status: "validation_failed", errorMessage: "Model and prompt are required.", startedAt });
    return res.status(400).json({ error: "Model and prompt are required." });
  }

  if (user.quota_remaining <= 0) {
    writeGenerationLog({ user, request: requestShape, status: "quota_exhausted", errorMessage: "可用生图次数不足。", startedAt });
    return res.status(403).json({ error: "可用生图次数不足，请联系管理员增加次数。" });
  }

  const adapter = getGenerationAdapter(providerId, model);
  if (!adapter) {
    writeGenerationLog({ user, request: requestShape, status: "validation_failed", errorMessage: "Unsupported provider/model combination.", startedAt });
    return res.status(400).json({ error: "Unsupported provider/model combination." });
  }

  try {
    adapter.assertConfigured();
    const request = adapter.buildRequest({ ...requestShape, userId: user.id });
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
      const message = payload?.error?.message || payload?.error || "Image generation failed.";
      writeGenerationLog({ user, request: requestShape, status: "upstream_error", errorMessage: message, startedAt });
      await logServer("generation.upstream_error", { adapterId: adapter.id, status: upstream.status, error: message });
      return res.status(upstream.status).json({ error: message, details: payload });
    }

    const parsed = adapter.parseResponse(payload);
    const id = `gen_${Date.now()}`;
    let cachedImage = null;
    try {
      cachedImage = await cacheGeneratedImage(id, parsed.originalImageUrl, user.username);
    } catch {
      cachedImage = null;
    }

    const record = {
      id,
      userId: user.id,
      createdAt: nowIso(),
      providerId,
      adapterId: adapter.id,
      model: parsed.model,
      prompt: requestShape.prompt,
      revisedPrompt: parsed.revisedPrompt,
      size: requestShape.size,
      quality: requestShape.quality,
      count: requestShape.count,
      mode: requestShape.mode,
      imageUrl: cachedImage?.storedImageUrl || parsed.imageUrl,
      originalImageUrl: parsed.originalImageUrl,
      storedImagePath: cachedImage?.storedImagePath || null,
      imageContentType: cachedImage?.contentType || null,
      status: "done",
      usage: parsed.usage,
      raw: parsed.raw,
    };

    db.exec("BEGIN");
    try {
      saveGeneration(record);
      db.prepare("UPDATE users SET quota_remaining = quota_remaining - 1, updated_at = ? WHERE id = ?").run(nowIso(), user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    writeGenerationLog({ user: updatedUser, request: requestShape, status: "success", generationId: record.id, startedAt });

    await logServer("generation.success", {
      id: record.id,
      adapterId: adapter.id,
      storedImage: Boolean(record.storedImagePath),
      hasOriginalUrl: Boolean(record.originalImageUrl),
    });

    res.json({
      ...generationFromRow({
        id: record.id,
        user_id: record.userId,
        created_at: record.createdAt,
        provider_id: record.providerId,
        adapter_id: record.adapterId,
        model: record.model,
        prompt: record.prompt,
        revised_prompt: record.revisedPrompt,
        size: record.size,
        quality: record.quality,
        count: record.count,
        mode: record.mode,
        image_url: record.imageUrl,
        original_image_url: record.originalImageUrl,
        stored_image_path: record.storedImagePath,
        image_content_type: record.imageContentType,
        status: record.status,
        usage_json: JSON.stringify(record.usage || null),
      }),
      quotaRemaining: updatedUser.quota_remaining,
    });
  } catch (error) {
    writeGenerationLog({ user, request: requestShape, status: "failed", errorMessage: error?.message || "Unable to call image provider.", startedAt });
    await logServer("generation.failed", { providerId, model, error: error?.message || "Unable to call image provider." });
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
