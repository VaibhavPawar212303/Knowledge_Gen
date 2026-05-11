import { useState } from 'react';
import * as React from 'react';
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Document } from '../../types';
import { FileUp, Trash2, FileText, Loader2, Info, Globe, Link2, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DocumentManagerProps {
  projectId: string;
  documents: Document[];
  onSelectDocument: (id: string) => void;
}

export function DocumentManager({ projectId, documents, onSelectDocument }: DocumentManagerProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [url, setUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [filterCategory, setFilterCategory] = useState<'all' | 'api' | 'functional' | 'technical' | 'general'>('all');
  const [selectedCategory, setSelectedCategory] = useState<'api' | 'functional' | 'technical' | 'general'>('general');
  const [stagedContent, setStagedContent] = useState<{ raw: string; clean: string; title: string; category: 'api' | 'functional' | 'technical' | 'general' } | null>(null);

  const filteredDocuments = documents.filter(doc => filterCategory === 'all' || doc.category === filterCategory);

  const handleUrlFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !auth.currentUser) return;

    setIsFetchingUrl(true);
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) throw new Error('Fetch failed');
      const data = await response.json();

      // Automatically clean with Gemini
      const cleanContent = await import('../../services/geminiService').then(m => m.cleanScrapedContent(data.content));

      setStagedContent({
        raw: data.content,
        clean: cleanContent,
        title: data.title || url,
        category: selectedCategory
      });
      setUrl('');
    } catch (error) {
      console.error(error);
      alert('Failed to fetch content from URL. Ensure it is public.');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleSaveStaged = async () => {
    if (!stagedContent || !auth.currentUser) return;

    try {
      await addDoc(collection(db, 'projects', projectId, 'documents'), {
        projectId,
        name: stagedContent.title,
        content: stagedContent.clean,
        rawContent: stagedContent.raw,
        category: stagedContent.category,
        type: 'web/url',
        ownerId: auth.currentUser!.uid,
        createdAt: serverTimestamp()
      });
      setStagedContent(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'documents');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;

    setIsUploading(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        await addDoc(collection(db, 'projects', projectId, 'documents'), {
          projectId,
          name: file.name,
          content: content.slice(0, 50000), // Safety truncation
          category: selectedCategory,
          type: file.type || 'text/plain',
          ownerId: auth.currentUser!.uid,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'documents');
      } finally {
        setIsUploading(false);
      }
    };

    reader.readAsText(file);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'documents', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'documents');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-xl font-bold uppercase tracking-tight">Context Repository</h3>
          <p className="text-[10px] font-mono opacity-50 uppercase mt-1">UPLOAD PRD, SPECS, OR USER STORIES TO FEED THE RAG ENGINE_</p>
        </div>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <div className="flex bg-[#E4E3E0]/30 p-1 border border-[#141414]">
             {(['all', 'api', 'functional', 'technical', 'general'] as const).map(cat => (
               <button
                 key={cat}
                 onClick={() => setFilterCategory(cat)}
                 className={`px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest transition-colors ${
                   filterCategory === cat ? 'bg-[#141414] text-white' : 'hover:bg-white'
                 }`}
               >
                 {cat}
               </button>
             ))}
          </div>
          
          <select 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as any)}
            className="bg-white border border-[#141414] px-3 py-3 text-[10px] font-bold uppercase tracking-widest outline-none"
          >
            <option value="general">GENERAL_DOC</option>
            <option value="api">API_SPEC</option>
            <option value="functional">FUNCTIONAL_REQ</option>
            <option value="technical">TECHNICAL_SPEC</option>
          </select>
          
          <label className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#141414] text-white px-6 py-3 cursor-pointer hover:bg-[#333] transition-colors font-bold uppercase tracking-widest text-[10px]">
            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
            {isUploading ? 'PROCESSOR_RUNNING' : 'IMPORT_DOC'}
            <input type="file" className="hidden" onChange={handleFileUpload} accept=".txt,.md,.json,.csv" />
          </label>
        </div>
      </div>

      <div className="border border-[#141414] bg-white p-4">
        <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3 opacity-50 flex items-center gap-2">
          <Globe size={12} /> External Knowledge Source
        </h4>
        <form onSubmit={handleUrlFetch} className="flex flex-col sm:flex-row gap-2">
          <input 
            type="url"
            placeholder="ENTER DOCUMENTATION URL_ (HTTPS://...)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 bg-[#E4E3E0]/30 border border-[#141414] px-4 py-2 text-xs font-mono outline-none"
          />
          <button 
            type="submit"
            disabled={isFetchingUrl}
            className="bg-[#141414] text-white px-6 py-2 font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {isFetchingUrl ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            {isFetchingUrl ? 'FETCHING...' : 'SYNC_URL'}
          </button>
        </form>
      </div>

      <AnimatePresence>
        {stagedContent && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="border-2 border-[#141414] bg-white p-4 md:p-6 space-y-6"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[#141414] pb-4 gap-4">
              <div className="flex-1 w-full flex flex-col md:flex-row gap-4 items-start md:items-end">
                <div className="flex-1 w-full">
                  <input 
                    value={stagedContent.title}
                    onChange={(e) => setStagedContent({ ...stagedContent, title: e.target.value })}
                    className="w-full text-sm font-bold uppercase tracking-widest bg-transparent border-b border-[#141414]/20 focus:border-[#141414] outline-none"
                    placeholder="DOCUMENT_TITLE"
                  />
                  <p className="text-[10px] font-mono opacity-50 uppercase mt-1">Gemini Cleaned_ User Review Required_</p>
                </div>
                <select 
                  value={stagedContent.category}
                  onChange={(e) => setStagedContent({ ...stagedContent, category: e.target.value as any })}
                  className="bg-[#141414] text-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest outline-none"
                >
                  <option value="general">GENERAL_DOC</option>
                  <option value="api">API_SPEC</option>
                  <option value="functional">FUNCTIONAL_REQ</option>
                  <option value="technical">TECHNICAL_SPEC</option>
                </select>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <button 
                  onClick={() => setStagedContent(null)}
                  className="flex-1 md:flex-none px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-[#141414] hover:bg-red-50 transition-colors"
                >
                  Discard
                </button>
                <button 
                  onClick={handleSaveStaged}
                  className="flex-1 md:flex-none px-6 py-2 text-[10px] font-bold uppercase tracking-widest bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  Confirm & Sync
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[9px] font-bold uppercase opacity-50 tracking-tighter">Raw Fetched Context (Unfiltered)</label>
                <div className="h-48 md:h-64 overflow-y-auto border border-[#141414] p-3 font-mono text-[10px] bg-[#E4E3E0]/10 whitespace-pre-wrap opacity-60">
                  {stagedContent.raw}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-tighter flex justify-between">
                  <span>Optimized Logic (Editable)</span>
                  <span className="text-blue-600">Generated by Gemini</span>
                </label>
                <textarea 
                  value={stagedContent.clean}
                  onChange={(e) => setStagedContent({ ...stagedContent, clean: e.target.value })}
                  className="w-full h-48 md:h-64 border border-[#141414] p-3 font-mono text-[10px] outline-none focus:ring-1 focus:ring-[#141414]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-1">
        {filteredDocuments.map((doc) => (
          <div key={doc.id} className="group border border-[#141414] bg-white p-4 flex items-center justify-between hover:bg-[#141414] hover:text-white transition-all">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-[#E4E3E0]/30 rounded">
                <FileText size={20} className="group-hover:text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold uppercase tracking-tight text-sm">{doc.name}</h4>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 border border-[#141414] uppercase ${
                    doc.category === 'api' ? 'bg-orange-500 text-white border-orange-500' :
                    doc.category === 'functional' ? 'bg-blue-600 text-white border-blue-600' :
                    doc.category === 'technical' ? 'bg-purple-600 text-white border-purple-600' :
                    'bg-transparent text-black'
                  }`}>
                    {doc.category}
                  </span>
                </div>
                <p className="text-[10px] font-mono uppercase opacity-50 group-hover:opacity-100 italic">
                  {doc.content.length} characters of context
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => onSelectDocument(doc.id)}
                className="p-2 flex items-center gap-2 bg-[#E4E3E0]/30 hover:bg-white hover:text-black transition-colors font-bold uppercase tracking-widest text-[9px] border border-transparent hover:border-black"
              >
                <Eye size={14} />
                <span className="hidden sm:inline">VIEW_EDIT</span>
              </button>
              <button 
                onClick={() => handleDelete(doc.id)}
                className="p-2 text-black hover:text-red-500 transition-all opacity-30 hover:opacity-100"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {documents.length === 0 && (
          <div className="p-12 text-center border border-dashed border-[#141414]/20 font-mono text-[10px] uppercase opacity-40">
            [EMPTY_REPOSITORY] - NO DOCUMENT CONTEXT PROVIDED
          </div>
        )}
      </div>

      <div className="bg-[#141414]/5 p-4 flex gap-3 items-start">
        <Info size={16} className="mt-0.5 opacity-40" />
        <p className="text-[10px] leading-relaxed uppercase opacity-60">
          The RAG (Retrieval-Augmented Generation) flow uses these documents to ensure 
          the generated test cases align with your business logic. For best results, 
          upload technical requirements or API specifications.
        </p>
      </div>
    </div>
  );
}
