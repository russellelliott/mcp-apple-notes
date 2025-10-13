#!/usr/bin/env bun
import { createNotesTable, clusterNotes, listClusters, getNotesInCluster } from "./index.js";

async function testClusteringPermissive() {
  console.log("🧪 Testing clustering with permissive parameters...\n");
  
  try {
    const { notesTable } = await createNotesTable();
    
    // Check current state
    const allChunks = await notesTable.search("").limit(100).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => chunk.title));
    console.log(`📊 Found ${uniqueNotes.size} notes (${allChunks.length} chunks) in database`);
    
    // Try very permissive clustering parameters
    console.log("\n🔬 Running DBSCAN with very permissive parameters...");
    console.log("   • min_cluster_size = 2 (minimum points to form cluster)");
    console.log("   • epsilon = 1.0 (larger neighborhood radius)");
    
    const clusterResult = await clusterNotes(
      notesTable, 
      2,   // min_cluster_size = 2 
      1.0  // epsilon = 1.0 (very permissive)
    );
    
    console.log("\n📊 Clustering Results:");
    console.log(`• Total clusters: ${clusterResult.totalClusters}`);
    console.log(`• Outlier notes: ${clusterResult.outliers}`);
    
    // List clusters
    const clusters = await listClusters(notesTable);
    
    clusters.forEach((cluster, idx) => {
      const isOutlier = cluster.cluster_id === '-1';
      const emoji = isOutlier ? '📌' : '🎯';
      
      console.log(`\n${emoji} ${cluster.cluster_label} (ID: ${cluster.cluster_id})`);
      console.log(`   📊 ${cluster.note_count} notes`);
      console.log(`   📝 ${cluster.cluster_summary}`);
      
      if (!isOutlier) {
        console.log(`   🎉 Found actual cluster!`);
      }
    });
    
    // If we found actual clusters, show their contents
    const realClusters = clusters.filter(c => c.cluster_id !== '-1');
    for (const cluster of realClusters) {
      console.log(`\n📖 Notes in "${cluster.cluster_label}":`);
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      
      notesInCluster.forEach((note, idx) => {
        console.log(`   ${idx + 1}. "${note.title}"`);
      });
    }
    
    if (realClusters.length === 0) {
      console.log("\n💡 Suggestion: Try even larger epsilon (2.0) or check note content similarity");
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error);
  }
  
  process.exit(0);
}

testClusteringPermissive();