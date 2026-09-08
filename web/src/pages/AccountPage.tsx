import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";

/**
 * Área do cliente pós-login (Fase 1): confirma a sessão e mostra a conta.
 * A agenda em si chega nas próximas fases do MVP.
 */
export function AccountPage() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-white text-black">
      {/* NAV */}
      <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-black/10">
        <a href="/" className="flex items-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-6 w-6 object-contain" />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-70">cliente</span>
          </span>
        </a>
        <nav className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Sair
          </Button>
        </nav>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)]">
          <div className="flex items-center gap-4">
            {account?.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-14 w-14 rounded-full object-cover border border-black/10"
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-black uppercase">
                {(account?.fullName || "?").slice(0, 1)}
              </div>
            )}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-black/40">Sua conta</p>
              <h1 className="text-xl font-black uppercase tracking-tight">{account?.fullName}</h1>
              <p className="text-sm text-black/60">{account?.email}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wider">
            <span className="rounded-full border border-green-600/30 bg-green-600/10 px-3 py-1 text-green-700">
              {account?.emailVerified ? "E-mail verificado" : "E-mail não verificado"}
            </span>
            <span className="rounded-full border border-black/15 bg-black/5 px-3 py-1 text-black/60">
              {account?.authProvider === "google"
                ? "Entrando com Google"
                : account?.authProvider === "microsoft"
                  ? "Entrando com Microsoft"
                  : "Conta e-mail + senha"}
            </span>
          </div>

          <div className="mt-8 rounded-xl border border-blue-600/20 bg-blue-50 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Sua agenda, em breve</p>
            <p className="mt-1.5 text-sm leading-relaxed text-blue-900/70">
              O agendamento no salão chega nas próximas fases do portal. Quando seu salão ativar
              o vínculo, seus horários aparecerão aqui.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
