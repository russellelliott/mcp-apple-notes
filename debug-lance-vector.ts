#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function debugLanceVector() {
  console.log("🔍 Debugging LanceDB Vector object...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get one chunk and examine its vector
    const chunks = await notesTable.search("").limit(1).toArray();
    const chunk = chunks[0];
    
    console.log("📊 LanceDB Vector examination:");
    console.log(`   Type: ${typeof chunk.vector}`);
    console.log(`   Constructor: ${chunk.vector?.constructor?.name}`);
    console.log(`   Is iterable: ${chunk.vector && Symbol.iterator in chunk.vector}`);
    
    // Try different ways to access the vector data
    console.log("\n🔍 Trying different access methods:");
    
    // Method 1: Direct iteration
    if (chunk.vector && Symbol.iterator in chunk.vector) {
      console.log("   ✅ Vector is iterable");
      const vectorArray = Array.from(chunk.vector);
      console.log(`   Array length: ${vectorArray.length}`);
      console.log(`   First 5 values: [${vectorArray.slice(0, 5).join(', ')}]`);
      console.log(`   All values are numbers: ${vectorArray.every(v => typeof v === 'number')}`);
    }
    
    // Method 2: Check for toArray method
    if (chunk.vector && typeof chunk.vector.toArray === 'function') {
      console.log("   ✅ Vector has toArray method");
      const vectorArray = chunk.vector.toArray();
      console.log(`   Array length: ${vectorArray.length}`);
      console.log(`   First 5 values: [${vectorArray.slice(0, 5).join(', ')}]`);
    }
    
    // Method 3: Check for values method
    if (chunk.vector && typeof chunk.vector.values === 'function') {
      console.log("   ✅ Vector has values method");
      const vectorArray = Array.from(chunk.vector.values());
      console.log(`   Array length: ${vectorArray.length}`);
      console.log(`   First 5 values: [${vectorArray.slice(0, 5).join(', ')}]`);
    }
    
    // Method 4: Check for data property
    if (chunk.vector && chunk.vector.data) {
      console.log("   ✅ Vector has data property");
      const vectorArray = Array.from(chunk.vector.data);
      console.log(`   Array length: ${vectorArray.length}`);
      console.log(`   First 5 values: [${vectorArray.slice(0, 5).join(', ')}]`);
    }
    
    // Method 5: Check other properties
    console.log("\n🔍 Vector object properties:");
    const props = Object.getOwnPropertyNames(chunk.vector);
    props.forEach(prop => {
      const value = chunk.vector[prop];
      console.log(`   ${prop}: ${typeof value}`);
    });
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

debugLanceVector();