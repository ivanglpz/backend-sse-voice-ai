import "dotenv/config";
import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import OpenAI from "openai";
import { Server } from "socket.io";
import { MAX_HTTP_BUFFER_SIZE, SERVER_PORT } from "./config/constants";
import { registerAudioHandlers } from "./socket/audioHandlers";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./types/audio";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const app: Express = express();
app.use(express.json());
const httpServer: HttpServer = createServer(app);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
});

registerAudioHandlers(io);

app.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body as {
    message?: string;
    history?: ChatCompletionMessageParam[];
  };

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const messages: ChatCompletionMessageParam[] = [
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
      messages,
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

httpServer.listen(SERVER_PORT, () => {
  console.log(`Socket.IO server running on :${SERVER_PORT}`);
});
