import { prisma } from "../../lib/prisma";
import type { Message } from "../chats/chat.types";

export const DEFAULT_MESSAGES_PAGE_SIZE = 20;
export const MAX_MESSAGES_PAGE_SIZE = 100;

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

export const isValidMessageType = (type: string): type is Message["type"] =>
  messageTypeValues.includes(type as Message["type"]);

export const addMessageToChat = async (input: {
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

export const listMessagesByChat = async (input: {
  chatId: string;
  cursorRaw?: string;
  limitRaw?: string;
}): Promise<{
  items: Message[];
  pagination: {
    cursor: string | null;
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  };
}> => {
  const limit = Number.parseInt(
    String(input.limitRaw ?? DEFAULT_MESSAGES_PAGE_SIZE),
    10,
  );

  const safeLimit = Number.isNaN(limit)
    ? DEFAULT_MESSAGES_PAGE_SIZE
    : Math.min(Math.max(limit, 1), MAX_MESSAGES_PAGE_SIZE);

  const cursorRaw = (input.cursorRaw ?? "").trim();

  const messages = await prisma.message.findMany({
    where: { chatId: input.chatId },
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
  const nextCursor = hasMore ? (paginated[paginated.length - 1]?.id ?? null) : null;
  const total = await prisma.message.count({ where: { chatId: input.chatId } });

  return {
    items,
    pagination: {
      cursor: cursorRaw || null,
      limit: safeLimit,
      nextCursor,
      hasMore,
      total,
    },
  };
};
