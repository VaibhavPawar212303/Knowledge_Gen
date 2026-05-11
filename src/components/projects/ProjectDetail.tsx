import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Project, TestCase, Document } from '../../types';
import { ArrowLeft, Plus, FilePlus, Zap, CheckCircle2, FlaskConical, Link2, Ghost, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentManager } from '../documents/DocumentManager';
import { TestCaseGenerator } from '../testcases/TestCaseGenerator';
import { DocumentDetail } from '../documents/DocumentDetail';

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

export function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeTab, setActiveTab] = useState<'cases' | 'docs' | 'gen'>('cases');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. PROJECT DATA
    const unsubProject = onSnapshot(doc(db, 'projects', projectId), (snap) => {
      if (snap.exists()) {
        setProject({ id: snap.id, ...snap.data() } as Project);
      }
    });

    // 2. TEST CASES
    const qCases = query(collection(db, 'projects', projectId, 'testcases'), orderBy('createdAt', 'desc'));
    const unsubCases = onSnapshot(qCases, (snap) => {
      setTestCases(snap.docs.map(d => ({ id: d.id, ...d.data() })) as TestCase[]);
      setLoading(false);
    });

    // 3. DOCUMENTS
    const qDocs = query(collection(db, 'projects', projectId, 'documents'), orderBy('createdAt', 'desc'));
    const unsubDocs = onSnapshot(qDocs, (snap) => {
      setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Document[]);
    });

    return () => {
      unsubProject();
      unsubCases();
      unsubDocs();
    };
  }, [projectId]);

  if (!project) return null;

  const selectedDocument = documents.find(d => d.id === selectedDocId);

  return (
    <div className="space-y-8">
      <AnimatePresence mode="wait">
        {selectedDocId && selectedDocument ? (
          <motion.div
            key="doc-detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <DocumentDetail 
              document={selectedDocument} 
              projectId={projectId}
              onBack={() => setSelectedDocId(null)}
            />
          </motion.div>
        ) : (
          <div className="space-y-8">
            <header className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex items-center gap-4">
                <button 
                  onClick={onBack}
                  className="p-2 border border-[#141414] hover:bg-[#141414] hover:text-white transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <h2 className="font-serif italic text-[10px] uppercase opacity-50 tracking-[0.2em] mb-1">Project ID: {projectId.slice(0, 8)}</h2>
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tighter uppercase">{project.name}</h1>
                </div>
              </div>
              
              <div className="md:ml-auto grid grid-cols-3 md:flex gap-px bg-[#141414] border border-[#141414] w-full md:w-auto">
                <TabButton 
                  active={activeTab === 'cases'} 
                  onClick={() => setActiveTab('cases')}
                  icon={<FlaskConical size={16} />}
                  label="Scenarios"
                />
                <TabButton 
                  active={activeTab === 'docs'} 
                  onClick={() => setActiveTab('docs')}
                  icon={<Link2 size={16} />}
                  label="Knowledge"
                />
                <TabButton 
                  active={activeTab === 'gen'} 
                  onClick={() => setActiveTab('gen')}
                  icon={<Zap size={16} />}
                  label="AI Gen"
                  variant="accent"
                />
              </div>
            </header>

            <AnimatePresence mode="wait">
              {activeTab === 'cases' && (
                <motion.div
                  key="cases"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex justify-between items-center px-1">
                    <h3 className="text-xs font-bold uppercase tracking-widest opacity-50">Active Scenarios ({testCases.length})</h3>
                  </div>
                  {testCases.length === 0 ? (
                    <EmptyState 
                      icon={<Ghost size={48} />}
                      title="NO TEST CASES FOUND"
                      description="YOUR RECENTLY INITIALIZED PROJECT HAS ZERO SCENARIOS. USE THE GENERATOR TO BEGIN."
                      action={() => setActiveTab('gen')}
                      actionLabel="GOTO_GENERATOR"
                    />
                  ) : (
                    <div className="border border-[#141414] bg-white divide-y divide-[#141414]">
                      {testCases.map((tc) => (
                        <div key={tc.id} className="p-4 md:p-6 hover:bg-[#E4E3E0]/10 transition-colors">
                          <div className="flex justify-between items-start mb-4 gap-4">
                            <div className="min-w-0">
                              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border border-[#141414] mb-2 inline-block ${
                                tc.status === 'active' ? 'bg-[#141414] text-white' : 'bg-transparent'
                              }`}>
                                {tc.status}
                              </span>
                              <h3 className="text-base md:text-lg font-bold uppercase tracking-tight truncate">{tc.title}</h3>
                              <p className="text-[10px] md:text-xs font-serif italic opacity-60 mt-1 line-clamp-2">{tc.flow}</p>
                            </div>
                            <CheckCircle2 size={24} className="opacity-10 shrink-0" />
                          </div>
                          
                          <div className="space-y-2 mt-4 pl-4 border-l-2 border-[#141414]/10">
                            {tc.steps.map((step, idx) => (
                              <div key={idx} className="flex gap-3 items-start text-[10px] md:text-xs font-mono">
                                <span className="opacity-40">{ (idx + 1).toString().padStart(2, '0') }</span>
                                <span>{step}</span>
                              </div>
                            ))}
                          </div>
                          {tc.expectedResult && (
                            <div className="mt-4 p-3 bg-[#141414] text-white text-[10px] uppercase font-bold tracking-widest flex items-center justify-between gap-4">
                              <span className="truncate">Expected Result: {tc.expectedResult}</span>
                              <CheckCircle2 size={12} className="shrink-0" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'docs' && (
                <motion.div
                  key="docs"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <DocumentManager 
                    projectId={projectId} 
                    documents={documents} 
                    onSelectDocument={setSelectedDocId}
                  />
                </motion.div>
              )}

              {activeTab === 'gen' && (
                <motion.div
                  key="gen"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <TestCaseGenerator 
                    projectId={projectId} 
                    documents={documents}
                    onSuccess={() => setActiveTab('cases')}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count, variant = 'default' }: any) {
  return (
    <button
      onClick={onClick}
      className={`
        px-6 py-3 flex items-center gap-2 transition-all font-bold uppercase tracking-widest text-[10px]
        ${active 
          ? (variant === 'accent' ? 'bg-orange-500 text-white' : 'bg-[#E4E3E0] text-[#141414]') 
          : 'bg-white text-[#141414] hover:bg-[#E4E3E0]/50'
        }
      `}
    >
      {icon}
      {label}
      {count !== undefined && <span className="opacity-50 ml-1">({count})</span>}
    </button>
  );
}

function EmptyState({ icon, title, description, action, actionLabel }: any) {
  return (
    <div className="border-2 border-dashed border-[#141414]/20 p-20 flex flex-col items-center text-center opacity-70">
      <div className="mb-6 opacity-20">{icon}</div>
      <h3 className="text-xl font-bold uppercase tracking-tighter mb-2">{title}</h3>
      <p className="max-w-md text-xs font-mono uppercase leading-relaxed mb-8">{description}</p>
      {action && (
        <button 
          onClick={action}
          className="px-8 py-3 bg-[#141414] text-white font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-orange-600 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
