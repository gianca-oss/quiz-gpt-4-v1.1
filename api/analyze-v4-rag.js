// api/analyze-v4-rag.js
// Endpoint che usa i dati preprocessati con Pinecone

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-3.5-turbo',
        embeddingModel: 'text-embedding-3-small'
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY
    }
};

// Inizializza servizi
let pineconeIndex = null;
let openaiClient = null;

async function initServices() {
    if (!pineconeIndex) {
        const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
        pineconeIndex = pc.index(CONFIG.pinecone.indexName);
    }
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: CONFIG.openai.apiKey });
    }
}

// Cerca nel database vettoriale
async function searchKnowledge(questionText, options) {
    // Genera embedding della domanda
    const queryText = questionText + ' ' + Object.values(options).join(' ');
    
    const embeddingResponse = await openaiClient.embeddings.create({
        model: CONFIG.openai.embeddingModel,
        input: queryText
    });
    
    // Cerca in Pinecone
    const results = await pineconeIndex.query({
        vector: embeddingResponse.data[0].embedding,
        topK: 5,
        includeMetadata: true
    });
    
    // Estrai contesto rilevante
    const context = results.matches
        .filter(m => m.score > 0.7)
        .map(m => m.metadata.text)
        .join('\n\n');
    
    return context;
}

// Analizza domanda con RAG
async function analyzeQuestionWithRAG(question, context) {
    const prompt = `Basandoti ESCLUSIVAMENTE sul seguente contesto del corso, rispondi alla domanda.

CONTESTO:
${context}

DOMANDA: ${question.text}
OPZIONI:
${Object.entries(question.options).map(([k, v]) => `${k}: ${v}`).join('\n')}

Quale è la risposta corretta? Rispondi SOLO con la lettera (A, B, C o D).`;

    const response = await openaiClient.chat.completions.create({
        model: CONFIG.openai.model,
        messages: [
            { role: 'system', content: 'Rispondi basandoti solo sul contesto fornito.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 10
    });
    
    return response.choices[0].message.content.trim().toUpperCase();
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ready',
            version: 'v4-rag',
            services: {
                pinecone: !!CONFIG.pinecone.apiKey,
                openai: !!CONFIG.openai.apiKey,
                anthropic: !!CONFIG.anthropic.apiKey
            }
        });
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        console.log('🚀 Analisi con RAG v4...');
        await initServices();
        
        const messageContent = req.body.messages[0].content;
        const imageContent = messageContent.find(c => c.type === 'image');
        
        // Estrai domande con Claude (più economico)
        const extractResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.anthropic.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1500,
                temperature: 0,
                messages: [{
                    role: 'user',
                    content: [
                        imageContent,
                        { 
                            type: 'text', 
                            text: `Estrai le domande. Formato JSON:
{
  "questions": [
    {
      "number": 1,
      "text": "testo domanda",
      "options": {"A": "", "B": "", "C": "", "D": ""}
    }
  ]
}`
                        }
                    ]
                }]
            })
        });
        
        const extractData = await extractResponse.json();
        const questions = JSON.parse(extractData.content[0].text).questions;
        
        console.log(`✅ Estratte ${questions.length} domande`);
        
        // Analizza ogni domanda con RAG
        const results = [];
        for (const question of questions) {
            const context = await searchKnowledge(question.text, question.options);
            const answer = await analyzeQuestionWithRAG(question, context);
            
            results.push({
                number: question.number,
                answer: answer,
                confidence: context.length > 100 ? 95 : 80
            });
            
            console.log(`Q${question.number}: ${answer}`);
        }
        
        // Formatta risposta HTML
        let html = '<table style="width:100%;max-width:500px;margin:20px auto;border-collapse:collapse">';
        html += '<thead><tr style="background:#f5f5f7">';
        html += '<th style="padding:12px">DOMANDA</th>';
        html += '<th style="padding:12px">RISPOSTA</th>';
        html += '<th style="padding:12px">CONFIDENZA</th>';
        html += '</tr></thead><tbody>';
        
        for (const result of results) {
            const color = result.confidence >= 90 ? '#34c759' : '#ff9500';
            html += '<tr>';
            html += `<td style="padding:12px;text-align:center">${result.number}</td>`;
            html += `<td style="padding:12px;text-align:center;font-weight:bold;font-size:18px">${result.answer}</td>`;
            html += `<td style="padding:12px;text-align:center;color:${color}">${result.confidence}%</td>`;
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        html += '<div style="margin-top:20px;text-align:center;color:#86868b;font-size:12px">';
        html += '✨ Powered by RAG v4 with Vision-enhanced knowledge base';
        html += '</div>';
        
        res.status(200).json({
            content: [{
                type: 'text',
                text: html
            }],
            metadata: {
                questionsAnalyzed: questions.length,
                method: 'rag-v4-vision',
                accuracy: 'very-high'
            }
        });
        
    } catch (error) {
        console.error('❌ Errore:', error);
        res.status(500).json({ error: error.message });
    }
}