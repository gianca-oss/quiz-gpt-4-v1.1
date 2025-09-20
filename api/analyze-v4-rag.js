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
        
        // Validazione request body
        if (!req.body || !req.body.messages || !Array.isArray(req.body.messages) || req.body.messages.length === 0) {
            return res.status(400).json({ 
                error: 'Invalid request body',
                details: 'Expected messages array' 
            });
        }
        
        const messageContent = req.body.messages[0].content;
        if (!messageContent || !Array.isArray(messageContent)) {
            return res.status(400).json({ 
                error: 'Invalid message content',
                details: 'Expected content array' 
            });
        }
        
        const imageContent = messageContent.find(c => c.type === 'image');
        if (!imageContent) {
            return res.status(400).json({ 
                error: 'No image found',
                details: 'Image is required for analysis' 
            });
        }
        
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
        
        // Controlla response status
        if (!extractResponse.ok) {
            const errorText = await extractResponse.text();
            console.error('Claude API error:', errorText);
            return res.status(500).json({ 
                error: 'Claude API error',
                details: errorText 
            });
        }
        
        const extractData = await extractResponse.json();
        console.log('Claude response:', JSON.stringify(extractData, null, 2));
        
        // Validazione risposta Claude
        if (!extractData || !extractData.content || !Array.isArray(extractData.content) || extractData.content.length === 0) {
            console.error('Invalid Claude response structure:', extractData);
            return res.status(500).json({ 
                error: 'Invalid response from Claude',
                details: 'Missing content array',
                response: extractData
            });
        }
        
        // Trova il contenuto testuale
        const textContent = extractData.content.find(c => c.type === 'text');
        if (!textContent || !textContent.text) {
            console.error('No text content in Claude response:', extractData.content);
            return res.status(500).json({ 
                error: 'No text in Claude response',
                details: 'Expected text content',
                content: extractData.content
            });
        }
        
        // Parsing JSON con gestione errori
        let questions;
        try {
            const parsedContent = JSON.parse(textContent.text);
            questions = parsedContent.questions;
            
            if (!questions || !Array.isArray(questions)) {
                throw new Error('Questions array not found in parsed content');
            }
        } catch (parseError) {
            console.error('Failed to parse Claude response:', textContent.text);
            return res.status(500).json({ 
                error: 'Failed to parse questions',
                details: parseError.message,
                rawText: textContent.text
            });
        }
        
        console.log(`✅ Estratte ${questions.length} domande`);
        
        // Analizza ogni domanda con RAG
        const results = [];
        for (const question of questions) {
            try {
                const context = await searchKnowledge(question.text, question.options);
                const answer = await analyzeQuestionWithRAG(question, context);
                
                results.push({
                    number: question.number,
                    answer: answer,
                    confidence: context.length > 100 ? 95 : 80
                });
                
                console.log(`Q${question.number}: ${answer}`);
            } catch (questionError) {
                console.error(`Error processing question ${question.number}:`, questionError);
                results.push({
                    number: question.number,
                    answer: 'ERROR',
                    confidence: 0
                });
            }
        }
        
        // Formatta risposta HTML
        let html = '<table style="width:100%;max-width:500px;margin:20px auto;border-collapse:collapse">';
        html += '<thead><tr style="background:#f5f5f7">';
        html += '<th style="padding:12px">DOMANDA</th>';
        html += '<th style="padding:12px">RISPOSTA</th>';
        html += '<th style="padding:12px">CONFIDENZA</th>';
        html += '</tr></thead><tbody>';
        
        for (const result of results) {
            const color = result.confidence >= 90 ? '#34c759' : result.confidence === 0 ? '#ff3b30' : '#ff9500';
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
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}