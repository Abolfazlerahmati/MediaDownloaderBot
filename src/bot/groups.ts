// Group rules: the bot answers only when it is addressed. It never reacts to ordinary group chatter.
import type { TgMessage } from './types';

export function isAddressedInGroup(message: TgMessage, botUsername: string | null): boolean {
  const text = message.text ?? '';
  if (!botUsername) return false;
  const name = botUsername.toLowerCase();
  if (text.toLowerCase().includes(`@${name}`)) return true;
  if (message.reply_to_message?.from?.username?.toLowerCase() === name) return true;
  // A command with a different bot's @name is for that bot.
  const commandMatch = text.match(/^\/[a-z_]+@([a-z0-9_]+)/i);
  if (commandMatch) return commandMatch[1].toLowerCase() === name;
  // Plain commands are answered only in private chats, so a group does not get replies for them.
  return false;
}
