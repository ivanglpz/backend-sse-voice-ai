export type Message = {
  id: string;
  type: "user" | "ai" | "transcription" | "ai_response" | "error";
  text: string;
  timestamp: number;
  message: string;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};
