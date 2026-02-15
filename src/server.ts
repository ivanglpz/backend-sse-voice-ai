import "dotenv/config";
import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Server } from "socket.io";
import { MAX_HTTP_BUFFER_SIZE, SERVER_PORT } from "./config/constants";
import { prisma } from "./lib/prisma";
import { registerAudioHandlers } from "./socket/audioHandlers";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./types/audio";

const app: Express = express();
app.use(express.json());
const httpServer: HttpServer = createServer(app);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Message = {
  id: string;
  type: "user" | "ai" | "transcription" | "ai_response" | "error";
  text: string;
  timestamp: number;
  message: string;
};

type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

const DEFAULT_MESSAGES_PAGE_SIZE = 20;
const MAX_MESSAGES_PAGE_SIZE = 100;

const messageTypeValues: Message["type"][] = [
  "user",
  "ai",
  "transcription",
  "ai_response",
  "error",
];

const toMessage = (message: {
  id: string;
  type: string;
  text: string;
  message: string;
  timestamp: bigint;
}): Message => {
  const timestampNumber = Number(message.timestamp);
  return {
    id: message.id,
    type: message.type as Message["type"],
    text: message.text,
    message: message.message,
    timestamp: Number.isFinite(timestampNumber) ? timestampNumber : Date.now(),
  };
};

const toChat = (chat: {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}): Chat => ({
  id: chat.id,
  title: chat.title,
  createdAt: chat.createdAt.getTime(),
  updatedAt: chat.updatedAt.getTime(),
});

const upsertChat = async (
  chatId: string,
  initialTitle?: string,
): Promise<void> => {
  const title = initialTitle?.trim() || "Nuevo chat";
  await prisma.chat.upsert({
    where: { id: chatId },
    update: {},
    create: {
      id: chatId,
      title,
    },
  });
};

const addMessageToChat = async (input: {
  chatId: string;
  type: Message["type"];
  text: string;
  timestamp?: number;
}): Promise<Message> => {
  const normalizedText = input.text.trim();
  const created = await prisma.message.create({
    data: {
      chatId: input.chatId,
      type: input.type,
      text: normalizedText,
      message: normalizedText,
      timestamp: BigInt(input.timestamp ?? Date.now()),
    },
  });

  return toMessage(created);
};

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

app.get("/chats", async (_req, res) => {
  const chats = await prisma.chat.findMany({
    orderBy: { updatedAt: "desc" },
  });
  const items = chats.map(toChat);
  res.json({ items, total: items.length });
});

app.get("/chats/:chatId", async (req, res) => {
  const chat = await prisma.chat.findUnique({
    where: { id: req.params.chatId },
  });
  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }

  res.json(toChat(chat));
});

app.post("/chats", async (req, res) => {
  const { title } = req.body as { title?: string };
  const chatId = randomUUID();

  await upsertChat(chatId, title);
  const created = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!created) {
    return res.status(500).json({ error: "Failed to create chat" });
  }

  res.status(201).json(toChat(created));
});

app.put("/chats/:chatId", async (req, res) => {
  const { title } = req.body as { title?: string };

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    const updated = await prisma.chat.update({
      where: { id: req.params.chatId },
      data: { title: title.trim() },
    });
    res.json(toChat(updated));
  } catch {
    return res.status(404).json({ error: "Chat not found" });
  }
});

app.delete("/chats/:chatId", async (req, res) => {
  try {
    await prisma.chat.delete({
      where: { id: req.params.chatId },
    });
  } catch {
    return res.status(404).json({ error: "Chat not found" });
  }

  res.status(204).send();
});

app.post("/chats/:chatId/messages", async (req, res) => {
  const { chatId } = req.params;
  const {
    type = "user",
    text,
    timestamp,
  } = req.body as {
    type?: Message["type"];
    text?: string;
    timestamp?: number;
  };

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  if (!messageTypeValues.includes(type)) {
    return res.status(400).json({ error: "Invalid message type" });
  }

  await upsertChat(chatId, text);
  const message = await addMessageToChat({ chatId, type, text, timestamp });
  res.status(201).json(message);
});

app.get("/chats/:chatId/messages", async (req, res) => {
  const { chatId } = req.params;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
  });
  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }

  const cursorRaw = String(req.query.cursor ?? "");
  const limit = Number.parseInt(
    String(req.query.limit ?? DEFAULT_MESSAGES_PAGE_SIZE),
    10,
  );

  const safeLimit = Number.isNaN(limit)
    ? DEFAULT_MESSAGES_PAGE_SIZE
    : Math.min(Math.max(limit, 1), MAX_MESSAGES_PAGE_SIZE);

  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: safeLimit + 1,
    ...(cursorRaw
      ? {
          cursor: { id: cursorRaw },
          skip: 1,
        }
      : {}),
  });

  const hasMore = messages.length > safeLimit;
  const paginated = hasMore ? messages.slice(0, safeLimit) : messages;
  const items = paginated.map(toMessage);
  const nextCursor = hasMore
    ? (paginated[paginated.length - 1]?.id ?? null)
    : null;
  const total = await prisma.message.count({ where: { chatId } });

  res.json({
    items,
    pagination: {
      cursor: cursorRaw || null,
      limit: safeLimit,
      nextCursor,
      hasMore,
      total,
    },
  });
});

app.post("/chat", async (req, res) => {
  const {
    chatId,
    message,
    history = [],
  } = req.body as {
    chatId?: string;
    message?: string;
    history?: ChatCompletionMessageParam[];
  };

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  const resolvedChatId = chatId?.trim() || randomUUID();
  await upsertChat(resolvedChatId, message);
  await addMessageToChat({
    chatId: resolvedChatId,
    type: "user",
    text: message,
  });

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

    let aiFullResponse = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        aiFullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    if (aiFullResponse.trim()) {
      await addMessageToChat({
        chatId: resolvedChatId,
        type: "ai_response",
        text: aiFullResponse,
      });
    }

    res.write(
      `data: ${JSON.stringify({ done: true, chatId: resolvedChatId })}\n\n`,
    );
    res.end();
  } catch (error) {
    console.error("AI streaming request failed:", error);
    await addMessageToChat({
      chatId: resolvedChatId,
      type: "error",
      text: "No se pudo obtener respuesta de la IA.",
    });

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

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
