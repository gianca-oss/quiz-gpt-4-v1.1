// test-pinecone-content.js
// Script per verificare cosa c'è realmente in Pinecone e perché non trova match

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        embeddingModel: 'text-embedding-3-small'
    }
};

async function main() {
    console.log('🔍 TEST CONTENUTO PINECONE\n');
    console.log('═══════════════════════════════════════\n');

    const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
    const index = pc.index(CONFIG.pinecone.indexName);
    const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });

    // 1. Verifica statistiche
    const stats = await index.describeIndexStats();
    console.log('📊 STATISTICHE INDICE:');
    console.log(`   Vettori totali: ${stats.totalVectorCount || 0}`);
    console.log(`   Dimensione: ${stats.dimension || 0}\n`);

    if (stats.totalVectorCount === 0) {
        console.log('❌ L\'indice è VUOTO! Devi prima indicizzare i dati.');
        return;
    }

    // 2. Test con le query del quiz che non funzionano
    const testQueries = [
        "matrice di confusione",
        "quarta rivoluzione industriale",
        "overfitting machine learning",
        "processo produttivo turni settimana",
        "paradigma produzione personalizzazione massa",
        "customizer produttore"
    ];

    console.log('🧪 TEST QUERIES DAL QUIZ:\n');

    for (const query of testQueries) {
        console.log(`\n📝 Query: "${query}"`);
        console.log('━━━━━━━━━━━━━━━━━━━━━');
        
        try {
            // Genera embedding
            const embeddingResponse = await openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: query
            });

            // Cerca con diverse threshold
            const results = await index.query({
                vector: embeddingResponse.data[0].embedding,
                topK: 5,
                includeMetadata: true
            });

            if (results.matches && results.matches.length > 0) {
                console.log('   Risultati trovati:');
                
                results.matches.forEach((match, idx) => {
                    const score = match.score.toFixed(3);
                    const text = match.metadata?.text || '';
                    const preview = text.substring(0, 100).replace(/\n/g, ' ');
                    
                    let indicator = '';
                    if (match.score > 0.7) indicator = '✅';
                    else if (match.score > 0.5) indicator = '⚠️';
                    else indicator = '❌';
                    
                    console.log(`   ${idx + 1}. ${indicator} Score: ${score}`);
                    console.log(`      "${preview}..."`);
                });
                
                // Analisi
                const bestScore = results.matches[0].score;
                if (bestScore < 0.5) {
                    console.log('\n   ⚠️ PROBLEMA: Score troppo basso! Il contenuto non matcha.');
                }
            } else {
                console.log('   ❌ NESSUN RISULTATO');
            }
            
        } catch (error) {
            console.log(`   ❌ Errore: ${error.message}`);
        }
    }

    // 3. Prendi un campione random per vedere cosa c'è
    console.log('\n\n📚 CAMPIONE CASUALE DEL CONTENUTO:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Query con vettore random per vedere contenuto casuale
    const randomVector = new Array(1536).fill(0).map(() => Math.random());
    const sampleResults = await index.query({
        vector: randomVector,
        topK: 3,
        includeMetadata: true
    });

    if (sampleResults.matches) {
        sampleResults.matches.forEach((match, idx) => {
            const text = match.metadata?.text || '';
            console.log(`Esempio ${idx + 1}:`);
            console.log(`   Testo: "${text.substring(0, 200)}..."\n`);
        });
    }

    // 4. Diagnosi
    console.log('\n📋 DIAGNOSI:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const allScores = [];
    for (const query of testQueries) {
        const embeddingResponse = await openai.embeddings.create({
            model: CONFIG.openai.embeddingModel,
            input: query
        });
        const results = await index.query({
            vector: embeddingResponse.data[0].embedding,
            topK: 1,
            includeMetadata: false
        });
        if (results.matches?.[0]) {
            allScores.push(results.matches[0].score);
        }
    }
    
    const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    
    if (avgScore < 0.4) {
        console.log('🔴 PROBLEMA CRITICO: Il contenuto indicizzato NON corrisponde alle domande!');
        console.log('\nPossibili cause:');
        console.log('1. Hai indicizzato il corso SBAGLIATO');
        console.log('2. Il corso è troppo generico e non copre questi argomenti specifici');
        console.log('3. Gli embeddings sono stati generati male');
        
        console.log('\n✅ SOLUZIONI:');
        console.log('1. Verifica che il PDF in data/corso_completo.pdf sia quello giusto');
        console.log('2. Re-indicizza con: node load-v4-to-pinecone.js');
        console.log('3. Abbassa la threshold nel codice a 0.2 o 0.3');
    } else if (avgScore < 0.6) {
        console.log('⚠️ PROBLEMA: Match parziale, threshold troppo alta');
        console.log('\n✅ SOLUZIONE: Abbassa la threshold da 0.7 a 0.4 nel file analyze-v4-rag.js');
    } else {
        console.log('✅ Il contenuto sembra OK, potrebbe essere un problema di threshold o di logica');
    }
}

main().catch(console.error);
