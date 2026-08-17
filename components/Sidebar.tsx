"use client";

import { Activity, Users, FileText, LayoutDashboard, Banknote, X, Briefcase, Bell, Wallet, Dumbbell, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
  notificationsCount?: number;
}

export function Sidebar({ isOpen, onClose, isMobile, notificationsCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Notifications", href: "/notifications", icon: Bell },
    { name: "Admissions", href: "/admissions", icon: Users },
    { name: "Manage Trainers", href: "/manage-trainers", icon: Briefcase },
    { name: "Members & Payments", href: "/members&payments", icon: Users },
    { name: "Financial Ledger", href: "/ledger", icon: Wallet },
    { name: "Reporting", href: "/reporting", icon: FileText },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  const sidebarClasses = isMobile
    ? `fixed inset-y-0 right-0 z-50 w-64 bg-card border-l border-border transform transition-transform duration-300 ease-in-out ${isOpen ? "translate-x-0" : "translate-x-full"}`
    : "w-64 border-l border-border bg-card text-card-foreground min-h-screen flex flex-col hidden md:flex sticky top-0 h-screen";

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden" 
          onClick={onClose}
        />
      )}

      <aside className={sidebarClasses}>
        <div className="px-6 py-6 border-b border-border flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="bg-yellow-500 p-1.5 rounded-lg rotate-12 shadow-[0_0_15px_rgba(234,179,8,0.3)]">
              <Dumbbell className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-2xl font-[1000] tracking-tighter italic leading-none">
              <span className="text-white">WORK</span><span className="text-yellow-500">OUT</span>
              <span className="text-yellow-500 text-[10px] block font-bold tracking-wider mt-1 not-italic">CHAPTER 1</span>
            </h1>
          </div>
          <p className="text-[8px] font-black uppercase tracking-[0.35em] text-yellow-500/60">Management Console</p>
          {isMobile && (
            <button onClick={onClose} className="p-1 hover:bg-secondary rounded-md text-muted-foreground">
              <X className="w-6 h-6" />
            </button>
          )}
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              onClick={isMobile ? onClose : undefined}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                pathname === item.href
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
              }`}
            >
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <item.icon className="w-5 h-5" />
                <span className="font-medium text-sm truncate">{item.name}</span>
              </div>
              {item.href === "/notifications" && notificationsCount > 0 && (
                <span className="ml-2 inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5">
                  {notificationsCount > 99 ? "99+" : notificationsCount}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border mt-auto space-y-4">
          <button 
            onClick={() => {
              sessionStorage.removeItem("iron_ledger_auth_v2");
              window.location.reload();
            }}
            className="w-full py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
          >
            Logout Admin
          </button>
          <p className="text-xs text-muted-foreground text-center">WORKOUT v1.0</p>
        </div>
      </aside>
    </>
  );
}
