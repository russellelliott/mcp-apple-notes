#!/usr/bin/env bun
import { createNotesTableSmart } from "./index.js";

async function inspectDatabase() {
  console.log("🔍 Inspecting database contents...\n");
  
  try {
    const { notesTable } = await createNotesTableSmart(undefined, 'incremental');
    
    // Get a few chunks to see their structure
    const chunks = await notesTable.search("").limit(5).toArray();
    
    console.log(`📊 Found ${chunks.length} chunks. Sample data:`);
    
    chunks.forEach((chunk, idx) => {
      console.log(`\n${idx + 1}. Chunk from "${chunk.title}"`);
      console.log(`   📅 Created: ${chunk.creation_date}`);
      console.log(`   ✏️ Modified: ${chunk.modification_date}`);
      console.log(`   📄 Content length: ${chunk.content?.length || 0} chars`);
      console.log(`   🔢 Has vector: ${chunk.vector ? 'YES' : 'NO'}`);
      
      // Check if it has cluster fields
      console.log(`   🏷️ Cluster ID: ${chunk.cluster_id || 'null'}`);
      console.log(`   📝 Cluster label: ${chunk.cluster_label || 'null'}`);
      
      if (chunk.vector) {
        console.log(`   📐 Vector dimension: ${chunk.vector.length}`);
      }
    });
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

inspectDatabase();