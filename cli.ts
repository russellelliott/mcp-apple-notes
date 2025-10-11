#!/usr/bin/env bun
import { createNotesTableSmart, fetchAndIndexAllNotes } from "./index.js";

async function main() {
  console.log("🚀 Enhanced Apple Notes Indexing\n");
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const maxNotesArg = args.find(arg => arg.startsWith('--max='));
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  
  const maxNotes = maxNotesArg ? parseInt(maxNotesArg.split('=')[1]) : undefined;
  const mode = (modeArg?.split('=')[1] as 'fresh' | 'incremental') || 'fresh'; // Default to fresh for enhanced method
  
  console.log(`📊 Mode: ${mode === 'fresh' ? 'Fresh rebuild' : 'Incremental updates'}`);
  console.log(`🔧 Method: Enhanced (title + creation date) - handles duplicate titles better`);
  if (maxNotes) {
    console.log(`🎯 Limit: ${maxNotes} notes`);
  }
  
  try {
    console.log("📁 Setting up notes database...");
    const { notesTable, existingNotes, time: setupTime } = await createNotesTableSmart(undefined, mode);
    console.log(`✅ Database setup complete (${(setupTime / 1000).toFixed(2)}s)`);
    console.log(`📊 Found ${existingNotes.size} existing notes for comparison`);
    
    console.log("\n📝 Starting enhanced indexing...");
    
    // Use the enhanced method that fetches by title and creation date
    const result = await fetchAndIndexAllNotes(notesTable, maxNotes);
    
    console.log("\n=== Enhanced Indexing Complete ===");
    console.log(`📊 Stats:`);
    console.log(`• Notes processed: ${result.processed}`);
    console.log(`• Chunks created: ${result.totalChunks}`);
    console.log(`• Failed: ${result.failed} notes`);
    console.log(`• Time taken: ${result.timeSeconds.toFixed(2)} seconds`);
    
    console.log("\n✨ Notes are now ready for semantic search!");
    console.log("🎯 Enhanced method handles duplicate note titles by using creation dates for precise fetching.");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();