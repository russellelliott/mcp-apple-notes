#!/usr/bin/env bun
import { createNotesTableSmart, fetchAndIndexAllNotes } from "./index.js";

async function main() {
  console.log("🚀 Enhanced Apple Notes Indexing\n");
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const maxNotesArg = args.find(arg => arg.startsWith('--max='));
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  
  const maxNotes = maxNotesArg ? parseInt(maxNotesArg.split('=')[1]) : undefined;
  const mode = (modeArg?.split('=')[1] as 'fresh' | 'incremental') || 'incremental'; // Default to incremental
  
  console.log(`📊 Mode: ${mode === 'fresh' ? 'Fresh rebuild' : 'Incremental updates'}`);
  console.log(`🔧 Method: Enhanced (title + creation date) - handles duplicate titles better`);
  if (maxNotes) {
    console.log(`🎯 Limit: ${maxNotes} notes`);
  }
  
  try {
    console.log("📁 Setting up notes database...");
    const { notesTable } = await createNotesTableSmart(undefined, mode);
    console.log(`✅ Database setup complete`);
    
    console.log("\n📝 Starting enhanced indexing...");
    
    // Use the enhanced method that fetches by title and creation date with mode support
    const result = await fetchAndIndexAllNotes(notesTable, maxNotes, mode);
    
    console.log("\n=== Enhanced Indexing Complete ===");
    console.log(`📊 Stats:`);
    console.log(`• Notes processed: ${result.processed}`);
    console.log(`• Chunks created: ${result.totalChunks}`);
    console.log(`• Failed: ${result.failed} notes`);
    if (result.skipped > 0) {
      console.log(`• Skipped unchanged: ${result.skipped} notes`);
    }
    console.log(`• Time taken: ${result.timeSeconds.toFixed(2)} seconds`);
    console.log(`• Mode: ${mode}`);
    
    console.log("\n✨ Notes are now ready for semantic search!");
    console.log("🎯 Enhanced method handles duplicate note titles by using creation dates for precise fetching.");
    
    if (mode === 'incremental' && result.skipped > 0) {
      console.log(`⚡ Incremental mode: Only processed new/modified notes. Cache saved for future runs.`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();