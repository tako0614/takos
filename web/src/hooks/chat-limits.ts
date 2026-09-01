// Keep these UX limits aligned with the public message route. The Worker is
// authoritative; the browser mirrors them to reject impossible drafts before
// uploads or network work begin.
export const MAX_CHAT_MESSAGE_CHARACTERS = 20_000;
export const MAX_CHAT_ATTACHMENTS = 10;
