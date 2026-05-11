import { useState, useEffect } from 'react';
import * as React from 'react';
import { collection, onSnapshot, query, where, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Project } from '../../types';
import { Plus, Folder, Calendar, ArrowRight, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ProjectListProps {
  onSelectProject: (id: string) => void;
}

export function ProjectList({ onSelectProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    console.log("Fetching projects for user:", auth.currentUser.uid);

    const q = query(
      collection(db, 'projects'),
      where('ownerId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
      console.log("Projects loaded:", projs.length);
      setProjects(projs);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error("Firestore Snapshot Error:", err);
      setError(err.message);
      setLoading(false);
      // Don't throw here to prevent component crash, just capture in state
      try {
        handleFirestoreError(err, OperationType.LIST, 'projects');
      } catch (e) {
        // Logged but not re-thrown to UI thread
      }
    });

    return () => unsubscribe();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !auth.currentUser) return;

    try {
      await addDoc(collection(db, 'projects'), {
        name: newName,
        description: 'New testing project',
        ownerId: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
      setNewName('');
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
        <div>
          <h2 className="font-serif italic text-[10px] uppercase opacity-50 tracking-[0.2em] mb-1">Workspace</h2>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tighter uppercase">Available Projects</h1>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="w-full sm:w-auto bg-[#141414] text-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] hover:shadow-none translate-y-0 active:translate-y-[4px] active:translate-x-[4px] transition-all flex items-center justify-center gap-2"
        >
          <Plus size={24} />
          <span className="sm:hidden font-bold uppercase tracking-widest text-xs">New Project</span>
        </button>
      </header>

      {isAdding && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="border-2 border-[#141414] bg-white p-6 overflow-hidden"
        >
          <form onSubmit={handleCreateProject} className="flex flex-col sm:flex-row gap-4">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="PROJECT NAME_ (E.G. MOBILE APP V2)"
              className="flex-1 bg-transparent border-b-2 border-[#141414] outline-none font-mono text-sm p-2 uppercase"
            />
            <button 
              type="submit"
              className="bg-[#141414] text-white px-8 py-3 sm:py-2 font-bold uppercase tracking-widest text-xs"
            >
              Initialize
            </button>
          </form>
        </motion.div>
      )}

      <div className="border-t border-[#141414]">
        {/* Table Header - Desktop Only */}
        <div className="hidden md:grid grid-cols-[40px_1.5fr_1fr_1fr_60px] p-4 text-[10px] font-serif italic uppercase tracking-widest opacity-40">
          <span>#</span>
          <span>Project Name</span>
          <span>Created At</span>
          <span>Documents</span>
          <span></span>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center border-b border-[#141414]">
            <Loader2 className="animate-spin opacity-20" size={24} />
          </div>
        ) : error ? (
          <div className="p-12 border-b border-[#141414] bg-red-50">
            <h3 className="font-bold text-red-600 uppercase text-xs mb-2">ACCESS_ERROR_SYSTEM_FAILURE</h3>
            <p className="font-mono text-[10px] text-red-500 uppercase leading-relaxed">
              {error}
            </p>
            {error.includes('index') && (
              <p className="mt-4 font-mono text-[10px] text-[#141414] opacity-50 uppercase">
                Note: This query requires a Firestore index. If you just deployed, wait 1-2 minutes for the cloud to propagate.
              </p>
            )}
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 text-center border-b border-[#141414] font-mono text-xs opacity-50 uppercase tracking-widest">
            _NO PROJECTS FOUND_INITIALIZE ONE TO PROCEED_
          </div>
        ) : (
          projects.map((project, index) => (
            <motion.div
              layout
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              className="flex flex-col md:grid md:grid-cols-[40px_1.5fr_1fr_1fr_60px] items-start md:items-center p-4 md:p-4 border-b border-[#141414] hover:bg-[#141414] hover:text-white transition-all cursor-pointer group gap-4 md:gap-0"
            >
              <span className="hidden md:block font-mono text-xs opacity-50 group-hover:opacity-100">
                {(index + 1).toString().padStart(2, '0')}
              </span>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <Folder size={16} />
                <span className="font-bold uppercase tracking-tight text-sm md:text-base truncate">{project.name}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px] opacity-70 group-hover:opacity-100 uppercase">
                <Calendar size={12} className="shrink-0" />
                <span className="md:hidden opacity-50">Created on:</span>
                {project.createdAt?.toDate ? project.createdAt.toDate().toLocaleDateString() : 'Pending...'}
              </div>
              <div className="text-[10px] uppercase font-bold opacity-50 group-hover:opacity-100">
                Contextual Storage
              </div>
              <div className="hidden md:flex justify-end opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 transition-all">
                <ArrowRight size={18} />
              </div>
              <div className="md:hidden w-full text-right">
                <span className="text-[10px] font-bold uppercase tracking-widest bg-[#141414] text-white px-3 py-1 group-hover:bg-white group-hover:text-[#141414] transition-colors">Open Project</span>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
