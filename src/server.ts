import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { MAX_HTTP_BUFFER_SIZE, SERVER_PORT } from "./config/constants";
import { registerAudioHandlers } from "./socket/audioHandlers";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./types/audio";

const app: Express = express();
const httpServer: HttpServer = createServer(app);

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

httpServer.listen(SERVER_PORT, () => {
  console.log(`Socket.IO server running on :${SERVER_PORT}`);
});
