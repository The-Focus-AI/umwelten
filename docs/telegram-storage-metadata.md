# Telegram Bot Storage and Metadata

## File Storage Location

**Media files are stored in a configurable directory** passed to `TelegramAdapter` via the `mediaDir` configuration option.

### Default Locations

**Jeeves Bot** (`examples/jeeves-bot/telegram.ts`):
```
{JEEVES_SESSIONS_DIR}/telegram-{chatId}/media/
```

Where `JEEVES_SESSIONS_DIR` is configurable in `.env` (default: `~/.jeeves-sessions`). Each Telegram chat gets its own session directory. CLI runs create `cli-{timestamp}-{id}` subdirectories with `meta.json` and `transcript.jsonl` (Claude-style JSONL including full tool call history); see [Jeeves README](https://github.com/The-Focus-AI/umwelten/blob/main/examples/jeeves-bot/README.md#cli-sessions) § CLI sessions.

**CLI** (`npx umwelten telegram`):
- Default: `{current_working_directory}/telegram-media/`
- Custom: Use `--media-dir <path>` to specify a different location

### File Naming

Files are named using Telegram's `file_unique_id` with appropriate extensions:
- Photos: `{file_unique_id}.jpg`
- Documents: `{file_unique_id}.{original_extension}` or `.bin`
- Audio: `{file_unique_id}.{original_extension}` or `.mp3`
- Voice: `{file_unique_id}.ogg`
- Videos: `{file_unique_id}.mp4`

The media directory is created automatically if it doesn't exist when the first file is received.

## Conversation State Storage

**Currently stored in memory only:**
- `interactions: Map<number, Interaction>` - One Interaction per chat ID
- `typingIntervals: Map<number, NodeJS.Timeout>` - Typing indicator intervals

**Note:** Conversation state is lost when the bot restarts. It's not persisted to disk.

## Available Telegram Metadata

The Telegram `Context` object provides extensive metadata that's currently available but not all of it is being captured:

### User Information (`ctx.from`)
```typescript
{
  id: number;                    // User ID
  is_bot: boolean;               // Is this a bot?
  first_name: string;            // User's first name
  last_name?: string;            // User's last name (optional)
  username?: string;             // @username (optional)
  language_code?: string;        // Language code (e.g., "en")
  is_premium?: boolean;          // Telegram Premium status
}
```

### Chat Information (`ctx.chat`)
```typescript
{
  id: number;                    // Chat ID
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;                 // Group/channel title
  username?: string;             // @channelname
  first_name?: string;           // For private chats
  last_name?: string;            // For private chats
  photo?: ChatPhoto;             // Chat photo
}
```

### Message Metadata (`ctx.message`)
```typescript
{
  message_id: number;            // Unique message ID
  date: number;                  // Unix timestamp
  text?: string;                  // Message text
  caption?: string;               // Media caption
  
  // Media-specific fields
  photo?: PhotoSize[];            // Photo sizes (multiple resolutions)
  document?: Document;           // Document info
  audio?: Audio;                  // Audio info
  voice?: Voice;                  // Voice message info
  video?: Video;                  // Video info
  
  // User info
  from?: User;                    // Sender info
  forward_from?: User;            // Forwarded from user
  reply_to_message?: Message;     // Replied message
  
  // Location
  location?: Location;
  venue?: Venue;
  
  // Other
  entities?: MessageEntity[];     // Text formatting entities
  edit_date?: number;             // Edit timestamp
}
```

### File Metadata (from `ctx.getFile()`)
```typescript
{
  file_id: string;                // Bot-specific file ID
  file_unique_id: string;         // Unique file identifier
  file_size?: number;             // File size in bytes
  file_path?: string;             // File path on Telegram servers
}
```

### Document-Specific Metadata (`ctx.message.document`)
```typescript
{
  file_name?: string;             // Original filename
  mime_type?: string;             // MIME type
  file_size?: number;             // Size in bytes
  file_id: string;
  file_unique_id: string;
  thumbnail?: PhotoSize;          // Thumbnail if available
}
```

### Photo Metadata (`ctx.message.photo[]`)
```typescript
{
  file_id: string;
  file_unique_id: string;
  width: number;                  // Image width
  height: number;                 // Image height
  file_size?: number;             // Size in bytes
}
```

### Audio/Voice Metadata
```typescript
// Audio
{
  duration: number;               // Duration in seconds
  performer?: string;            // Artist/performer
  title?: string;                 // Track title
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

// Voice
{
  duration: number;               // Duration in seconds
  mime_type?: string;            // Usually "audio/ogg"
  file_size?: number;
}
```

### Video Metadata
```typescript
{
  duration: number;              // Duration in seconds
  width: number;                 // Video width
  height: number;                // Video height
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  thumbnail?: PhotoSize;          // Video thumbnail
}
```

## Currently Captured Metadata

**In logs:**
- Timestamp (current time, not message date)
- Chat ID
- Username or first name
- Message preview (first 100 chars)

**In file storage:**
- File unique ID (used as filename)
- File extension (derived from type or original filename)
- File path on disk

**In Interaction:**
- Message content (text or media description)
- Caption (if provided with media)
- Conversation history (messages array)
- System prompt from Stimulus
- Model configuration
- Tools configuration

## Not Currently Captured (But Available)

- Message timestamp (`ctx.message.date`)
- User full name (only first name logged)
- User language code
- Original filename (for documents/audio)
- File size (checked but not stored)
- MIME type (not stored)
- Media dimensions (width/height for photos/videos)
- Media duration (for audio/video)
- Reply-to message relationships
- Message entities (formatting, mentions, links)
- Chat type (private vs group)
- Forward information

## Recommendations

If you want to capture more metadata, consider:

1. **Store metadata alongside files:**
   ```typescript
   // Save metadata JSON alongside file
   const metadataPath = `${filePath}.metadata.json`;
   await fs.writeFile(metadataPath, JSON.stringify({
     fileUniqueId,
     originalFileName: doc.file_name,
     mimeType: doc.mime_type,
     fileSize: doc.file_size,
     chatId,
     userId: ctx.from?.id,
     username: ctx.from?.username,
     timestamp: ctx.message.date,
     messageId: ctx.message.message_id,
   }, null, 2));
   ```

2. **Persist conversation state:**
   - Save `Interaction.messages` to disk per chat
   - Use a database or file-based storage
   - Restore on bot restart

3. **Enhanced logging:**
   - Include message date (not just current time)
   - Log full user info
   - Log media metadata (dimensions, duration, etc.)
