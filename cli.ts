#!/usr/bin/env bun
import { createNotesTableSmart, indexNotesIncremental, fetchAndIndexAllNotes } from "./index.js";

async function main() {
  console.log("🚀 Smart Apple Notes Indexing\n");
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const maxNotesArg = args.find(arg => arg.startsWith('--max='));
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  const methodArg = args.find(arg => arg.startsWith('--method='));
  
  const maxNotes = maxNotesArg ? parseInt(maxNotesArg.split('=')[1]) : undefined;
  const mode = (modeArg?.split('=')[1] as 'fresh' | 'incremental') || 'incremental';
  const method = (methodArg?.split('=')[1] as 'standard' | 'enhanced') || 'standard';
  
  console.log(`📊 Mode: ${mode === 'fresh' ? 'Fresh rebuild' : 'Incremental updates'}`);
  console.log(`🔧 Method: ${method === 'enhanced' ? 'Enhanced (title + creation date)' : 'Standard'}`);
  if (maxNotes) {
    console.log(`🎯 Limit: ${maxNotes} notes`);
  }
  
  try {
    console.log("📁 Setting up notes database...");
    const { notesTable, existingNotes, time: setupTime } = await createNotesTableSmart(undefined, mode);
    console.log(`✅ Database setup complete (${(setupTime / 1000).toFixed(2)}s)`);
    console.log(`📊 Found ${existingNotes.size} existing notes for comparison`);
    
    console.log("\n📝 Starting indexing...");
    
    if (method === 'enhanced') {
      // Use the enhanced method that fetches by title and creation date
      const result = await fetchAndIndexAllNotes(notesTable, maxNotes);
      
      console.log("\n=== Enhanced Indexing Complete ===");
      console.log(`📊 Stats:`);
      console.log(`• Notes processed: ${result.processed}`);
      console.log(`• Chunks created: ${result.totalChunks}`);
      console.log(`• Failed: ${result.failed} notes`);
      console.log(`• Time taken: ${result.timeSeconds.toFixed(2)} seconds`);
      
      console.log("\n✨ Notes are now ready for semantic search!");
    } else {
      // Use the standard incremental method
      const result = await indexNotesIncremental(notesTable, existingNotes, maxNotes);
      
      console.log("\n=== Standard Indexing Complete ===");
      console.log(`📊 Stats:`);
      console.log(`• Notes processed: ${result.notes}`);
      console.log(`• Chunks created: ${result.chunks}`);
      console.log(`• New notes added: ${result.added}`);
      console.log(`• Notes updated: ${result.updated}`);
      console.log(`• Notes skipped (unchanged): ${result.skipped}`);
      console.log(`• Failed: ${result.failed} notes`);
      console.log(`• Time taken: ${(result.time / 1000).toFixed(2)} seconds`);
      
      if (result.report.trim()) {
        console.log("\n⚠️  Issues:");
        console.log(result.report);
      }
      
      console.log("\n✨ Notes are now ready for semantic search!");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();