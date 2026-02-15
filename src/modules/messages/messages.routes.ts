import { Router } from "express";
import { getChatById, upsertChat } from "../chats/chats.service";
import {
  addMessageToChat,
  isValidMessageType,
  listMessagesByChat,
} from "./messages.service";
import type { Message } from "../chats/chat.types";

export const messagesRouter = Router({ mergeParams: true });

messagesRouter.post("/", async (req, res) => {
  const { chatId } = req.params as { chatId: string };
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

  if (!isValidMessageType(type)) {
    return res.status(400).json({ error: "Invalid message type" });
  }

  await upsertChat(chatId, text);
  const message = await addMessageToChat({ chatId, type, text, timestamp });
  res.status(201).json(message);
});

messagesRouter.get("/", async (req, res) => {
  const { chatId } = req.params as { chatId: string };
  const chat = await getChatById(chatId);
  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }

  const data = await listMessagesByChat({
    chatId,
    cursorRaw: String(req.query.cursor ?? ""),
    limitRaw: String(req.query.limit ?? ""),
  });

  res.json(data);
});
