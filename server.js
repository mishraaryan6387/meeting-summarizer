// server.js - Node backend for Meeting Summarizer
// Place this file at project root (same level as /public, /whisper, /models)

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const mammoth = require("mammoth");

// robust pdf-parse import (works with different installs/interop)
let pdfParse = null;
try {
  const _p = require("pdf-parse");
  pdfParse = (typeof _p === "function") ? _p : (_p && typeof _p.default === "function" ? _p.default : null);
  if (!pdfParse) console.warn("pdf-parse loaded but no callable export found (will error if used).");
} catch (e) {
  console.warn("pdf-parse not installed or failed to load:", e && e.message);
  pdfParse = null;
}

// configure ffmpeg for fluent-ffmpeg
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
app.use(express.json());
app.use(require("cors")());

// Uploads directory
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR });

// whisper binary & model paths
const WHISPER_DIR = path.join(__dirname, "whisper");
let WHISPER_BIN = path.join(WHISPER_DIR, "whisper-cli.exe"); // preferred
if (!fs.existsSync(WHISPER_BIN)) {
  const alt = path.join(WHISPER_DIR, "main.exe");
  if (fs.existsSync(alt)) WHISPER_BIN = alt;
}
const MODEL_PATH = path.join(__dirname, "models", "ggml-tiny.en.bin"); // change if you use another model

console.log("Server start:");
console.log(" - ffmpeg:", ffmpegStatic ? ffmpegStatic : "system ffmpeg (not found via ffmpeg-static)");
console.log(" - whisper binary:", WHISPER_BIN, fs.existsSync(WHISPER_BIN) ? "(found)" : "(NOT FOUND)");
console.log(" - model:", MODEL_PATH, fs.existsSync(MODEL_PATH) ? "(found)" : "(NOT FOUND)");
console.log(" - uploads:", UPLOADS_DIR);

// ---------- helpers ----------

// safe unlink
function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ }
}

// convert any audio/video -> 16k mono wav
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// transcribe with whisper binary (whisper.cpp-style)
// returns the stdout text (trimmed)
function transcribeWithWhisper(wavPath) {
  return new Promise((resolve, reject) => {
    if (!WHISPER_BIN || !fs.existsSync(WHISPER_BIN)) {
      return reject(new Error("Whisper binary not found. Place whisper-cli.exe or main.exe inside /whisper"));
    }
    if (!fs.existsSync(MODEL_PATH)) {
      return reject(new Error("Model file not found. Place ggml-*.bin inside /models"));
    }

    // args commonly supported by whisper.cpp/whisper-bin builds
    const args = ["-m", MODEL_PATH, "-f", wavPath];

    // If your build supports -otxt or -of <file> you could use that.
    execFile(WHISPER_BIN, args, { maxBuffer: 1024 * 1024 * 200 }, (err, stdout, stderr) => {
      if (err) {
        const stderrMsg = (stderr || "").toString();
        return reject(new Error("Whisper failed: " + (err.message || stderrMsg)));
      }
      const out = (stdout || "").toString().trim();
      if (!out) return reject(new Error("Whisper returned empty output."));
      resolve(out);
    });
  });
}

// robust PDF text extraction using pdf-parse (handles .default interop)
async function extractTextFromPdf(filePath) {
  if (!pdfParse) {
    throw new Error("pdf-parse module not available. Run: npm install pdf-parse");
  }
  const data = fs.readFileSync(filePath);
  try {
    const parsed = await pdfParse(data);
    return (parsed && typeof parsed.text === "string") ? parsed.text : String((parsed && parsed.text) || "");
  } catch (err) {
    throw new Error("pdf-parse error: " + (err && err.message ? err.message : String(err)));
  }
}

// docx extraction
async function extractTextFromDocx(filePath) {
  const r = await mammoth.extractRawText({ path: filePath });
  return r && r.value ? r.value : "";
}

// very simple extractive summarizer (safe, no external libs)
function summarizeTextSimple(text, sentenceCount = 5) {
  if (!text || String(text).trim().length < 30) {
    const s = String(text || "");
    return { paragraph: s, bullets: s ? [s] : [] };
  }
  // Normalize whitespace and split into sentences
  const sentences = String(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.?!])\s+/)
    .filter(Boolean);
  const paragraph = sentences.slice(0, sentenceCount).join(" ");
  const bullets = sentences.slice(0, sentenceCount).map(s => s.trim());
  return { paragraph, bullets };
}

// ---------- routes ----------

// serve frontend (public/)
app.use(express.static(path.join(__dirname, "public")));

// explicit root fallback
app.get("/", (req, res) => {
  const file = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  res.send("<h1>Meeting Summarizer</h1><p>Put your frontend in /public</p>");
});

// health
app.get("/health", (req, res) => res.json({ ok: true }));

// main summarize endpoint: accepts text (body.text) OR file (field name "file")
app.post("/summarize", upload.single("file"), async (req, res) => {
  try {
    let text = (req.body && req.body.text) ? String(req.body.text).trim() : "";

    if (req.file && req.file.path) {
      const filePath = req.file.path;
      const original = req.file.originalname || "";
      const ext = (original.split(".").pop() || "").toLowerCase();

      try {
        if (ext === "txt") {
          text = fs.readFileSync(filePath, "utf8");
        } else if (ext === "pdf") {
          text = await extractTextFromPdf(filePath);
        } else if (ext === "docx" || ext === "doc") {
          text = await extractTextFromDocx(filePath);
        } else if (["mp3","wav","m4a","mp4","mov","webm","ogg","flac","aac"].includes(ext)) {
          const wavPath = filePath + ".wav";
          console.log("Converting to WAV:", filePath, "->", wavPath);
          await convertToWav(filePath, wavPath);
          console.log("Transcribing with Whisper:", wavPath);
          text = await transcribeWithWhisper(wavPath);
          safeUnlink(wavPath);
        } else {
          safeUnlink(filePath);
          return res.status(400).json({ paragraph: "Unsupported file type", bullets: [] });
        }
      } catch (innerErr) {
        console.error("Error processing uploaded file:", innerErr);
        safeUnlink(filePath);
        return res.status(500).json({ paragraph: "Error processing file: " + (innerErr && innerErr.message), bullets: [] });
      }

      // remove uploaded file after processing
      safeUnlink(filePath);
    }

    // ensure text is a string
    if (typeof text !== "string") text = String(text || "");
    if (!text.trim()) {
      return res.status(400).json({ paragraph: "No valid text or file provided", bullets: [] });
    }

    // Summarize
    console.log("Summarizing text length:", text.length);
    const { paragraph, bullets } = summarizeTextSimple(text, 6);

    return res.json({ paragraph: String(paragraph || ""), bullets: Array.isArray(bullets) ? bullets : [] });
  } catch (err) {
    console.error("Server error in /summarize:", err);
    return res.status(500).json({ paragraph: "Server error: " + (err && err.message ? err.message : String(err)), bullets: [] });
  }
});

// start
const PORT = parseInt(process.env.PORT || "5000", 10);
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
