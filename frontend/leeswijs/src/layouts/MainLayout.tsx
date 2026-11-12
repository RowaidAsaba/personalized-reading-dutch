import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  BookOpen,
  Layers,
  User,
  Menu,
  X,
  ChevronDown,
  Settings,
  LogOut,
} from "lucide-react";

import { useStore } from "../store";
import { easeOut } from "../constants/animation";

const NAV_ITEMS = [
  { to: "/home", label: "Dashboard", icon: Home },
  { to: "/reading", label: "Reading", icon: BookOpen },
  { to: "/flashcards", label: "Flashcards", icon: Layers },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = useStore((s) => s.user);
  const location = useLocation();
  const currentLabel = getPageLabel(location.pathname);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.onboarding_completed) return <Navigate to="/onboarding" replace />;

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          "fixed top-0 left-0 h-full w-60 bg-white border-r border-black/8 z-30",
          "flex flex-col py-6 px-3 gap-1",
          "transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0 lg:static lg:z-auto",
        ].join(" ")}
      >
        <div className="px-3 mb-6">
          <span className="font-heading text-2xl font-bold text-primary">Lees</span>
          <span className="font-heading text-2xl font-bold text-secondary">Wijs</span>
        </div>

        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-body font-semibold transition-colors",
                isActive
                  ? "border-primary/15 bg-primary/10 text-primary"
                  : "border-transparent text-text/60 hover:border-black/8 hover:bg-black/[0.03] hover:text-text",
              ].join(" ")
            }
          >
            <Icon size={18} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-black/8 flex items-center justify-between px-4 lg:px-6 shrink-0">
          <button
            className="lg:hidden p-1.5 rounded-lg text-text/60 hover:bg-black/5"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <div className="hidden lg:block">
            <p className="text-xs font-body font-semibold uppercase tracking-wide text-text/35">
              {currentLabel}
            </p>
          </div>

          <UserMenu cefrLevel={user.effectiveCefr ?? user.cefrLevel ?? "—"} name={user.name} />
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>

    </div>
  );
}

function getPageLabel(pathname: string): string {
  if (pathname.startsWith("/read/"))       return "Reading";
  if (pathname.startsWith("/settings"))    return "Settings";
  return NAV_ITEMS.find((item) => pathname.startsWith(item.to))?.label ?? "LeesWijs";
}

function UserMenu({ cefrLevel, name }: { cefrLevel: string; name: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const clearUser = useStore((s) => s.clearUser);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  function handleLogout() {
    setOpen(false);
    clearUser();
    navigate("/login", { replace: true });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-black/5 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="text-xs font-heading font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "var(--color-secondary)", color: "#fff" }}
        >
          {cefrLevel}
        </span>
        <span className="hidden max-w-28 truncate text-sm font-body text-text/80 sm:inline">
          {name}
        </span>
        <ChevronDown
          size={14}
          className={[
            "text-text/40 transition-transform",
            open ? "rotate-180" : "rotate-0",
          ].join(" ")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: easeOut }}
            role="menu"
            className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-white shadow-xl shadow-black/10 border border-black/6 overflow-hidden z-40"
          >
            <MenuItem
              icon={<User size={14} />}
              label="Profile"
              onClick={() => go("/profile")}
            />
            <MenuItem
              icon={<Settings size={14} />}
              label="Settings"
              onClick={() => go("/settings")}
            />
            <div className="h-px bg-black/6" />
            <MenuItem
              icon={<LogOut size={14} />}
              label="Log out"
              onClick={handleLogout}
              danger
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-body transition-colors",
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-text/80 hover:bg-black/[0.04]",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
