import { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { generateTestCases } from '../../services/geminiService';
import { Document, TestCase } from '../../types';
import { Sparkles, Loader2, ListChecks, ArrowRight, BrainCircuit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TestCaseGeneratorProps {
  projectId: string;
  documents: Document[];
  onSuccess: () => void;
}

export function TestCaseGenerator({ projectId, documents, onSuccess }: TestCaseGeneratorProps) {
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(documents.map(d => d.id));
  const [previewCases, setPreviewCases] = useState<any[]>([]);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsGenerating(true);

    try {
      const context = documents
        .filter(d => selectedDocIds.includes(d.id))
        .map(d => `Document (${d.category || 'general'}): ${d.name}\n${d.content}`);

      const results = await generateTestCases({
        flowDescription: description,
        contextDocs: context,
      });

      setPreviewCases(results);
    } catch (error) {
      console.error(error);
      alert("Generation failed. Check console for details.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!auth.currentUser) return;
    try {
      const promises = previewCases.map(tc => 
        addDoc(collection(db, 'projects', projectId, 'testcases'), {
          ...tc,
          projectId,
          authorId: auth.currentUser!.uid,
          createdAt: serverTimestamp()
        })
      );
      await Promise.all(promises);
      onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'testcases');
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-20">
      <div className="flex items-center gap-4 border-b border-[#141414] pb-6">
        <div className="p-3 bg-[#141414] text-white shrink-0">
          <BrainCircuit size={24} className="md:w-8 md:h-8" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl md:text-2xl font-bold uppercase tracking-tight truncate">AI Test Architect</h3>
          <p className="text-[9px] md:text-[10px] font-mono opacity-50 uppercase tracking-widest mt-1">
            GEMINI ENGINE_ RAG PIPELINE ACTIVE_
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-50">Describe User Flow</label>
            <textarea
              className="w-full h-32 md:h-40 bg-white border border-[#141414] p-4 text-[11px] md:text-sm font-mono focus:ring-1 focus:ring-[#141414] outline-none"
              placeholder="E.G. USER ADDS PRODUCT TO CART, CLICKS CHECKOUT, ENTERS SHIPMENT DETAILS, AND OBSERVES SUCCESSFUL ORDER REDIRECT_"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="bg-[#141414] p-4 md:p-6 text-white space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="text-[10px] font-bold uppercase tracking-widest">Active Context</h4>
              <span className="text-[10px] opacity-50 font-mono italic">{selectedDocIds.length} SELECTED</span>
            </div>
            <div className="space-y-4">
              {['api', 'functional', 'technical', 'general'].map(cat => {
                const catDocs = documents.filter(d => d.category === cat);
                if (catDocs.length === 0) return null;
                return (
                  <div key={cat} className="space-y-2">
                    <h5 className="text-[8px] font-bold uppercase opacity-30 tracking-widest">{cat}_docs</h5>
                    <div className="flex flex-wrap gap-1.5 md:gap-2">
                      {catDocs.map(doc => (
                        <button
                          key={doc.id}
                          onClick={() => setSelectedDocIds(prev => 
                            prev.includes(doc.id) ? prev.filter(id => id !== doc.id) : [...prev, doc.id]
                          )}
                          className={`px-2 py-1 md:px-3 md:py-1 text-[9px] md:text-[10px] border transition-all uppercase font-bold shrink-0 ${
                            selectedDocIds.includes(doc.id) ? 'bg-white text-black border-white' : 'border-white/30 text-white/50 hover:border-white'
                          }`}
                        >
                          {doc.name.length > 20 ? doc.name.slice(0, 17) + '...' : doc.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {documents.length === 0 && <span className="text-[10px] opacity-30 italic">NO DOCUMENTS IN PROJECT REPO</span>}
            </div>
          </div>

          <button
            disabled={isGenerating}
            onClick={handleGenerate}
            className={`
              w-full py-4 md:py-5 flex items-center justify-center gap-3 transition-all font-bold uppercase tracking-[0.3em] text-xs md:text-sm
              ${isGenerating ? 'bg-[#E4E3E0] text-[#141414]' : 'bg-[#141414] text-white hover:bg-orange-600'}
            `}
          >
            {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
            {isGenerating ? 'ANALYZING_FLOW' : 'EXECUTE_GENERATION'}
          </button>
        </div>

        <div className="hidden lg:block space-y-4">
          <div className="border border-[#141414] bg-white p-4">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] border-b border-[#141414] pb-2 mb-4">Pipeline Stats</h4>
            <div className="space-y-4 font-mono text-[10px] uppercase">
              <div className="flex justify-between"><span>Model:</span> <span>gemini-3-flash</span></div>
              <div className="flex justify-between"><span>Latency:</span> <span>~2.4s</span></div>
              <div className="flex justify-between"><span>Context:</span> <span>{selectedDocIds.length} docs</span></div>
              <div className="flex justify-between"><span>Token Est:</span> <span>~1.2k</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Section */}
      <AnimatePresence>
        {previewCases.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 pt-10"
          >
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b-2 border-[#141414] pb-4 gap-4">
              <h3 className="text-xl md:text-2xl font-bold uppercase tracking-tight flex items-center gap-2">
                <ListChecks /> OUTPUT
              </h3>
              <button 
                onClick={handleSave}
                className="w-full sm:w-auto bg-green-600 text-white px-6 py-3 md:px-8 md:py-3 font-bold uppercase tracking-widest text-[10px] md:text-xs flex items-center justify-center gap-2 hover:bg-green-700"
              >
                COMMIT_RECORDS <ArrowRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {previewCases.map((tc, idx) => (
                <div key={idx} className="border border-[#141414] bg-white p-4 md:p-6 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <span className="text-4xl md:text-6xl font-bold">{(idx + 1).toString().padStart(2, '0')}</span>
                  </div>
                  <h4 className="text-base md:text-lg font-bold uppercase mb-2 pr-12">{tc.title}</h4>
                  <div className="space-y-2 mb-4">
                    {tc.steps.map((step: string, sIdx: number) => (
                      <div key={sIdx} className="text-[10px] md:text-xs font-mono flex gap-2">
                        <span className="opacity-30 shrink-0">[{sIdx + 1}]</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[9px] md:text-[10px] font-bold uppercase p-2 bg-[#E4E3E0] inline-block tracking-widest leading-none">
                    Expect: {tc.expectedResult}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
