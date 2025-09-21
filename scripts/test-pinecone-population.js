// test-pinecone-population.js
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('quiz-course-v4-vision');

const stats = await index.describeIndexStats();
console.log('Vettori in Pinecone:', stats.totalRecordCount);