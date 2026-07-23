# Bug Fix Report: `@lid` Message Delivery Failure

**Date:** 2026-07-23  
**Status:** Resolved ✅  
**Files changed:** `WhatsAppBot.ts`, `MessageHandler.ts`, `index.ts`, `logger.ts`

---

## Problem 1: Messages to `@lid` contacts fail silently

### Symptom
When a message arrived from `271892921467012@lid`, the bot logged:
```
Error with 271892921467012@lid, trying next format: r
No LID for 271892921467012, trying next format...
```
No reply was ever sent to the customer. The error cascaded: typing indicator failed → response generation failed → error message to user also failed.

### Root Cause
WhatsApp Web.js uses two chat ID formats:
- `@c.us` — standard format (older accounts)
- `@lid` — LID format (newer/business accounts)

When a message arrives from `271892921467012@lid`, the bot stripped it to a bare phone number (`271892921467012`) and tried to **reconstruct** the chat ID by trying `@c.us` then `@lid`. But `whatsapp-web.js`'s `client.getChatById()` throws `"No LID for user"` for the `@lid` format — even though the chat exists and the bot just received a message from it.

The original `msg.from` value (`271892921467012@lid`) was the only valid chat ID, but it was discarded at line 51 of `MessageHandler.ts`:
```typescript
const phone = this.extractPhoneNumber(msg.from); // strips @lid
```

### Resolution
1. Identified that `msg.from` was the source of truth for valid chat IDs
2. Threaded the original `msg.from` as `chatId` through the entire call chain:
   - `MessageHandler.handleMessage()` → `processMessage(chatId)`
   - `sendTypingIndicator(phone, chatId?)`
   - `clearTypingIndicator(phone, chatId?)`
   - `sendMessage(phone, text, retryCount?, chatId?)`
3. Updated the handler interface, property types, and all 7 call sites in `MessageHandler.ts`
4. Updated the DI wiring in `index.ts` to forward the `chatId` parameter

---

## Problem 2: `getChatById()` fails for `@lid` even with correct ID

### Symptom
After threading the original `chatId` through, `getChatById("271892921467012@lid")` still threw `"No LID for user"`. The `@lid` format is not supported by `getChatById()` in whatsapp-web.js.

### Root Cause
`whatsapp-web.js`'s `getChatById()` implementation internally calls WhatsApp Web's JS functions via Puppeteer, and those functions reject `@lid` IDs with `"No LID for user"`. However, `client.sendMessage(chatId, message)` works fine with `@lid` because it goes through a different code path in WhatsApp Web's internals.

### Resolution
- **`sendMessage()`**: Skip the `getChatById()` pre-check when using the original chat ID from the incoming message. The ID is already proven valid (we received a message from it), and `sendMessage()` works directly:
  ```typescript
  const isOriginalChatId = chatId && targetChatId === chatId;
  if (!isOriginalChatId) {
    await this.client.getChatById(targetChatId); // existence check
  }
  const sentMessage = await this.client.sendMessage(targetChatId, message);
  ```

- **`sendTypingIndicator()`**: Wrap the `getChatById()` call in a try/catch when using the original chat ID. Since typing indicators are non-critical, skip gracefully on failure:
  ```typescript
  if (isOriginalChatId) {
    try { chat = await this.client.getChatById(resolvedChatId); }
    catch { return; } // skip typing, continue with message
  }
  ```

- **`clearTypingIndicator()`**: Already had proper error handling — the `@lid` failure is caught and logged at debug level.

---

## Problem 3: Uninformative error logging

### Symptom
The error object logged as:
```
Error handling message: { "name": "r" }
```
This is a minified WhatsApp Web JS error — no `message`, no `stack`, no context.

### Resolution
Enhanced the catch block in `WhatsAppBot.ts` message handler to extract and log all available error properties plus message metadata:
```typescript
const errorDetail = error?.message || error?.name || String(error);
logger.error(`Error handling message from ${msg?.from || 'unknown'}: ${errorDetail}`, {
  name: error?.name,
  message: error?.message,
  stack: errorStack.substring(0, 500),
  from: msg?.from,
  type: msg?.type,
});
```
This revealed the actual error: `"r: r"` from `getChatById` — confirming the `@lid` resolution failure.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/bot/WhatsAppBot.ts` | Added optional `chatId` param to `sendTypingIndicator`, `clearTypingIndicator`, `sendMessage`. Skip `getChatById()` for original `@lid` chat IDs. Improved error logging. |
| `src/bot/MessageHandler.ts` | Updated handler interface and all 7 handler call sites to pass original `msg.from` as `chatId`. Updated property types. |
| `src/index.ts` | Updated DI wiring to forward `chatId` parameter through all three handler callbacks. |
| `src/utils/logger.ts` | Minor logging improvements. |

## Verification

After deployment and restart:
```
Message from 271892921467012: هلا
Message sent to 271892921467012 using 271892921467012@lid
```
Messages from `@lid` contacts are now processed and replies delivered successfully.
