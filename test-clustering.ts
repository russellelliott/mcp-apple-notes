#!/usr/bin/env bun
import { createNotesTable, clusterNotes, listClusters, getNotesInCluster } from "./index.js";

async function testClustering() {
  console.log("🧪 Testing clustering functionality...\n");
  
  try {
    // Step 1: Open the existing notes table
    console.log("📂 Opening notes table...");
    const { notesTable } = await createNotesTable();
    
    // Check how many notes we have
    const totalChunks = await notesTable.countRows();
    const allChunks = await notesTable.search("").limit(100).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => chunk.title));
    
    console.log(`📊 Found ${uniqueNotes.size} notes (${totalChunks} chunks) in database`);
    
    if (uniqueNotes.size < 3) {
      console.log("⚠️ Need at least 3 notes for meaningful clustering. Run indexing first.");
      return;
    }
    
    // Step 2: Run clustering with small parameters for testing
    console.log("\n🔬 Running DBSCAN clustering...");
    const clusterResult = await clusterNotes(
      notesTable, 
      2, // min_cluster_size = 2 (small for testing)
      0.5 // epsilon = 0.5 (larger for more permissive clustering)
    );
    
    console.log("\n📊 Clustering Results:");
    console.log(`• Total clusters: ${clusterResult.totalClusters}`);
    console.log(`• Outlier notes: ${clusterResult.outliers}`);
    console.log(`• Processing time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    // Step 3: List all clusters
    console.log("\n📋 Listing all clusters...");
    const clusters = await listClusters(notesTable);
    
    if (clusters.length === 0) {
      console.log("No clusters found after clustering.");
      return;
    }
    
    clusters.forEach((cluster, idx) => {
      const isOutlier = cluster.cluster_id === '-1';
      const emoji = isOutlier ? '📌' : '📁';
      
      console.log(`${emoji} ${idx + 1}. ${cluster.cluster_label} (ID: ${cluster.cluster_id})`);
      console.log(`   📊 ${cluster.note_count} notes`);
      console.log(`   📝 ${cluster.cluster_summary}`);
      console.log('');
    });
    
    // Step 4: Show notes in the first cluster (if any)
    const firstCluster = clusters.find(c => c.cluster_id !== '-1');
    if (firstCluster) {
      console.log(`\n📖 Notes in cluster "${firstCluster.cluster_label}" (ID: ${firstCluster.cluster_id}):`);
      
      const notesInCluster = await getNotesInCluster(notesTable, firstCluster.cluster_id);
      
      notesInCluster.forEach((note, idx) => {
        console.log(`${idx + 1}. "${note.title}"`);
        console.log(`   📅 Created: ${note.creation_date}`);
        console.log(`   ✏️ Modified: ${note.modification_date}`);
        console.log(`   📄 ${note.total_chunks} chunks`);
        console.log('');
      });
    }
    
    // Step 5: Show outlier notes
    const outlierCluster = clusters.find(c => c.cluster_id === '-1');
    if (outlierCluster && outlierCluster.note_count > 0) {
      console.log(`\n📌 Outlier notes (${outlierCluster.note_count} notes):`);
      
      const outlierNotes = await getNotesInCluster(notesTable, '-1');
      
      outlierNotes.slice(0, 5).forEach((note, idx) => {
        console.log(`${idx + 1}. "${note.title}"`);
      });
      
      if (outlierNotes.length > 5) {
        console.log(`... and ${outlierNotes.length - 5} more outlier notes`);
      }
    }
    
    console.log("\n✨ Clustering test completed!");
    
  } catch (error) {
    console.error("\n❌ Error during clustering test:", error);
  }
  
  process.exit(0);
}

testClustering();