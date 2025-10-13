#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function debugToArray() {
  console.log("🔍 Debugging toArray() method...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get one chunk
    const chunks = await notesTable.search("").limit(1).toArray();
    const chunk = chunks[0];
    
    console.log("📊 Vector.toArray() examination:");
    const vectorArray = chunk.vector.toArray();
    
    console.log(`   Type: ${typeof vectorArray}`);
    console.log(`   Constructor: ${vectorArray?.constructor?.name}`);
    console.log(`   Is array: ${Array.isArray(vectorArray)}`);
    console.log(`   Length: ${vectorArray?.length}`);
    console.log(`   Has Symbol.iterator: ${vectorArray && Symbol.iterator in vectorArray}`);
    
    if (vectorArray && typeof vectorArray === 'object') {
      console.log("   Object keys:", Object.keys(vectorArray).slice(0, 10));
      console.log("   Object values sample:", Object.values(vectorArray).slice(0, 5));
    }
    
    // Try to convert to plain array
    console.log("\n🔄 Conversion attempts:");
    
    // Method 1: Array.from
    try {
      const arr1 = Array.from(vectorArray);
      console.log(`   Array.from(): ${arr1.length} items, isArray: ${Array.isArray(arr1)}`);
      console.log(`   First 5: [${arr1.slice(0, 5).join(', ')}]`);
    } catch (e) {
      console.log(`   Array.from() failed: ${e.message}`);
    }
    
    // Method 2: Spread operator
    try {
      const arr2 = [...vectorArray];
      console.log(`   Spread: ${arr2.length} items, isArray: ${Array.isArray(arr2)}`);
      console.log(`   First 5: [${arr2.slice(0, 5).join(', ')}]`);
    } catch (e) {
      console.log(`   Spread failed: ${e.message}`);
    }
    
    // Method 3: Direct iteration with Array.from on original vector
    try {
      const arr3 = Array.from(chunk.vector);
      console.log(`   Array.from(original): ${arr3.length} items, isArray: ${Array.isArray(arr3)}`);
      console.log(`   First 5: [${arr3.slice(0, 5).join(', ')}]`);
    } catch (e) {
      console.log(`   Array.from(original) failed: ${e.message}`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

debugToArray();