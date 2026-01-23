import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import OpenAI from "openai";
import path from "path";
import { Server as SocketIOServer } from "socket.io";

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

interface ChatState {
  audioBuffers: Buffer[];
  recentBuffers: Buffer[];
  lastFlush: number;
  firstChunkTime: number | null;
  totalBytesReceived: number;
  isProcessing: boolean;
  lastProcessedTime: number;
  lastTranscribedText: string;
  language: string;
}

const CONFIG = {
  SAMPLE_RATE: 16000,
  FLUSH_INTERVAL_MS: 6000,
  MIN_CHUNK_DURATION_MS: 4000,
  RMS_THRESHOLD: 800,
  SILENCE_THRESHOLD: 500,
  MAX_BUFFER_SIZE: 16000 * 20 * 2,
  SILENCE_CHUNKS_REQUIRED: 3,
  COOLDOWN_MS: 2000,
  HALLUCINATIONS: [
    "subtítulos realizados por",
    "amara.org",
    "nos vemos en el próximo",
    "gracias por ver",
    "suscríbete",
    "comunidad de",
  ],
};

let chatState: ChatState = {
  audioBuffers: [],
  recentBuffers: [],
  lastFlush: Date.now(),
  firstChunkTime: null,
  totalBytesReceived: 0,
  isProcessing: false,
  lastProcessedTime: 0,
  lastTranscribedText: "",
  language: "es",
};

const createWavHeader = (pcmLength: number, sampleRate: number): Buffer => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
};

const pcmToWav = (pcm: Buffer, sampleRate: number): Buffer =>
  Buffer.concat([createWavHeader(pcm.length, sampleRate), pcm]);

const calculateRMS = (pcm: Buffer): number => {
  const numSamples = pcm.length / 2;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / numSamples);
};

const getAverageRMS = (buffers: Buffer[]): number =>
  buffers.length === 0
    ? 0
    : buffers.reduce((sum, buf) => sum + calculateRMS(buf), 0) / buffers.length;

const endsWithSilence = (
  recentBuffers: Buffer[],
  threshold: number,
  chunksRequired: number,
): boolean => {
  if (recentBuffers.length < chunksRequired) return false;
  return getAverageRMS(recentBuffers.slice(-chunksRequired)) < threshold;
};

const isHallucinatedText = (text: string): boolean =>
  CONFIG.HALLUCINATIONS.some((phrase) => text.toLowerCase().includes(phrase));

const isSimilarText = (text1: string, text2: string): boolean => {
  if (!text1) return false;
  return text1.toLowerCase().trim() === text2.toLowerCase().trim();
};

const addAudioChunk = (chunk: Buffer) => {
  chatState.recentBuffers = [...chatState.recentBuffers, chunk].slice(-5);
  chatState.audioBuffers.push(chunk);
  chatState.totalBytesReceived += chunk.length;
  chatState.firstChunkTime ??= Date.now();
};

const resetAudioBuffers = () => {
  chatState.audioBuffers = [];
  chatState.lastFlush = Date.now();
  chatState.firstChunkTime = null;
};

const markAsProcessing = () => (chatState.isProcessing = true);
const markAsProcessed = (text: string) => {
  chatState.isProcessing = false;
  chatState.lastProcessedTime = Date.now();
  chatState.lastTranscribedText = text;
};

const shouldFlushAudio = (): boolean => {
  if (chatState.isProcessing) return false;
  const now = Date.now();
  const bufferSize = chatState.audioBuffers.reduce(
    (sum, b) => sum + b.length,
    0,
  );
  const elapsed = now - chatState.lastFlush;
  const totalDuration = now - (chatState.firstChunkTime ?? now);

  return (
    bufferSize > CONFIG.MAX_BUFFER_SIZE ||
    (elapsed >= CONFIG.FLUSH_INTERVAL_MS &&
      totalDuration >= CONFIG.MIN_CHUNK_DURATION_MS &&
      endsWithSilence(
        chatState.recentBuffers,
        CONFIG.SILENCE_THRESHOLD,
        CONFIG.SILENCE_CHUNKS_REQUIRED,
      ))
  );
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const saveWavFile = (wavBuffer: Buffer) => {
  const filePath = path.join("/tmp", `audio-${Date.now()}.wav`);
  fs.writeFileSync(filePath, wavBuffer);
  return filePath;
};

const cleanupFile = async (filePath: string) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const transcribeAudio = async (filePath: string, language = "es") => {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
    language,
    prompt:
      "Transcribe faithfully the audio in Spanish. " +
      "If a word or phrase is unclear, infer it from context to improve understanding. " +
      "Do not add personal comments or explanations. " +
      "Preserve the conversational meaning and complete incomplete phrases when necessary.",
  });
  return transcription.text.trim();
};

const getAIResponse = async (userMessage: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content:
          "You are a voice assistant in a phone call. " +
          "Respond in Spanish with a friendly, clear, and professional tone. " +
          "Keep responses concise and natural, as if speaking directly to the caller.",
      },
      { role: "user", content: userMessage },
    ],
  });
  return response.choices?.[0]?.message?.content?.trim() || "";
};

const processAudioChunk = async (socket: any) => {
  if (chatState.isProcessing) return;
  markAsProcessing();

  socket.emit("processing_status", {
    status: "started",
    timestamp: Date.now(),
  });
  const pcmBuffer = Buffer.concat(chatState.audioBuffers);
  const rms = calculateRMS(pcmBuffer);
  if (rms < CONFIG.RMS_THRESHOLD) {
    markAsProcessed("");
    resetAudioBuffers();
    socket.emit("processing_status", {
      status: "finished",
      timestamp: Date.now(),
    });
    return;
  }

  let filePath: string | null = null;

  try {
    const wavBuffer = pcmToWav(pcmBuffer, CONFIG.SAMPLE_RATE);
    filePath = saveWavFile(wavBuffer);
    socket.emit("processing_status", {
      status: "in_progress",
      timestamp: Date.now(),
    });

    const text = await transcribeAudio(filePath, chatState.language);

    if (
      !text ||
      isHallucinatedText(text) ||
      isSimilarText(chatState.lastTranscribedText, text)
    ) {
      markAsProcessed(text);
      resetAudioBuffers();
      socket.emit("processing_status", {
        status: "finished",
        timestamp: Date.now(),
      });
      return;
    }

    socket.emit("transcription", { text, timestamp: Date.now() });

    const aiReply = await getAIResponse(text);
    if (aiReply)
      socket.emit("processing_status", {
        status: "finished",
        timestamp: Date.now(),
      });
    socket.emit("ai_response", { text: aiReply, timestamp: Date.now() });

    markAsProcessed(text);
  } finally {
    if (filePath) await cleanupFile(filePath);
    resetAudioBuffers();
  }
};

io.on("connection", (socket) => {
  const { language = "es" } = socket.handshake.query as { language?: string };
  chatState.language = language;

  console.log(`Client connected: ${socket.id}`);

  socket.emit("connected", {
    message: "Connected successfully",
    timestamp: Date.now(),
  });

  socket.on("audio-chunk", async (chunk: ArrayBuffer) => {
    addAudioChunk(Buffer.from(chunk));
    if (shouldFlushAudio()) await processAudioChunk(socket);
  });

  socket.on("message", (msg: any) => {
    io.emit("message", msg);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const messages = [
      {
        role: "system",
        content:
          "You are a helpful assistant. Respond in Spanish with a friendly tone.",
      },
      ...history,
      {
        role: "user",
        content: message,
      },
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error("AI streaming request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to get AI response" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    }
  }
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const reply = await getAIResponse(message);
    res.json({ reply });
  } catch (error) {
    console.error("AI request failed:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Service is running" });
});
app.get("/status", (_req, res) => {
  res.json({
    status: "ok",
    clientsConnected: io.sockets.sockets.size,
    uptime: process.uptime(),
    timestamp: Date.now(),
    message: "Service is running",
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
