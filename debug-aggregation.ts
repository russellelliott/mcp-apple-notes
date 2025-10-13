#!/usr/bin/env bun
import { createNotesTable } from "./index.js";

async function debugAggregation() {
  console.log("🔍 Debugging aggregation step by step...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Get all chunks from database
    const allChunks = await notesTable.search("").limit(100000).toArray();
    console.log(`📄 Found ${allChunks.length} chunks to aggregate`);
    
    // Group by note (using title + creation_date as unique key)
    const noteMap = new Map();
    
    for (const chunk of allChunks) {
      const noteKey = `${chunk.title}|||${chunk.creation_date}`;
      
      if (!noteMap.has(noteKey)) {
        noteMap.set(noteKey, {
          title: chunk.title,
          creation_date: chunk.creation_date,
          modification_date: chunk.modification_date,
          content: chunk.content,
          vectors: [],
          chunks: []
        });
      }
      
      console.log(`\n🔍 Processing chunk from "${chunk.title}"`);
      console.log(`   Vector exists: ${!!chunk.vector}`);
      console.log(`   Vector type: ${typeof chunk.vector}`);
      
      // LanceDB stores vectors as Vector objects, convert to array
      let vectorArray = null;
      if (chunk.vector) {
        if (typeof chunk.vector.toArray === 'function') {
          console.log(`   Using toArray() method`);
          vectorArray = chunk.vector.toArray();
        } else if (Symbol.iterator in chunk.vector) {
          console.log(`   Using Array.from() method`);
          vectorArray = Array.from(chunk.vector);
        }
      }
      
      console.log(`   Vector array length: ${vectorArray?.length || 'null'}`);
      console.log(`   Vector array is array: ${Array.isArray(vectorArray)}`);
      console.log(`   Vector array has values: ${vectorArray && vectorArray.length > 0}`);
      
      if (vectorArray && Array.isArray(vectorArray) && vectorArray.length > 0) {
        noteMap.get(noteKey).vectors.push(vectorArray);
        noteMap.get(noteKey).chunks.push({
          index: chunk.chunk_index,
          content: chunk.chunk_content
        });
        console.log(`   ✅ Added vector to note map`);
      } else {
        console.log(`   ❌ Vector not added to note map`);
      }
    }
    
    console.log(`\n📊 Note map summary:`);
    noteMap.forEach((note, key) => {
      console.log(`   "${note.title}": ${note.vectors.length} vectors`);
    });
    
    // Create note-level embeddings by averaging chunk vectors
    const noteEmbeddings = Array.from(noteMap.values())
      .filter(note => note.vectors.length > 0)
      .map(note => {
        console.log(`\n📊 Processing note "${note.title}" with ${note.vectors.length} vectors`);
        
        // Average all chunk vectors for this note
        const avgVector = note.vectors[0].map((_, dimIdx) => 
          note.vectors.reduce((sum, vec) => sum + vec[dimIdx], 0) / note.vectors.length
        );
        
        console.log(`   Average vector length: ${avgVector.length}`);
        console.log(`   First 3 values: [${avgVector.slice(0, 3).join(', ')}]`);
        
        return {
          ...note,
          embedding: avgVector,
          numChunks: note.vectors.length
        };
      });
    
    console.log(`\n✅ Final result: ${noteEmbeddings.length} notes with embeddings`);
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

debugAggregation();