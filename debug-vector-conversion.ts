#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function debugVectorConversion() {
  console.log("🔍 Debugging vector conversion...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get one chunk and examine its vector
    const chunks = await notesTable.search("").limit(1).toArray();
    const chunk = chunks[0];
    
    console.log("📊 Raw chunk vector info:");
    console.log(`   Type: ${typeof chunk.vector}`);
    console.log(`   Is array: ${Array.isArray(chunk.vector)}`);
    console.log(`   Constructor: ${chunk.vector?.constructor?.name}`);
    
    if (chunk.vector && typeof chunk.vector === 'object') {
      console.log("🔢 Converting vector object to array...");
      const vectorArray = Object.values(chunk.vector);
      
      console.log(`   Converted array length: ${vectorArray.length}`);
      console.log(`   First 5 values: [${vectorArray.slice(0, 5).join(', ')}]`);
      console.log(`   All values are numbers: ${vectorArray.every(v => typeof v === 'number')}`);
      console.log(`   Any NaN values: ${vectorArray.some(v => isNaN(v))}`);
      console.log(`   Any infinity values: ${vectorArray.some(v => !isFinite(v))}`);
      
      // Test a simple calculation
      const sum = vectorArray.reduce((s, v) => s + v, 0);
      console.log(`   Sum of all values: ${sum}`);
      console.log(`   Sum is finite: ${isFinite(sum)}`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

debugVectorConversion();