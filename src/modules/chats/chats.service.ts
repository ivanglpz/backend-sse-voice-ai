import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import type { Chat } from "./chat.types";

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

export const listChats = async (): Promise<{ items: Chat[]; total: number }> => {
  const chats = await prisma.chat.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return {
    items: chats.map(toChat),
    total: chats.length,
  };
};

export const getChatById = async (chatId: string): Promise<Chat | null> => {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  return chat ? toChat(chat) : null;
};

export const createChat = async (title?: string): Promise<Chat> => {
  const created = await prisma.chat.create({
    data: {
      id: randomUUID(),
      title: title?.trim() || "Nuevo chat",
    },
  });

  return toChat(created);
};

export const updateChatTitle = async (
  chatId: string,
  title: string,
): Promise<Chat | null> => {
  const existing = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!existing) return null;

  const updated = await prisma.chat.update({
    where: { id: chatId },
    data: { title: title.trim() },
  });

  return toChat(updated);
};

export const deleteChatById = async (chatId: string): Promise<boolean> => {
  const result = await prisma.chat.deleteMany({ where: { id: chatId } });
  return result.count > 0;
};

export const upsertChat = async (
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
