import { useEffect, useState } from 'react';
import { auth, signInWithGoogle, testConnection } from './lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { DashboardShell } from './components/layout/DashboardShell';
import { ProjectList } from './components/projects/ProjectList';
import { ProjectDetail } from './components/projects/ProjectDetail';
import { LogIn, TestTube2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("Auth State Changed:", user ? `UID: ${user.uid}` : "Logged Out");
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center font-mono text-sm">
        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            <TestTube2 size={32} className="text-[#141414]" />
          </motion.div>
          <span className="animate-pulse">INITIALIZING SYSTEM...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-6 font-mono">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full border border-[#141414] bg-white p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]"
        >
          <div className="flex items-center gap-3 mb-8">
            <TestTube2 size={40} className="text-[#141414]" />
            <h1 className="text-2xl font-bold tracking-tighter">GenTest AI</h1>
          </div>
          
          <p className="text-sm mb-8 leading-relaxed opacity-70">
            RAG-powered test case generation platform. 
            Connect your technical docs and generate industry-standard test flows using Gemini.
          </p>

          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-2 bg-[#141414] text-white py-3 px-4 hover:bg-[#2a2a2a] transition-colors font-bold uppercase tracking-widest text-xs"
          >
            <LogIn size={16} />
            Authenticate with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <DashboardShell user={user} onSignOut={() => signOut(auth)}>
      <AnimatePresence mode="wait">
        {!activeProjectId ? (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ProjectList onSelectProject={setActiveProjectId} />
          </motion.div>
        ) : (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ProjectDetail 
              projectId={activeProjectId} 
              onBack={() => setActiveProjectId(null)} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardShell>
  );
}
