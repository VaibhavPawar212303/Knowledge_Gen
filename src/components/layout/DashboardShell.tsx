import React, { useState } from 'react';
import { User, LogOut, LayoutDashboard, TestTube2, FileText, Settings, Menu, X } from 'lucide-react';

interface DashboardShellProps {
  user: any;
  onSignOut: () => void;
  children: React.ReactNode;
}

export function DashboardShell({ user, onSignOut, children }: DashboardShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex font-sans text-[#141414]">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-[#141414] flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <TestTube2 size={20} />
          <span className="font-bold tracking-tighter uppercase">GenTest</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 border border-[#141414]"
        >
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar - Overlay for Mobile */}
      {isMobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-40" 
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed h-full z-50 transition-transform duration-300 ease-in-out lg:translate-x-0 w-64 border-r border-[#141414] bg-white flex flex-col
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-bottom border-[#141414] hidden lg:flex items-center gap-2">
          <TestTube2 size={24} />
          <span className="font-bold tracking-tighter text-lg uppercase">GenTest</span>
        </div>
        
        <nav className="flex-1 p-4 flex flex-col gap-1 mt-16 lg:mt-0">
          <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active onClick={() => setIsMobileMenuOpen(false)} />
          <NavItem icon={<FileText size={18} />} label="Documents" onClick={() => setIsMobileMenuOpen(false)} />
          <NavItem icon={<Settings size={18} />} label="Settings" onClick={() => setIsMobileMenuOpen(false)} />
        </nav>

        <div className="p-4 mt-auto border-t border-[#141414]">
          <div className="flex items-center gap-3 mb-4 p-2 bg-[#E4E3E0]/30 rounded">
            <div className="w-8 h-8 rounded-full bg-[#141414] text-white flex items-center justify-center text-xs font-bold ring-1 ring-offset-2 ring-[#141414]">
              {user.displayName?.charAt(0) || user.email?.charAt(0)}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold truncate">{user.displayName || 'Developer'}</span>
              <span className="text-[10px] opacity-50 truncate">{user.email}</span>
            </div>
          </div>
          <button 
            onClick={onSignOut}
            className="w-full flex items-center gap-2 p-2 hover:bg-black hover:text-white transition-all text-xs font-bold uppercase tracking-widest cursor-pointer"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 p-4 md:p-8 pt-20 lg:pt-8 min-h-screen box-border">
        <div className="max-w-6xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`
      flex items-center gap-3 p-3 text-sm font-bold uppercase tracking-wider cursor-pointer border
      ${active ? 'bg-[#141414] text-white border-[#141414]' : 'border-transparent hover:border-[#141414]'}
      transition-all
    `}>
      {icon}
      {label}
    </div>
  );
}
