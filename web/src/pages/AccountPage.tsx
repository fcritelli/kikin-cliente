import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BookingModal } from "@/components/BookingModal";
import {
  api,
  ApiError,
  type BookingSalonMeta,
  type BookingSlot,
  type ClientCandidate,
  type EstablishmentLink,
  type FutureAppointment,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { DateCalendar } from "@/components/ui/DateCalendar";

type Tab = "dashboard" | "consultas" | "estabelecimentos" | "perfil";

type ActionModal =
  | { kind: "cancel"; appointment: FutureAppointment }
  | { kind: "intent"; appointment: FutureAppointment; group: FutureAppointment[]; servicesLabel: string; totalMin: number }
  | { kind: "slots"; appointment: FutureAppointment; group: FutureAppointment[]; servicesLabel: string };

function waLinkFor(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (!/^55\d{10,13}$/.test(d)) {
    if (d.length === 10 || d.length === 11) d = "55" + d;
  }
  return d && d.length >= 12 ? `https://wa.me/${d}` : null;
}


const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

const fmtDateLong = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

const STATUS_META: Record<string, { label: string; cls: string }> = {
  confirmado: { label: "Confirmado", cls: "bg-green-600/10 text-green-700 border-green-600/30" },
  pending_confirmation: { label: "Pendente de confirmação", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  cancelado: { label: "Cancelado", cls: "bg-red-600/10 text-red-700 border-red-600/30" },
  canceled: { label: "Cancelado", cls: "bg-red-600/10 text-red-700 border-red-600/30" },
  falta: { label: "Não compareceu", cls: "bg-red-600/10 text-red-700 border-red-600/30" },
  no_show: { label: "Não compareceu", cls: "bg-red-600/10 text-red-700 border-red-600/30" },
};

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "◈" },
  { id: "consultas", label: "Consultas", icon: "✚" },
  { id: "estabelecimentos", label: "Estabelecimentos", icon: "🏢" },
  { id: "perfil", label: "Perfil", icon: "⚙" },
];

/**
 * Área do cliente com navegação lateral:
 * Dashboard · Consultas (próximas + histórico) · Estabelecimentos (vínculos) · Perfil.
 * O agendamento acontece aqui dentro (portal único método).
 */
export function AccountPage() {
  const { account, logout, reloadAccount } = useAuth();

  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [links, setLinks] = useState<EstablishmentLink[]>([]);
  const [appointments, setAppointments] = useState<FutureAppointment[]>([]);
  const [history, setHistory] = useState<FutureAppointment[] | null>(null);

  // claim
  const [phone, setPhone] = useState("");
  const [claimOptIn, setClaimOptIn] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null);
  const [showClaim, setShowClaim] = useState(false);

  // agendar
  const [salons, setSalons] = useState<BookingSalonMeta[] | null>(null);
  const [picker, setPicker] = useState<null | "linked" | "all">(null);
  const [booking, setBooking] = useState<BookingSalonMeta | null>(null);

  // perfil
  const [nameDraft, setNameDraft] = useState("");
  const [waDraft, setWaDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editingWa, setEditingWa] = useState(false);
  const [busy, setBusy] = useState(false);

  // cancelar/remarcar
  const [modal, setModal] = useState<ActionModal | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [slotDate, setSlotDate] = useState("");
  const [slotTime, setSlotTime] = useState("");
  const [slots, setSlots] = useState<BookingSlot[]>([]);

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

  useEffect(() => {
    if (account) {
      setNameDraft(account.fullName || "");
      if (account.whatsappMask) setWaDraft("");
    }
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureSalons = useCallback(async (): Promise<BookingSalonMeta[]> => {
    if (salons) return salons;
    try {
      const res = await api.bookingSalons();
      setSalons(res.salons);
      return res.salons;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao carregar estabelecimentos.");
      return [];
    }
  }, [salons]);

  const linkedMetas = useMemo(() => {
    const metas: BookingSalonMeta[] = [];
    for (const l of links) {
      const m = (salons || []).find((s) => s.id === l.salonId);
      if (m) metas.push(m);
    }
    return metas;
  }, [links, salons]);

  const loadHistory = async () => {
    if (history) return;
    try {
      const res = await api.myAppointmentsHistory();
      setHistory(res.appointments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao carregar histórico.");
    }
  };

  // ---- claim
  const startClaim = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) return setError("Informe um WhatsApp com DDD válido.");
    setError(null);
    setMessage(null);
    setClaiming(true);
    setCandidates(null);
    try {
      const res = await api.claimClients({ phone });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setMessage("Nenhum cadastro encontrado com este WhatsApp. Se for sua primeira vez, use 'Agendar agora'.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao buscar seus cadastros.");
    } finally {
      setClaiming(false);
    }
  };

  const confirmCandidate = async (candidate: ClientCandidate) => {
    setError(null);
    setClaiming(true);
    try {
      await api.confirmLink({ salonId: candidate.salonId, phone, clientId: candidate.clientId, whatsappOptIn: claimOptIn });
      setCandidates(null);
      setPhone("");
      setShowClaim(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao confirmar o vínculo.");
    } finally {
      setClaiming(false);
    }
  };

  // ---- agendar
  const openAgendar = async () => {
    const list = await ensureSalons();
    const linkedIds = new Set(links.map((l) => l.salonId));
    const linked = list.filter((s) => linkedIds.has(s.id));
    if (linked.length === 1) setBooking(linked[0]);
    else if (linked.length > 1) setPicker("linked");
    else {
      // sem vínculo: nada de listar outros salões — orienta a recuperar o cadastro
      setMessage("Para agendar, primeiro vincule seu cadastro: recupere pelo WhatsApp usado no estabelecimento.");
      setShowClaim(true);
      setTab("estabelecimentos");
    }
  };

  const handleBooked = async (salon: BookingSalonMeta, phoneDigits: string, whatsappOptIn: boolean) => {
    if (!links.some((l) => l.salonId === salon.id)) {
      try {
        await api.autoLink({ salonId: salon.id, phone: phoneDigits, whatsappOptIn });
      } catch {
        /* vínculo via claim se falhar */
      }
    }
    setBooking(null);
    setMessage("Horário confirmado! Ele já aparece em Consultas.");
    await refresh();
  };

  // ---- perfil
  const saveName = async () => {
    if (nameDraft.trim().length < 2) return setError("Informe seu nome.");
    setBusy(true);
    setError(null);
    try {
      await api.updateProfile(nameDraft.trim());
      await reloadAccount();
      setEditingName(false);
      setMessage("Nome atualizado.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao salvar nome.");
    } finally {
      setBusy(false);
    }
  };

  const saveWhatsapp = async () => {
    if (!waDraft || waDraft.replace(/\D/g, "").length < 10) return setError("Informe um WhatsApp com DDD válido.");
    setBusy(true);
    setError(null);
    try {
      await api.updateWhatsapp(waDraft);
      await reloadAccount();
      setWaDraft("");
      setEditingWa(false);
      setMessage("WhatsApp atualizado. Lembretes passarão a usar este número nos estabelecimentos com opt-in ativo.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao salvar WhatsApp.");
    } finally {
      setBusy(false);
    }
  };

  const toggleOptin = async (link: EstablishmentLink, optin: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.setWhatsappOptin({ salonId: link.salonId, optin });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao atualizar consentimento.");
    } finally {
      setBusy(false);
    }
  };

  // ---- ações de agendamento
  const groupOf = (appointment: FutureAppointment): FutureAppointment[] => {
    const key = appointment.groupId || appointment.id;
    return appointments.filter((a) => a.salonId === appointment.salonId && (a.groupId || a.id) === key);
  };

  const askCancel = (appointment: FutureAppointment) => {
    void ensureSalons();
    setModalError(null);
    setModal({ kind: "cancel", appointment });
  };

  const confirmCancel = async () => {
    if (!modal || modal.kind !== "cancel") return;
    setBusy(true);
    setModalError(null);
    try {
      await api.cancelAppointment({ salonId: modal.appointment.salonId, appointmentId: modal.appointment.id });
      setModal(null);
      setMessage("Horário cancelado. O horário foi liberado.");
      await refresh();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Não foi possível cancelar.");
    } finally {
      setBusy(false);
    }
  };

  const askReschedule = (appointment: FutureAppointment) => {
    const group = groupOf(appointment);
    const servicesLabel = group.map((g) => g.serviceName || "Atendimento").join(" + ");
    const totalMin = group.reduce((acc, g) => acc + (g.durationMin || 0), 0);
    setModalError(null);
    setModal({ kind: "intent", appointment, group, servicesLabel, totalMin });
  };

  const startSlotPick = async () => {
    if (!modal || modal.kind !== "intent") return;
    await ensureSalons();
    setSlotDate("");
    setSlotTime("");
    setSlots([]);
    setModalError(null);
    setModal({ kind: "slots", appointment: modal.appointment, group: modal.group, servicesLabel: modal.servicesLabel });
  };

  const pickSlotDate = async (date: string) => {
    if (!modal || modal.kind !== "slots") return;
    setSlotDate(date);
    setSlotTime("");
    setSlots([]);
    const slug = (salons || []).find((s) => s.id === modal.appointment.salonId)?.slug;
    if (!slug) {
      setModalError("Estabelecimento sem agendamento disponível.");
      return;
    }
    const serviceIds = modal.group.map((g) => g.serviceId).filter(Boolean) as string[];
    try {
      const res = await api.bookingSlots(slug, { date, serviceIds, staffId: modal.appointment.staffId });
      setSlots(res);
    } catch (err) {
      setSlots([]);
      setModalError(err instanceof ApiError ? err.message : "Erro ao buscar horários.");
    }
  };

  const confirmReschedule = async (time: string) => {
    if (!modal || modal.kind !== "slots") return;
    const [y, m, d] = slotDate.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const startAt = new Date(y, m - 1, d, hh, mm).toISOString();
    setSlotTime(time);
    setBusy(true);
    setModalError(null);
    try {
      await api.rescheduleAppointment({
        salonId: modal.appointment.salonId,
        appointmentId: modal.appointment.id,
        staffId: modal.appointment.staffId,
        startAt,
      });
      setModal(null);
      setMessage("Horário remarcado!");
      await refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      const isConflict =
        code.includes("CONFLICT") ||
        (err instanceof ApiError && /indispon[íi]vel|conflito/i.test(err.message));
      if (isConflict) {
        setModalError("Este horário acabou de ser preenchido. Escolha outro horário — o profissional continua o mesmo.");
        setSlotTime("");
        setTimeout(() => void pickSlotDate(slotDate), 250);
      } else {
        setModalError(err instanceof ApiError ? err.message : "Não foi possível remarcar.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  const modalSalonWa = modal ? waLinkFor((salons || []).find((s) => s.id === modal.appointment.salonId)?.phone) : null;

  const AppointmentCard = ({ a, actionable }: { a: FutureAppointment; actionable: boolean }) => {
    const meta = STATUS_META[a.status] || { label: a.status, cls: "bg-black/5 text-black/60 border-black/10" };
    const past = new Date(a.startAt).getTime() < Date.now();
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black uppercase tracking-tight">{a.serviceName || "Atendimento"}</p>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", meta.cls)}>{meta.label}</span>
          </div>
          <p className="mt-0.5 text-xs text-black/50">
            {fmtDateLong(a.startAt)} · {fmtWhen(a.startAt).split(", ").slice(1).join(", ")}
            {a.staffName ? ` · ${a.staffName}` : ""} {a.salonName ? ` · ${a.salonName}` : ""}
          </p>
        </div>
        {actionable && !past && a.status !== "cancelado" && a.status !== "falta" && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => askReschedule(a)}>Remarcar</Button>
            <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => askCancel(a)}>Cancelar</Button>
          </div>
        )}
      </li>
    );
  };

  const claimPanel = (
    <div className="mt-5 rounded-xl border border-black/10 bg-white p-5">
      <p className="text-sm font-black uppercase tracking-tight">Recuperar cadastro por WhatsApp</p>
      <p className="mt-1 text-xs text-black/50">Já é cliente de algum estabelecimento? Vincule seu cadastro informando o WhatsApp usado na reserva.</p>
      <div className="mt-4 grid gap-3">
        <Input id="claim-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Seu WhatsApp (com DDD)" />
        <label className="flex items-start gap-2.5 text-xs text-black/60 cursor-pointer">
          <input type="checkbox" checked={claimOptIn} onChange={(e) => setClaimOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
          <span>Confirmo que este número é meu WhatsApp e aceito receber confirmações e lembretes por ele.</span>
        </label>
        <Button variant="outline" onClick={startClaim} disabled={claiming}>{claiming ? "Buscando…" : "Recuperar"}</Button>
      </div>
      {candidates && candidates.length > 0 && (
        <div className="mt-4 grid gap-2">
          {candidates.map((c) => (
            <div key={`${c.salonId}:${c.clientId}`} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3">
              <div>
                <p className="text-sm font-bold">{c.name}</p>
                <p className="text-xs text-black/50">{c.salonName} · {c.phoneMask}</p>
              </div>
              <Button size="sm" onClick={() => confirmCandidate(c)} disabled={claiming}>Sou eu — vincular</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen w-full flex flex-col bg-white text-black">
      {/* NAV superior */}
      <header className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-black/10">
        <Link to="/" className="flex items-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-6 w-6 object-contain" />
          <span>kikin<span className="text-[#f97316]">.</span><span className="font-bold opacity-70">cliente</span></span>
        </Link>
        <div className="flex items-center gap-3 text-xs font-bold">
          <span className="hidden sm:inline text-black/50">{account?.email}</span>
          <Button variant="outline" size="sm" onClick={handleLogout}>Sair</Button>
        </div>
      </header>

      <div className="flex-1 w-full flex">
        {/* Sidebar */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-black/10 px-4 py-6">
          <nav className="grid gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setTab(n.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm font-bold transition-all cursor-pointer",
                  tab === n.id ? "bg-black text-white" : "text-black/60 hover:bg-black/5 hover:text-black"
                )}
              >
                <span>{n.icon}</span> {n.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto pt-8">
            <Link to="/termos" className="block text-xs font-semibold text-black/40 hover:text-black">Termos de Uso</Link>
            <Link to="/privacidade" className="mt-2 block text-xs font-semibold text-black/40 hover:text-black">Política de Privacidade</Link>
          </div>
        </aside>

        {/* Conteúdo */}
        <main className="flex-1 w-full max-w-4xl mx-auto px-6 md:px-10 py-8 pb-24 md:pb-10">
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
          )}
          {message && (
            <div className="mb-5 rounded-xl border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{message}</div>
          )}

          {/* ============ DASHBOARD ============ */}
          {tab === "dashboard" && (
            <>
              <h1 className="text-2xl font-black uppercase tracking-tight">Olá, {account?.fullName?.split(" ")[0] || "cliente"} 👋</h1>
              <p className="mt-1 text-sm text-black/50">
                {links.length === 0
                  ? "Este é o seu espaço no portal — agende, acompanhe e gerencie seus horários."
                  : `Você está cadastrado em ${links.length} ${links.length === 1 ? "estabelecimento" : "estabelecimentos"}.`}
              </p>

              <section className="mt-6 rounded-2xl border border-blue-600/30 bg-gradient-to-r from-blue-50 to-white p-6">
                <h2 className="text-lg font-black uppercase tracking-tight">Agendar</h2>
                <p className="mt-1.5 text-sm text-black/60">
                  {links.length === 0
                    ? "Vincule-se a um estabelecimento para agendar (apenas o seu salão aparece)."
                    : `Agende no seu estabelecimento: ${linkedMetas.map((m) => m.name).join(", ") || "carregando…"}`}
                </p>
                <Button className="mt-4" onClick={openAgendar}>Agendar agora</Button>
              </section>

              {links.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
                  <p>
                    <b>Você ainda não tem estabelecimentos vinculados.</b> Para agendar, o estabelecimento
                    precisa ter o seu cadastro (telefone/WhatsApp) — recupere-o abaixo.
                  </p>
                  <button type="button" onClick={() => { setShowClaim(true); setTab("estabelecimentos"); }} className="mt-3 text-xs font-bold text-blue-600 hover:underline">
                    Recuperar meu cadastro por WhatsApp →
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-8 flex items-center justify-between">
                    <h2 className="text-lg font-black uppercase tracking-tight">Meus próximos horários</h2>
                    <button type="button" onClick={() => setTab("consultas")} className="text-xs font-bold text-blue-600 hover:underline">
                      Ver todas as consultas →
                    </button>
                  </div>
                  {loading ? (
                    <p className="mt-5 text-sm text-black/50">Carregando…</p>
                  ) : appointments.length === 0 ? (
                    <p className="mt-5 rounded-xl border border-black/10 bg-black/[0.02] px-5 py-6 text-center text-sm text-black/60">
                      Nenhum horário futuro. Use “Agendar agora”.
                    </p>
                  ) : (
                    <ul className="mt-4 grid gap-3">
                      {appointments.slice(0, 4).map((a) => <AppointmentCard key={a.id} a={a} actionable />)}
                    </ul>
                  )}
                </>
              )}
            </>
          )}

          {/* ============ CONSULTAS ============ */}
          {tab === "consultas" && (
            <>
              <h1 className="text-2xl font-black uppercase tracking-tight">Minhas consultas</h1>
              <p className="mt-1 text-sm text-black/50">Próximas e histórico dos seus agendamentos em todos os estabelecimentos.</p>
              <ConsultasSection
                loading={loading}
                appointments={appointments}
                history={history}
                onLoadHistory={loadHistory}
                AppointmentCard={(a, actionable) => <AppointmentCard a={a} actionable={actionable} />}
              />
            </>
          )}

{tab === "estabelecimentos" && (
            <>
              <h1 className="text-2xl font-black uppercase tracking-tight">Estabelecimentos</h1>
              <p className="mt-1 text-sm text-black/50">Onde você está cadastrado na área do cliente.</p>
              {links.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
                  Você ainda não tem estabelecimentos vinculados.
                </div>
              ) : (
                <ul className="mt-5 grid gap-3">
                  {links.map((l) => {
                    const meta = (salons || []).find((s) => s.id === l.salonId);
                    return (
                      <li key={l.id} className="rounded-2xl border border-black/10 bg-white px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-base font-black uppercase tracking-tight">{l.salonName || meta?.name || "Estabelecimento"}</p>
                            <p className="text-xs text-black/50">Cadastro: {l.clientName} · WhatsApp {l.phoneMask}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => { void ensureSalons().then(() => { const m = meta || (salons || []).find((s) => s.id === l.salonId); if (m) setBooking(m); }); }}
                              className="rounded-lg border border-blue-600 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 cursor-pointer"
                            >
                              Agendar neste
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between rounded-xl bg-black/[0.02] px-4 py-2.5">
                          <p className="text-xs text-black/60">
                            Lembretes por WhatsApp:{" "}
                            <b className={l.whatsappOptInAt ? "text-green-700" : "text-black/60"}>
                              {l.whatsappOptInAt ? "Ativo" : "Desativado"}
                            </b>
                          </p>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleOptin(l, !l.whatsappOptInAt)}>
                            {l.whatsappOptInAt ? "Desativar" : "Ativar"}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-5">
                {showClaim ? (
                  <>
                    {claimPanel}
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowClaim(false)}>Fechar</Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setShowClaim(true)}>
                    + Recuperar cadastro por WhatsApp (adicionar estabelecimento)
                  </Button>
                )}
              </div>
            </>
          )}

          {/* ============ PERFIL ============ */}
          {tab === "perfil" && (
            <>
              <h1 className="text-2xl font-black uppercase tracking-tight">Meu perfil</h1>
              <div className="mt-6 grid gap-4 max-w-xl">
                <section className="rounded-2xl border border-black/10 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">Nome</p>
                  {editingName ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoComplete="name" />
                      <Button size="sm" disabled={busy} onClick={saveName}>Salvar</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingName(false)}>Cancelar</Button>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-base font-bold">{account?.fullName}</p>
                      <Button size="sm" variant="outline" onClick={() => setEditingName(true)}>Editar</Button>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-black/10 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">E-mail</p>
                  <p className="mt-1 text-base font-bold">{account?.email}</p>
                </section>

                <section className="rounded-2xl border border-black/10 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">Meu WhatsApp (contato e lembretes)</p>
                  {editingWa ? (
                    <div className="mt-2 grid gap-2">
                      <Input value={waDraft} onChange={(e) => setWaDraft(e.target.value)} placeholder="(11) 98765-4321" inputMode="tel" />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={saveWhatsapp}>Salvar número</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingWa(false); setWaDraft(""); }}>Cancelar</Button>
                      </div>
                      <p className="text-xs text-black/50">
                        LGPD: guardamos só uma versão criptografada. Este número único é usado nos
                        estabelecimentos em que você ativou os lembretes de WhatsApp.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-base font-bold">{account?.whatsappMask || "Não informado"}</p>
                      <Button size="sm" variant="outline" onClick={() => setEditingWa(true)}>{account?.whatsappMask ? "Editar" : "Adicionar"}</Button>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-black/10 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">Opções da área do cliente</p>
                  <ul className="mt-2 grid gap-1 text-sm">
                    <li className="flex items-center justify-between py-1.5">
                      <span>Notificações por WhatsApp por estabelecimento</span>
                      <button type="button" onClick={() => setTab("estabelecimentos")} className="text-xs font-bold text-blue-600 hover:underline">Gerenciar</button>
                    </li>
                    <li className="flex items-center justify-between py-1.5">
                      <span>Meus dados (LGPD)</span>
                      <span className="text-xs text-black/40">em breve</span>
                    </li>
                    <li className="flex items-center justify-between py-1.5">
                      <Link to="/privacidade" className="text-blue-600 text-xs font-bold hover:underline">Política de Privacidade</Link>
                    </li>
                  </ul>
                </section>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-black/10 bg-white md:hidden">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setTab(n.id)}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold cursor-pointer",
              tab === n.id ? "text-blue-600" : "text-black/50")}
          >
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      {/* Picker */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-5 sm:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <h3 className="text-lg font-black uppercase tracking-tight">Escolha o estabelecimento</h3>
            <p className="mt-2 text-sm text-black/60">Você tem vínculo em mais de um estabelecimento.</p>
            <div className="mt-5 grid gap-2">
              {linkedMetas.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setPicker(null); setBooking(s); }}
                  className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3 text-left text-sm font-bold hover:border-blue-600 hover:bg-blue-50 cursor-pointer"
                >
                  <span>{s.name}</span><span className="text-blue-600">agendar →</span>
                </button>
              ))}
              {linkedMetas.length === 0 && (
                <p className="text-sm text-black/50">Nenhum estabelecimento vinculado agora.</p>
              )}
            </div>
            <Button variant="outline" className="mt-6 w-full" onClick={() => setPicker(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Booking */}
      {booking && (
        <BookingModal
          salon={booking}
          linkedClient={(() => { const l = links.find((x) => x.salonId === booking.id); return l ? { clientId: l.kikinClientId } : null; })()}
          onClose={() => setBooking(null)}
          onSuccess={({ phone, whatsappOptIn }) => void handleBooked(booking, phone, whatsappOptIn)}
        />
      )}

      {/* Ações cancelar/remarcar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-5 sm:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {modal.kind === "cancel" && (
              <>
                <h3 className="text-lg font-black uppercase tracking-tight">Cancelar este horário?</h3>
                <p className="mt-3 text-sm leading-relaxed text-black/70">
                  <b>{modal.appointment.serviceName || "Atendimento"}</b> · {fmtWhen(modal.appointment.startAt)}
                  {modal.appointment.staffName ? ` · ${modal.appointment.staffName}` : ""}
                </p>
                <p className="mt-3 rounded-xl bg-black/[0.03] px-4 py-3 text-xs leading-relaxed text-black/60">
                  Pela área do cliente você pode cancelar até <b>6 horas antes</b> do horário (regra do
                  estabelecimento). Cancelamentos frequentes ou faltas podem limitar temporariamente o
                  agendamento online — sem custo para você.
                </p>
                {modalSalonWa && (
                  <a href={modalSalonWa} target="_blank" rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-green-600/40 bg-green-50 px-4 py-2.5 text-xs font-bold text-green-700 hover:bg-green-100">
                    <span>💬</span> Prefere falar? Chame o salão no WhatsApp
                  </a>
                )}
                {modalError && (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{modalError}</p>
                )}
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Button variant="outline" onClick={() => setModal(null)}>Voltar</Button>
                  <Button className="!bg-red-600 hover:!bg-red-700" disabled={busy} onClick={confirmCancel}>
                    {busy ? "Cancelando…" : "Sim, cancelar"}
                  </Button>
                </div>
              </>
            )}
            {modal.kind === "intent" && (
              <>
                <h3 className="text-lg font-black uppercase tracking-tight">Você quer remarcar?</h3>
                <p className="mt-3 text-sm leading-relaxed text-black/70">
                  Horário atual: <b>{modal.servicesLabel}</b> · {fmtWhen(modal.appointment.startAt)}
                  {modal.appointment.staffName ? ` · ${modal.appointment.staffName}` : ""}
                </p>
                <p className="mt-3 rounded-xl bg-black/[0.03] px-4 py-3 text-xs leading-relaxed text-black/60">
                  Você está <b>remarcando</b>, não apenas cancelando. Seu horário atual <b>só será liberado
                  quando você confirmar o novo horário</b> — assim você nunca fica sem vaga.
                </p>
                {modalError && (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{modalError}</p>
                )}
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Button variant="outline" onClick={() => setModal(null)}>Voltar</Button>
                  <Button onClick={startSlotPick}>Sim, quero remarcar</Button>
                </div>
              </>
            )}
            {modal.kind === "slots" && (
              <>
                <h3 className="text-lg font-black uppercase tracking-tight">Escolha o novo horário</h3>
                <p className="mt-2 text-sm text-black/60">{modal.servicesLabel} · mesmo profissional</p>
                <DateCalendar value={slotDate} onSelect={(d) => void pickSlotDate(d)} />
                {slotDate && (slots.length === 0 ? (
                  <p className="mt-4 text-sm text-black/50">Nenhum horário livre neste dia para o profissional.</p>
                ) : (
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {slots.map((s) => (
                      <button key={s.start_at} type="button" onClick={() => confirmReschedule(s.start_at)}
                        className={cn("h-10 rounded-lg border text-sm font-bold cursor-pointer",
                          slotTime === s.start_at ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 hover:border-blue-600")}>
                        {s.start_at}
                      </button>
                    ))}
                  </div>
                ))}
                {modalError && (
                  <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{modalError}</p>
                )}
                <div className="mt-6">
                  <Button variant="outline" className="w-full" onClick={() => setModal(null)} disabled={busy}>{busy ? "Remarcando…" : "Fechar"}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConsultasSection(props: {
  loading: boolean;
  appointments: FutureAppointment[];
  history: FutureAppointment[] | null;
  onLoadHistory: () => void;
  AppointmentCard: (a: FutureAppointment, actionable: boolean) => ReactNode;
}) {
  const [mode, setMode] = useState<"upcoming" | "history">("upcoming");
  useEffect(() => {
    if (mode === "history") props.onLoadHistory();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const past = props.history || [];
  const now = Date.now();
  const upcomingItems = props.appointments;
  const historyItems = [...past].filter((a) => {
    const ended = new Date(a.endAt || a.startAt).getTime() <= now || ["cancelado", "falta", "canceled", "no_show"].includes(a.status);
    return ended;
  });

  return (
    <div className="mt-5">
      <div className="flex gap-2 text-xs font-bold">
        {(["upcoming", "history"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn("rounded-full border px-4 py-1.5 cursor-pointer",
              mode === m ? "border-black bg-black text-white" : "border-black/15 text-black/60 hover:border-black/40")}
          >
            {m === "upcoming" ? `Próximas (${upcomingItems.length})` : `Histórico (${historyItems.length})`}
          </button>
        ))}
      </div>

      <ul className="mt-4 grid gap-3">
        {mode === "upcoming"
          ? upcomingItems.length === 0
            ? <p className="text-sm text-black/50">Nenhuma consulta futura.</p>
            : upcomingItems.map((a) => <li key={a.id}>{props.AppointmentCard(a, true)}</li>)
          : historyItems.length === 0
            ? <p className="text-sm text-black/50">Nenhum histórico ainda.</p>
            : historyItems.map((a) => <li key={a.id}>{props.AppointmentCard(a, false)}</li>)}
      </ul>
    </div>
  );
}
