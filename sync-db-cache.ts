#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function syncDatabaseAndCache() {
  console.log("🔄 Synchronizing database and cache...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get all chunks from the actual database
    console.log("📊 Reading all chunks from database...");
    const allChunks = await notesTable.search("").toArray();
    console.log(`📄 Found ${allChunks.length} chunks in database`);
    
    // Group chunks by note (using title + creation_date as key)
    const notesMap = new Map();
    
    allChunks.forEach(chunk => {
      const noteKey = `${chunk.title}|||${chunk.creation_date}`;
      if (!notesMap.has(noteKey)) {
        notesMap.set(noteKey, {
          title: chunk.title,
          creation_date: chunk.creation_date,
          modification_date: chunk.modification_date,
          chunks: []
        });
      }
      notesMap.get(noteKey).chunks.push(chunk);
    });
    
    const uniqueNotes = Array.from(notesMap.values());
    console.log(`📝 Found ${uniqueNotes.length} unique notes in database`);
    
    // Show database contents
    console.log("\n📋 Database contents:");
    uniqueNotes.forEach((note, idx) => {
      console.log(`   ${idx + 1}. "${note.title}"`);
      console.log(`      📅 Created: ${note.creation_date}`);
      console.log(`      ✏️ Modified: ${note.modification_date}`);
      console.log(`      📄 Chunks: ${note.chunks.length}`);
      
      // Show cluster info if available
      // Clustering removed
      // const firstChunk = note.chunks[0];
      // if (firstChunk.cluster_id !== null && firstChunk.cluster_id !== undefined) {
      //   console.log(`      🏷️ Cluster: ${firstChunk.cluster_id} (${firstChunk.cluster_label})`);
      // }
    });
    
    // Check if database matches expectation
    console.log("\n🔍 Diagnosis:");
    if (uniqueNotes.length < 10) {
      console.log("❌ Database has very few notes - indexing may have failed");
      console.log("💡 Solution: Run fresh indexing with proper data validation");
    } else if (uniqueNotes.length >= 90) {
      console.log("✅ Database has good coverage");
    } else {
      console.log("⚠️ Database has partial data - may need re-indexing");
    }
    
    // Check cluster distribution removed
    console.log("\n📌 Clustering functionality has been removed");
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

syncDatabaseAndCache();