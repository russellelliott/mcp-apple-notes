#!/usr/bin/env bun
import { createNotesTableSmart, indexNotesIncremental } from "./index.js";

async function main() {
  console.log("🚀 Smart Apple Notes Indexing\n");
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const maxNotesArg = args.find(arg => arg.startsWith('--max='));
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  
  const maxNotes = maxNotesArg ? parseInt(maxNotesArg.split('=')[1]) : undefined;
  const mode = (modeArg?.split('=')[1] as 'fresh' | 'incremental') || 'incremental';
  
  console.log(`📊 Mode: ${mode === 'fresh' ? 'Fresh rebuild' : 'Incremental updates'}`);
  if (maxNotes) {
    console.log(`🎯 Limit: ${maxNotes} notes`);
  }
  
  try {
    console.log("📁 Setting up notes database...");
    const { notesTable, existingNotes, time: setupTime } = await createNotesTableSmart(undefined, mode);
    console.log(`✅ Database setup complete (${(setupTime / 1000).toFixed(2)}s)`);
    console.log(`📊 Found ${existingNotes.size} existing notes for comparison`);
    
    console.log("\n📝 Starting smart indexing...");
    const result = await indexNotesIncremental(notesTable, existingNotes, maxNotes);
    
    console.log("\n=== Indexing Complete ===");
    console.log(`📊 Stats:`);
    console.log(`• Total processed: ${result.chunks} notes`);
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
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();