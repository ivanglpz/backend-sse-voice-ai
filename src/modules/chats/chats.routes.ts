import { Router } from "express";
import {
  createChat,
  deleteChatById,
  getChatById,
  listChats,
  updateChatTitle,
} from "./chats.service";

export const chatsRouter = Router();

chatsRouter.get("/", async (_req, res) => {
  const data = await listChats();
  res.json(data);
});

chatsRouter.get("/:chatId", async (req, res) => {
  const chat = await getChatById(req.params.chatId);
  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }

  res.json(chat);
});

chatsRouter.post("/", async (req, res) => {
  const { title } = req.body as { title?: string };
  const chat = await createChat(title);
  res.status(201).json(chat);
});

chatsRouter.put("/:chatId", async (req, res) => {
  const { title } = req.body as { title?: string };

  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }

  const updated = await updateChatTitle(req.params.chatId, title);
  if (!updated) {
    return res.status(404).json({ error: "Chat not found" });
  }

  res.json(updated);
});

chatsRouter.delete("/:chatId", async (req, res) => {
  const deleted = await deleteChatById(req.params.chatId);
  if (!deleted) {
    return res.status(404).json({ error: "Chat not found" });
  }

  res.status(204).send();
});
