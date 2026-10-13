// Minimal Telegram update types. Only the fields this bot reads are described.
export interface TgUser {
  id: number;
  is_bot?: boolean;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: { from?: TgUser };
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: { chat: { id: number; type: string } };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
