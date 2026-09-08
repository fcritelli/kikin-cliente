import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  api,
  ApiError,
  type ClientCandidate,
  type EstablishmentLink,
  type FutureAppointment,
  type SalonInfo,
} from "@/lib/api";

/**
 * Área do cliente (Fase 1 · Vínculo): se a conta ainda não tem vínculo com um
 * estabelecimento, roda o claim (ADR-001) — escolher salão + telefone → candidatos
 * mascarados → "sou eu". Depois mostra os próximos agendamentos do vínculo.
 */
export function AccountPage() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [links, setLinks] = useState<EstablishmentLink[]>([]);
  const [appointments, setAppointments] = useState<FutureAppointment[]>([]);

  // ---- claim
  const [salons, setSalons] = useState<SalonInfo[]>([]);
  const [salonId, setSalonId] = useState("");
  const [phone, setPhone] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linkRes, apptRes] = await Promise.all([api.myLinks(), api.myAppointments()]);
      setLinks(linkRes.links);
      setAppointments(apptRes.appointments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao carregar sua área.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startClaim = async () => {
    if (!salonId) return setError("Escolha o estabelecimento.");
    if (!phone || phone.replace(/\D/g, "").length < 10)
      return setError("Informe um telefone com DDD válido.");
    setError(null);
    setClaiming(true);
    setCandidates(null);
    setClaimMessage(null);
    try {
      const res = await api.claimClients({ salonId, phone });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setClaimMessage("Nenhum cadastro encontrado com este telefone neste estabelecimento.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao buscar seus agendamentos.");
    } finally {
      setClaiming(false);
    }
  };

  const confirmCandidate = async (candidate: ClientCandidate) => {
    setError(null);
    setClaiming(true);
    try {
      await api.confirmLink({ salonId, phone, clientId: candidate.clientId });
      setCandidates(null);
      setPhone("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao confirmar o vínculo.");
    } finally {
      setClaiming(false);
    }
  };

  // Carrega os salões disponíveis apenas quando a conta ainda não tem vínculo
  useEffect(() => {
    if (loading || links.length > 0) return;
    api
      .linkSalons()
      .then((res) => {
        setSalons(res.salons);
        if (res.salons.length === 1) setSalonId(res.salons[0].id);
      })
      .catch(() => setSalons([]));
  }, [loading, links.length]);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
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

      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-10">
        {/* Cabeçalho da conta */}
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

        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wider">
          <span className="rounded-full border border-green-600/30 bg-green-600/10 px-3 py-1 text-green-700">
            {account?.emailVerified ? "E-mail verificado" : "E-mail não verificado"}
          </span>
          {links.length > 0 && (
            <span className="rounded-full border border-blue-600/30 bg-blue-600/10 px-3 py-1 text-blue-700">
              {links.length} {links.length === 1 ? "estabelecimento vinculado" : "estabelecimentos vinculados"}
            </span>
          )}
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-sm text-black/50">Carregando…</p>
        ) : links.length === 0 ? (
          /* ---- Primeiro acesso: vínculo (claim) ---- */
          <section className="mt-8 rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.1)]">
            <h2 className="text-lg font-black uppercase tracking-tight">Encontre seus agendamentos</h2>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              Já tem horário marcado num estabelecimento? Informe o telefone usado na reserva para
              vincular sua conta — seus agendamentos aparecerão aqui. Seu telefone fica protegido
              (LGPD): só uma versão criptografada é usada na busca.
            </p>

            <div className="mt-6 grid gap-4">
              <div>
                <Label htmlFor="claim-salon">Estabelecimento</Label>
                <select
                  id="claim-salon"
                  value={salonId}
                  onChange={(e) => setSalonId(e.target.value)}
                  className="w-full h-11 rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                >
                  <option value="">Selecione…</option>
                  {salons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {salons.length === 0 && (
                  <p className="mt-1.5 text-xs text-black/50">
                    Nenhum estabelecimento disponível para vínculo neste ambiente.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="claim-phone">Telefone usado na reserva</Label>
                <Input
                  id="claim-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 98765-4321"
                />
              </div>
              <Button type="button" onClick={startClaim} disabled={claiming} className="w-full">
                {claiming ? "Buscando…" : "Encontrar meus agendamentos"}
              </Button>
            </div>

            {claimMessage && (
              <p className="mt-5 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-black/70">
                {claimMessage}
              </p>
            )}

            {candidates && candidates.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/50">
                  Encontramos {candidates.length === 1 ? "1 cadastro" : `${candidates.length} cadastros`} — é você?
                </p>
                <div className="mt-3 grid gap-2.5">
                  {candidates.map((c) => (
                    <div
                      key={c.clientId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-bold">{c.name}</p>
                        <p className="text-xs text-black/50">{c.phoneMask}</p>
                      </div>
                      <Button type="button" size="sm" onClick={() => confirmCandidate(c)} disabled={claiming}>
                        Sou eu — vincular
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          /* ---- Vinculado: próximos agendamentos ---- */
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-black uppercase tracking-tight">Meus próximos horários</h2>
              {links[0]?.salonName && (
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">
                  {links.map((l) => l.salonName).filter(Boolean).join(" · ")}
                </p>
              )}
            </div>

            {appointments.length === 0 ? (
              <div className="mt-5 rounded-xl border border-black/10 bg-black/[0.02] px-5 py-6 text-center">
                <p className="text-sm font-bold text-black/70">Nenhum horário futuro por aqui.</p>
                <p className="mt-1 text-xs text-black/50">
                  Quando você agendar no estabelecimento vinculado, ele aparecerá nesta lista.
                </p>
              </div>
            ) : (
              <ul className="mt-5 grid gap-3">
                {appointments.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-5 py-4"
                  >
                    <div>
                      <p className="text-sm font-black uppercase tracking-tight">{a.serviceName || "Atendimento"}</p>
                      <p className="mt-0.5 text-xs text-black/50">
                        {a.staffName ? `${a.staffName} · ` : ""}
                        {a.salonName}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-blue-700">{fmtDate(a.startAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
