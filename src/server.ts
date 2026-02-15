import "dotenv/config";
import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import OpenAI from "openai";
import { Server } from "socket.io";
import { MAX_HTTP_BUFFER_SIZE, SERVER_PORT } from "./config/constants";
import { prisma } from "./lib/prisma";
import { createChatStreamRouter } from "./modules/chat-stream/chatStream.routes";
import { chatsRouter } from "./modules/chats/chats.routes";
import { messagesRouter } from "./modules/messages/messages.routes";
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

app.use("/chats", chatsRouter);
app.use("/chats/:chatId/messages", messagesRouter);
app.use(createChatStreamRouter(openai));

httpServer.listen(SERVER_PORT, () => {
  console.log(`Socket.IO server running on :${SERVER_PORT}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
