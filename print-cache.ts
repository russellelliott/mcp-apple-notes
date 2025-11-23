import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Path for notes cache file
const NOTES_CACHE_PATH = path.join(
  os.homedir(),
  ".mcp-apple-notes",
  "notes-cache.json"
);

interface NoteMetadata {
  title: string;
  creation_date: string;
  modification_date: string;
}

interface NotesCache {
  last_sync: string;
  notes: NoteMetadata[];
}

async function printCache() {
  try {
    console.log(`📂 Reading cache from: ${NOTES_CACHE_PATH}\n`);
    
    const cacheContent = await fs.readFile(NOTES_CACHE_PATH, "utf-8");
    const cache: NotesCache = JSON.parse(cacheContent);
    
    console.log(`📅 Last sync: ${cache.last_sync}`);
    console.log(`📊 Total notes in cache: ${cache.notes.length}\n`);
    
    // Print first 10 notes
    const limit = Math.min(10, cache.notes.length);
    console.log(`📝 First ${limit} notes:\n`);
    
    for (let i = 0; i < limit; i++) {
      const note = cache.notes[i];
      console.log(`${i + 1}. "${note.title}"`);
      console.log(`   Created: ${note.creation_date}`);
      console.log(`   Modified: ${note.modification_date}`);
      console.log();
    }
    
    if (cache.notes.length > 10) {
      console.log(`... and ${cache.notes.length - 10} more notes`);
    }
    
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`❌ Cache file not found at: ${NOTES_CACHE_PATH}`);
      console.log(`💡 Run the indexing first: bun cli.ts --max=10`);
    } else {
      console.error(`❌ Error reading cache:`, error);
    }
  }
}

printCache();
