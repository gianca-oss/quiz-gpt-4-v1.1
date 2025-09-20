# preprocess_v4.py
# Preprocessing avanzato del corso PDF con OpenAI e Pinecone
# Ottimizzato per Windows 11

import os
import json
import time
from typing import List, Dict, Any
from pathlib import Path

# Dipendenze esterne
from dotenv import load_dotenv
import openai
from openai import OpenAI
from pinecone import Pinecone
import PyPDF2
import tiktoken

# Carica configurazione da .env.local
load_dotenv('.env.local')

# ============ CONFIGURAZIONE ============
CONFIG = {
    'openai': {
        'api_key': os.getenv('OPENAI_API_KEY'),
        'model': 'gpt-3.5-turbo',  # Usa gpt-4 se vuoi più accuratezza
        'embedding_model': 'text-embedding-3-small',  # Più economico
        'max_tokens': 500,
        'temperature': 0.1
    },
    'pinecone': {
        'api_key': os.getenv('PINECONE_API_KEY'),
        'environment': os.getenv('PINECONE_ENVIRONMENT', 'us-east-1'),
        'index_name': 'quiz-course-v4',
        'dimension': 1536  # Dimensione per text-embedding-3-small
    },
    'processing': {
        'chunk_size': 1000,  # Caratteri per chunk
        'chunk_overlap': 200,
        'max_chunks_to_process': 100,  # Limita per test (rimuovi per processare tutto)
        'batch_size': 10
    },
    'paths': {
        'pdf_source': r'data\source\corso_completo.pdf',
        'output_dir': r'data\processed-v4',
        'chunks_file': r'data\processed-v4\chunks.json',
        'metadata_file': r'data\processed-v4\metadata.json'
    }
}

class PDFProcessor:
    """Gestisce l'estrazione e il processing del PDF"""
    
    def __init__(self):
        self.text = ""
        self.metadata = {}
        self.pages = []
    
    def extract_pdf(self, pdf_path: str) -> str:
        """Estrae testo dal PDF"""
        print(f"📚 Estrazione PDF: {pdf_path}")
        
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF non trovato: {pdf_path}")
        
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            
            self.metadata = {
                'total_pages': len(pdf_reader.pages),
                'info': pdf_reader.metadata if pdf_reader.metadata else {}
            }
            
            print(f"  📄 Totale pagine: {self.metadata['total_pages']}")
            
            # Estrai testo pagina per pagina
            for i, page in enumerate(pdf_reader.pages):
                page_text = page.extract_text()
                self.pages.append({
                    'page_num': i + 1,
                    'text': page_text,
                    'char_count': len(page_text)
                })
                self.text += page_text + "\n\n"
                
                if (i + 1) % 10 == 0:
                    print(f"  ✓ Processate {i + 1}/{self.metadata['total_pages']} pagine")
        
        print(f"✅ Estratti {len(self.text)} caratteri totali\n")
        return self.text
    
    def create_chunks(self, text: str) -> List[Dict]:
        """Divide il testo in chunks intelligenti"""
        print("🧩 Creazione chunks semantici...")
        
        chunks = []
        chunk_size = CONFIG['processing']['chunk_size']
        overlap = CONFIG['processing']['chunk_overlap']
        
        # Dividi per paragrafi
        paragraphs = text.split('\n\n')
        current_chunk = ""
        chunk_id = 0
        
        for para in paragraphs:
            # Se aggiungere questo paragrafo supera la dimensione
            if len(current_chunk) + len(para) > chunk_size and current_chunk:
                chunks.append({
                    'id': f'chunk_{chunk_id}',
                    'text': current_chunk.strip(),
                    'char_count': len(current_chunk),
                    'chunk_index': chunk_id
                })
                chunk_id += 1
                
                # Overlap: prendi ultime frasi del chunk precedente
                sentences = current_chunk.split('. ')
                if len(sentences) > 2:
                    overlap_text = '. '.join(sentences[-2:])[:overlap]
                    current_chunk = overlap_text + " " + para
                else:
                    current_chunk = para
            else:
                current_chunk += "\n\n" + para if current_chunk else para
        
        # Aggiungi ultimo chunk
        if current_chunk.strip():
            chunks.append({
                'id': f'chunk_{chunk_id}',
                'text': current_chunk.strip(),
                'char_count': len(current_chunk),
                'chunk_index': chunk_id
            })
        
        print(f"✅ Creati {len(chunks)} chunks\n")
        return chunks

class SemanticAnalyzer:
    """Analisi semantica con OpenAI"""
    
    def __init__(self):
        self.client = OpenAI(api_key=CONFIG['openai']['api_key'])
        self.encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    
    def analyze_chunk(self, chunk: Dict) -> Dict:
        """Analizza semanticamente un chunk"""
        try:
            prompt = f"""Analizza questo estratto di un corso di informatica e estrai:
1. L'argomento principale
2. I concetti chiave (max 5)
3. Il tipo di contenuto

Testo:
{chunk['text'][:2000]}

Rispondi in JSON:
{{
  "topic": "argomento principale",
  "concepts": ["concetto1", "concetto2"],
  "content_type": "theory|practice|example|definition",
  "importance": 1-10,
  "summary": "riassunto in una frase"
}}"""

            response = self.client.chat.completions.create(
                model=CONFIG['openai']['model'],
                messages=[{"role": "user", "content": prompt}],
                temperature=CONFIG['openai']['temperature'],
                max_tokens=CONFIG['openai']['max_tokens'],
                response_format={"type": "json_object"}
            )
            
            analysis = json.loads(response.choices[0].message.content)
            return analysis
            
        except Exception as e:
            print(f"  ⚠️ Errore analisi: {e}")
            return {
                'topic': 'Unknown',
                'concepts': [],
                'content_type': 'text',
                'importance': 5,
                'summary': chunk['text'][:100]
            }
    
    def generate_embedding(self, text: str) -> List[float]:
        """Genera embedding per il testo"""
        try:
            response = self.client.embeddings.create(
                model=CONFIG['openai']['embedding_model'],
                input=text[:8000]  # Limita lunghezza
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"  ⚠️ Errore embedding: {e}")
            return None

class VectorIndexer:
    """Gestisce l'indicizzazione in Pinecone"""
    
    def __init__(self):
        self.pc = Pinecone(api_key=CONFIG['pinecone']['api_key'])
        self.index_name = CONFIG['pinecone']['index_name']
        self.index = None
        self._setup_index()
    
    def _setup_index(self):
        """Crea o connette all'indice Pinecone"""
        print("🔗 Configurazione Pinecone...")
        
        # Lista indici esistenti
        existing_indexes = [idx.name for idx in self.pc.list_indexes()]
        
        if self.index_name not in existing_indexes:
            print(f"  📦 Creazione nuovo indice '{self.index_name}'...")
            self.pc.create_index(
                name=self.index_name,
                dimension=CONFIG['pinecone']['dimension'],
                metric='cosine',
                spec={
                    'serverless': {
                        'cloud': 'aws',
                        'region': 'us-east-1'
                    }
                }
            )
            print("  ⏳ Attesa inizializzazione (30 secondi)...")
            time.sleep(30)
        
        self.index = self.pc.Index(self.index_name)
        stats = self.index.describe_index_stats()
        print(f"✅ Indice pronto: {stats['total_vector_count']} vettori esistenti\n")
    
    def index_chunks(self, chunks: List[Dict]) -> int:
        """Indicizza i chunks in Pinecone"""
        print("🚀 Indicizzazione in Pinecone...")
        
        indexed = 0
        batch_size = CONFIG['processing']['batch_size']
        
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            vectors = []
            
            for chunk in batch:
                if chunk.get('embedding'):
                    vectors.append({
                        'id': chunk['id'],
                        'values': chunk['embedding'],
                        'metadata': {
                            'text': chunk['text'][:500],  # Limita per metadata
                            'topic': chunk.get('analysis', {}).get('topic', 'Unknown'),
                            'concepts': ', '.join(chunk.get('analysis', {}).get('concepts', [])),
                            'importance': chunk.get('analysis', {}).get('importance', 5),
                            'chunk_index': chunk['chunk_index']
                        }
                    })
            
            if vectors:
                try:
                    self.index.upsert(vectors)
                    indexed += len(vectors)
                    print(f"  ✓ Indicizzati {indexed} chunks")
                except Exception as e:
                    print(f"  ❌ Errore batch: {e}")
        
        print(f"✅ Indicizzazione completata: {indexed} vettori\n")
        return indexed

class PreprocessingPipeline:
    """Pipeline completa di preprocessing"""
    
    def __init__(self):
        self.pdf_processor = PDFProcessor()
        self.semantic_analyzer = SemanticAnalyzer()
        self.vector_indexer = VectorIndexer()
        
    def run(self):
        """Esegue il preprocessing completo"""
        print("╔════════════════════════════════════════╗")
        print("║   PREPROCESSING v4 - Windows Edition    ║")
        print("╚════════════════════════════════════════╝\n")
        
        start_time = time.time()
        
        try:
            # 1. Estrai PDF
            pdf_text = self.pdf_processor.extract_pdf(CONFIG['paths']['pdf_source'])
            
            # 2. Crea chunks
            chunks = self.pdf_processor.create_chunks(pdf_text)
            
            # Limita chunks per test
            max_chunks = CONFIG['processing'].get('max_chunks_to_process')
            if max_chunks and len(chunks) > max_chunks:
                print(f"⚠️ Limitato a {max_chunks} chunks per test\n")
                chunks = chunks[:max_chunks]
            
            # 3. Analisi semantica e embeddings
            print("🧠 Analisi semantica con OpenAI...")
            analyzed_chunks = []
            
            for i, chunk in enumerate(chunks):
                print(f"\r  Analisi chunk {i+1}/{len(chunks)}...", end='')
                
                # Analisi semantica
                analysis = self.semantic_analyzer.analyze_chunk(chunk)
                chunk['analysis'] = analysis
                
                # Genera embedding
                embedding = self.semantic_analyzer.generate_embedding(chunk['text'])
                chunk['embedding'] = embedding
                
                analyzed_chunks.append(chunk)
                
                # Pausa per evitare rate limiting
                if (i + 1) % 10 == 0:
                    time.sleep(1)
            
            print(f"\n✅ Analizzati {len(analyzed_chunks)} chunks\n")
            
            # 4. Indicizza in Pinecone
            indexed = self.vector_indexer.index_chunks(analyzed_chunks)
            
            # 5. Salva dati locali
            self._save_data(analyzed_chunks, indexed)
            
            # Report finale
            elapsed = time.time() - start_time
            self._print_report(len(chunks), indexed, elapsed)
            
        except Exception as e:
            print(f"\n❌ ERRORE: {e}")
            print("\nVerifica:")
            print("1. Le API keys in .env.local")
            print("2. Il file corso_completo.pdf in data\\source\\")
            print("3. La connessione internet")
    
    def _save_data(self, chunks: List[Dict], indexed: int):
        """Salva i dati processati"""
        print("💾 Salvataggio dati locali...")
        
        # Crea directory
        output_dir = Path(CONFIG['paths']['output_dir'])
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Rimuovi embeddings per salvare spazio
        chunks_to_save = []
        for chunk in chunks:
            chunk_copy = chunk.copy()
            chunk_copy.pop('embedding', None)  # Rimuovi embedding
            chunks_to_save.append(chunk_copy)
        
        # Salva chunks
        chunks_file = Path(CONFIG['paths']['chunks_file'])
        with open(chunks_file, 'w', encoding='utf-8') as f:
            json.dump(chunks_to_save, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Chunks salvati: {chunks_file}")
        
        # Salva metadata
        metadata = {
            'version': '4.0',
            'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'pdf_metadata': self.pdf_processor.metadata,
            'processing': {
                'total_chunks': len(chunks),
                'indexed_vectors': indexed,
                'chunk_size': CONFIG['processing']['chunk_size'],
                'model': CONFIG['openai']['model'],
                'embedding_model': CONFIG['openai']['embedding_model']
            },
            'topics': list(set(c.get('analysis', {}).get('topic', '') 
                             for c in chunks if c.get('analysis', {}).get('topic')))
        }
        
        metadata_file = Path(CONFIG['paths']['metadata_file'])
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Metadata salvato: {metadata_file}\n")
    
    def _print_report(self, total_chunks: int, indexed: int, elapsed: float):
        """Stampa report finale"""
        print("╔════════════════════════════════════════╗")
        print("║         PREPROCESSING COMPLETATO         ║")
        print("╚════════════════════════════════════════╝\n")
        print(f"📊 RISULTATI:")
        print(f"  • Chunks processati: {total_chunks}")
        print(f"  • Vettori indicizzati: {indexed}")
        print(f"  • Tempo totale: {elapsed:.1f} secondi")
        print(f"  • Dati salvati in: {CONFIG['paths']['output_dir']}")
        print(f"\n✨ Il corso è pronto per l'analisi semantica dei quiz!")

def main():
    """Funzione principale"""
    # Verifica configurazione
    if not CONFIG['openai']['api_key']:
        print("❌ ERRORE: OPENAI_API_KEY mancante in .env.local")
        return
    
    if not CONFIG['pinecone']['api_key']:
        print("❌ ERRORE: PINECONE_API_KEY mancante in .env.local")
        return
    
    # Esegui pipeline
    pipeline = PreprocessingPipeline()
    pipeline.run()

if __name__ == "__main__":
    main()