// scripts/test-pinecone.js
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('quiz-course-v4-vision');

async function testIndex() {
    // Verifica statistiche
    const stats = await index.describeIndexStats();
    console.log('📊 Statistiche indice:');
    console.log('  Total vectors:', stats.totalRecordCount);
    
    // Fai una query di test
    const testVector = new Array(1536).fill(0.1);
    const results = await index.query({
        vector: testVector,
        topK: 3,
        includeMetadata: true
    });
    
    console.log('\n🔍 Test query - Risultati trovati:', results.matches.length);
    results.matches.forEach((match, i) => {
        console.log(`\n  Result ${i+1}:`);
        console.log(`    Score: ${match.score}`);
        console.log(`    Text preview: ${match.metadata?.text?.substring(0, 100)}...`);
    });
}

testIndex();