import { randomUUID } from "node:crypto";
import { Router } from "express";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { upsertChat } from "../chats/chats.service";
import { addMessageToChat } from "../messages/messages.service";

export const createChatStreamRouter = (openai: OpenAI): Router => {
  const router = Router();

  router.post("/chat", async (req, res) => {
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
          res.write(`data: ${JSON.stringify({ content })}\\n\\n`);
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
        `data: ${JSON.stringify({ done: true, chatId: resolvedChatId })}\\n\\n`,
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
        res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\\n\\n`);
        res.end();
      }
    }
  });

  return router;
};
