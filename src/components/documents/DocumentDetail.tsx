import { useState, useEffect } from 'react';
import * as React from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Document } from '../../types';
import { askDocumentQuestion } from '../../services/geminiService';
import { ArrowLeft, Save, MessageSquare, Send, Loader2, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DocumentDetailProps {
  document: Document;
  projectId: string;
  onBack: () => void;
}

export function DocumentDetail({ document, projectId, onBack }: DocumentDetailProps) {
  const [content, setContent] = useState(document.content);
  const [name, setName] = useState(document.name);
  const [category, setCategory] = useState(document.category || 'general');
  const [isSaving, setIsSaving] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  const [isChatExpanded, setIsChatExpanded] = useState(false);

  useEffect(() => {
    setContent(document.content);
    setName(document.name);
    setCategory(document.category || 'general');
  }, [document.id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'projects', projectId, 'documents', document.id), {
        content: content,
        name: name,
        category: category,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}/documents/${document.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReClean = async () => {
    if (!document.rawContent) return;
    setIsCleaning(true);
    try {
      const { cleanScrapedContent } = await import('../../services/geminiService');
      const freshClean = await cleanScrapedContent(document.rawContent);
      setContent(freshClean);
    } catch (error) {
      console.error(error);
      alert("Failed to re-process content.");
    } finally {
      setIsCleaning(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setIsAsking(true);
    const currentQ = question;
    setQuestion('');
    
    try {
      const answer = await askDocumentQuestion({
        question: currentQ,
        documentContent: content
      });
      setChat(prev => [...prev, { q: currentQ, a: answer }]);
    } catch (error) {
      console.error(error);
      alert("AI failed to answer. Context might be too large or invalid.");
    } finally {
      setIsAsking(false);
    }
  };

  const hasChanges = content !== document.content || name !== document.name || category !== document.category;

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] md:h-[calc(100vh-16rem)] gap-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[#141414] pb-4 px-1">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <button 
            onClick={onBack}
            className="p-2 border border-[#141414] hover:bg-[#141414] hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <input 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xl font-bold uppercase tracking-tight bg-transparent border-b border-transparent focus:border-[#141414] outline-none"
              placeholder="DOCUMENT_NAME"
            />
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[10px] font-mono opacity-50 uppercase">Knowledge_Base / {document.type} /</p>
              <select 
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="text-[10px] font-mono font-bold uppercase bg-transparent border-none outline-none text-orange-500 cursor-pointer"
              >
                <option value="general">GENERAL</option>
                <option value="api">API_SPEC</option>
                <option value="functional">FUNCTIONAL</option>
                <option value="technical">TECHNICAL</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
            {document.rawContent && (
                <button 
                onClick={handleReClean}
                disabled={isCleaning}
                title="Reset to AI Optimized Version"
                className="p-2 border border-[#141414] hover:bg-[#141414] hover:text-white transition-colors disabled:opacity-30 flex items-center gap-2 font-bold uppercase text-[9px] tracking-widest"
                >
                {isCleaning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                <span className="hidden sm:inline">RE_OPTIMIZE</span>
                </button>
            )}
            <button 
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="flex-1 md:flex-none bg-[#141414] text-white px-6 py-2 font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-green-600 transition-colors disabled:opacity-30"
            >
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {isSaving ? 'PERSISTING...' : 'SAVE_CHANGES'}
            </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 gap-4">
        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-h-0 border border-[#141414] bg-white">
            <div className="p-2 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-widest flex justify-between items-center">
                <span>{document.rawContent ? "Optimized_Context_Editor" : "Source_Code_Editor"}</span>
                <span className="opacity-50">{content.length} chars</span>
            </div>
            
            <div className="flex-1 flex flex-col min-h-0 bg-white">
              {document.rawContent && (
                <div className="border-b border-[#141414] bg-[#E4E3E0]/20 max-h-32 overflow-y-auto p-3 transition-all hover:max-h-64">
                   <h4 className="text-[9px] font-bold uppercase opacity-50 mb-2">Internal_Reference_Raw_Source</h4>
                   <pre className="font-mono text-[9px] whitespace-pre-wrap opacity-40 italic">{document.rawContent}</pre>
                </div>
              )}
              <textarea 
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 p-4 font-mono text-xs md:text-sm resize-none outline-none bg-transparent leading-relaxed"
                spellCheck={false}
              />
            </div>
        </div>

        {/* Chat / Q&A Area */}
        <div className={`
            flex flex-col border border-[#141414] bg-[#141414] text-white transition-all duration-300
            ${isChatExpanded ? 'fixed inset-4 z-50 md:relative md:inset-0 md:w-96' : 'h-64 md:h-auto md:w-80'}
        `}>
          <div className="p-3 border-b border-white/10 flex justify-between items-center">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                <MessageSquare size={14} />
                <span>Knowledge_Probe</span>
            </div>
            <button 
                onClick={() => setIsChatExpanded(!isChatExpanded)}
                className="p-1 hover:bg-white/10 rounded"
            >
                {isChatExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chat.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30 px-6">
                    <MessageSquare size={32} className="mb-4" />
                    <p className="text-[10px] font-mono uppercase leading-relaxed">
                        Query the document knowledge base using the Gemini engine.
                    </p>
                </div>
            )}
            {chat.map((item, idx) => (
              <div key={idx} className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex justify-end">
                    <div className="bg-white/10 p-2 max-w-[85%] text-xs font-mono uppercase tracking-tight border-l-2 border-orange-500">
                        {item.q}
                    </div>
                </div>
                <div className="flex justify-start">
                    <div className="p-2 max-w-[90%] text-xs leading-relaxed opacity-80 border-l border-white/30">
                        {item.a}
                    </div>
                </div>
              </div>
            ))}
            {isAsking && (
                <div className="flex items-center gap-2 opacity-50 font-mono text-[10px]">
                    <Loader2 size={12} className="animate-spin" />
                    <span>CALCULATING_RESPONSE...</span>
                </div>
            )}
          </div>

          <form onSubmit={handleAsk} className="p-3 border-t border-white/10 flex gap-2">
            <input 
              type="text"
              placeholder="ASK_CONTENT_QUERY_"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="flex-1 bg-white/5 border border-white/20 px-3 py-2 text-[10px] font-mono outline-none focus:border-white/50 transition-colors"
            />
            <button 
              type="submit"
              disabled={isAsking || !question.trim()}
              className="bg-white text-black p-2 hover:bg-orange-500 hover:text-white transition-colors disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
