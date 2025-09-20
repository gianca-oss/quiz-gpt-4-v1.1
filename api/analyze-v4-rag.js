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
    // Verifica le chiavi API
    if (!CONFIG.pinecone.apiKey) {
        throw new Error('PINECONE_API_KEY non configurata');
    }
    if (!CONFIG.openai.apiKey) {
        throw new Error('OPENAI_API_KEY non configurata');
    }
    if (!CONFIG.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY non configurata');
    }
    
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
    try {
        // Genera embedding della domanda
        const queryText = questionText + ' ' + Object.values(options).join(' ');
        
        const embeddingResponse = await openaiClient.embeddings.create({
            model: CONFIG.openai.embeddingModel,
            input: queryText
        });
        
        // Verifica risposta embedding
        if (!embeddingResponse?.data?.[0]?.embedding) {
            console.error('Invalid embedding response:', embeddingResponse);
            return '';
        }
        
        // Cerca in Pinecone
        const results = await pineconeIndex.query({
            vector: embeddingResponse.data[0].embedding,
            topK: 5,
            includeMetadata: true
        });
        
        // Estrai contesto rilevante
        const context = results.matches
            .filter(m => m.score > 0.7)
            .map(m => m.metadata?.text || '')
            .filter(text => text.length > 0)
            .join('\n\n');
        
        return context;
    } catch (error) {
        console.error('Error in searchKnowledge:', error);
        return '';
    }
}

// Analizza domanda con RAG
async function analyzeQuestionWithRAG(question, context) {
    const prompt = `Basandoti ESCLUSIVAMENTE sul seguente contesto del corso, rispondi alla domanda.

CONTESTO:
${context || 'Nessun contesto disponibile'}

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
    
    // Gestisci risposta
    const answer = response?.choices?.[0]?.message?.content?.trim().toUpperCase() || 'N/A';
    return answer.match(/^[ABCD]$/) ? answer : 'N/A';
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
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
        
        // Inizializza servizi
        await initServices();
        
        // Validazione request body
        if (!req.body?.messages?.[0]?.content) {
            return res.status(400).json({ 
                error: 'Invalid request body',
                details: 'Expected messages with content' 
            });
        }
        
        const messageContent = req.body.messages[0].content;
        const imageContent = messageContent.find(c => c.type === 'image');
        
        if (!imageContent) {
            return res.status(400).json({ 
                error: 'No image found',
                details: 'Image is required for analysis' 
            });
        }
        
        // Estrai domande con Claude
        console.log('Calling Claude API...');
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
                            text: `Extract all quiz questions from the image. Return ONLY valid JSON in this exact format:
{
  "questions": [
    {
      "number": 1,
      "text": "question text here",
      "options": {"A": "option A", "B": "option B", "C": "option C", "D": "option D"}
    }
  ]
}
Do not include any text outside the JSON.`
                        }
                    ]
                }]
            })
        });
        
        if (!extractResponse.ok) {
            const errorText = await extractResponse.text();
            console.error('Claude API error:', extractResponse.status, errorText);
            return res.status(500).json({ 
                error: 'Claude API error',
                status: extractResponse.status,
                details: errorText 
            });
        }
        
        const extractData = await extractResponse.json();
        console.log('Claude response received');
        
        // Trova il contenuto testuale nella risposta
        let questionsText = '';
        if (extractData?.content) {
            for (const content of extractData.content) {
                if (content.type === 'text' && content.text) {
                    questionsText = content.text;
                    break;
                }
            }
        }
        
        if (!questionsText) {
            console.error('No text found in Claude response:', extractData);
            return res.status(500).json({ 
                error: 'No text in Claude response',
                details: 'Could not extract questions from image'
            });
        }
        
        // Parse JSON
        let questions;
        try {
            // Pulisci il testo da eventuali caratteri extra
            questionsText = questionsText.trim();
            if (questionsText.startsWith('```json')) {
                questionsText = questionsText.replace(/```json\s*/, '').replace(/```\s*$/, '');
            }
            
            const parsed = JSON.parse(questionsText);
            questions = parsed.questions || [];
        } catch (parseError) {
            console.error('JSON parse error:', parseError.message);
            console.error('Raw text:', questionsText);
            return res.status(500).json({ 
                error: 'Failed to parse questions',
                details: parseError.message
            });
        }
        
        console.log(`✅ Extracted ${questions.length} questions`);
        
        // Se non ci sono domande
        if (questions.length === 0) {
            return res.status(200).json({
                content: [{
                    type: 'text',
                    text: '<div style="text-align:center;padding:20px;color:#86868b;">Nessuna domanda trovata nell\'immagine</div>'
                }],
                metadata: {
                    questionsAnalyzed: 0,
                    method: 'rag-v4-vision'
                }
            });
        }
        
        // Analizza ogni domanda con RAG
        const results = [];
        for (const question of questions) {
            try {
                const context = await searchKnowledge(question.text, question.options || {});
                const answer = await analyzeQuestionWithRAG(question, context);
                
                results.push({
                    number: question.number || results.length + 1,
                    answer: answer,
                    confidence: context && context.length > 100 ? 95 : 80
                });
                
                console.log(`Q${question.number}: ${answer}`);
            } catch (err) {
                console.error(`Error processing question ${question.number}:`, err);
                results.push({
                    number: question.number || results.length + 1,
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
        
        return res.status(200).json({
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
        console.error('❌ Error:', error);
        console.error('Stack:', error.stack);
        return res.status(500).json({ 
            error: error.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}