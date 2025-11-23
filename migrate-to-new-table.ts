import * as lancedb from "@lancedb/lancedb";
import path from "node:path";
import os from "node:os";

const db = await lancedb.connect(
  path.join(os.homedir(), ".mcp-apple-notes", "data")
);

async function migrateToNewTable() {
  try {
    console.log("🔍 Reading notes from 'notes_new' table...");
    const notesNewTable = await db.openTable("notes_new");
    
    // Get all notes from notes_new
    const existingChunks = await notesNewTable.search("")
      .limit(100000)
      .select(["title", "creation_date", "modification_date"])
      .toArray();
    
    // Deduplicate by title + creation_date
    const noteMap = new Map<string, any>();
    existingChunks.forEach(chunk => {
      const key = `${chunk.title}|||${chunk.creation_date}`;
      if (!noteMap.has(key)) {
        noteMap.set(key, {
          title: chunk.title,
          creation_date: chunk.creation_date,
          modification_date: chunk.modification_date
        });
      }
    });
    
    const existingNotes = Array.from(noteMap.values());
    console.log(`✅ Found ${existingNotes.length} unique notes in 'notes_new'`);
    
    // Show sample
    console.log(`\n📝 Sample notes from 'notes_new':`);
    existingNotes.slice(0, 10).forEach((note, i) => {
      console.log(`  ${i + 1}. "${note.title}"`);
      console.log(`     Created: ${note.creation_date}`);
      console.log(`     Modified: ${note.modification_date}`);
    });
    
    if (existingNotes.length > 10) {
      console.log(`  ... and ${existingNotes.length - 10} more notes`);
    }
    
    console.log("\n💡 To use 'notes_new' as your main table:");
    console.log("   1. Backup your current 'notes' table:");
    console.log("      mv ~/.mcp-apple-notes/data/notes.lance ~/.mcp-apple-notes/data/notes_backup.lance");
    console.log("   2. Rename 'notes_new' to 'notes':");
    console.log("      mv ~/.mcp-apple-notes/data/notes_new.lance ~/.mcp-apple-notes/data/notes.lance");
    console.log("   3. Or update index.ts to use 'notes_new' by default");
    
  } catch (error) {
    console.error("❌ Error:", error);
    console.log("\n📋 Available tables:");
    const tables = await db.tableNames();
    tables.forEach(name => console.log(`  - ${name}`));
  }
}

migrateToNewTable();
