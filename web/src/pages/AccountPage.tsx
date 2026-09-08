import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
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

function nextDays(count: number): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setDate(base.getDate() + 1);
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
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

/**
 * Área do cliente — o portal é o ÚNICO método de agendamento:
 * “Agendar” roda aqui dentro (serviços → profissional → horário → confirmar) para o
 * estabelecimento vinculado; na 1ª vez (sem vínculo) o cliente escolhe o estabelecimento,
 * que vira o vínculo. Não há página pública por slug e não há lista global permanente.
 */
export function AccountPage() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [links, setLinks] = useState<EstablishmentLink[]>([]);
  const [appointments, setAppointments] = useState<FutureAppointment[]>([]);

  // ---- claim (recuperar cadastros existentes por telefone)
  const [phone, setPhone] = useState("");
  const [claimOptIn, setClaimOptIn] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null);

  // ---- agendar (salões p/ escolha única + fluxo)
  const [salons, setSalons] = useState<BookingSalonMeta[] | null>(null);
  const [picker, setPicker] = useState<null | "linked" | "all">(null);
  const [booking, setBooking] = useState<BookingSalonMeta | null>(null);

  // ---- cancelar/remarcar
  const [modal, setModal] = useState<ActionModal | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const slugBySalon = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of salons || []) map[s.id] = s.slug;
    return map;
  }, [salons]);

  /** vínculos com meta do salão (para agendar no(s) salão(ões) da conta). */
  const linkedMetas = useMemo(() => {
    const metas: BookingSalonMeta[] = [];
    for (const l of links) {
      const m = (salons || []).find((s) => s.id === l.salonId);
      if (m) metas.push(m);
    }
    return metas;
  }, [links, salons]);

  /** lista única por nome (1ª escolha). */
  const uniqueSalons = useMemo(() => {
    const seen = new Set<string>();
    const out: BookingSalonMeta[] = [];
    for (const s of salons || []) {
      const k = s.name.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [salons]);

  // ---- claim
  const startClaim = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) return setError("Informe um telefone/WhatsApp com DDD válido.");
    setError(null);
    setMessage(null);
    setClaiming(true);
    setCandidates(null);
    try {
      const res = await api.claimClients({ phone });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setMessage("Nenhum cadastro encontrado com este telefone. Se é sua primeira vez, use 'Agendar agora'.");
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
      await api.confirmLink({ salonId: candidate.salonId, phone, clientId: candidate.clientId, whatsappOptIn: claimOptIn });
      setCandidates(null);
      setPhone("");
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
    if (linked.length === 1) {
      setBooking(linked[0]);
    } else if (linked.length > 1) {
      setPicker("linked");
    } else {
      setPicker("all");
    }
  };

  const handleBooked = async (salon: BookingSalonMeta, phoneDigits: string, whatsappOptIn: boolean) => {
    if (!links.some((l) => l.salonId === salon.id)) {
      try {
        await api.autoLink({ salonId: salon.id, phone: phoneDigits, whatsappOptIn });
      } catch {
        // vínculo segue pelo claim se falhar
      }
    }
    setBooking(null);
    setMessage("Horário confirmado! Ele já aparece em 'Meus próximos horários'.");
    await refresh();
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
      setMessage("Horário cancelado. O horário já foi liberado para novos agendamentos.");
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
    const slug = slugBySalon[modal.appointment.salonId];
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
      setMessage("Horário remarcado! Seu novo horário está confirmado.");
      await refresh();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Não foi possível remarcar.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const modalSalonWa = modal ? waLinkFor((salons || []).find((s) => s.id === modal.appointment.salonId)?.phone) : null;

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
          <Button variant="outline" size="sm" onClick={handleLogout}>Sair</Button>
        </nav>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-10">
        {/* Cabeçalho da conta */}
        <div className="flex items-center gap-4">
          {account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-full object-cover border border-black/10" />
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
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        )}
        {message && (
          <div className="mt-6 rounded-xl border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{message}</div>
        )}

        {!loading && (
          /* ---- Agendar (portal = único método) ---- */
          <section className="mt-8 rounded-2xl border border-blue-600/30 bg-gradient-to-r from-blue-50 to-white p-6">
            <h2 className="text-lg font-black uppercase tracking-tight">Agendar</h2>
            <p className="mt-1.5 text-sm text-black/60">
              {links.length === 0
                ? "Escolha o seu estabelecimento e veja os horários disponíveis para agendar."
                : `Agende no seu estabelecimento: ${linkedMetas.map((m) => m.name).join(", ") || "carregando…"}`}
            </p>
            <Button className="mt-4" onClick={openAgendar}>Agendar agora</Button>
          </section>
        )}

        {loading ? (
          <p className="mt-10 text-sm text-black/50">Carregando…</p>
        ) : links.length === 0 ? (
          /* ---- 1ª vez sem vínculo: recuperar cadastros existentes (opcional) ---- */
          <section className="mt-8 rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.1)]">
            <h2 className="text-lg font-black uppercase tracking-tight">Já tem agendamentos?</h2>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              Se você já é cliente do estabelecimento, informe seu WhatsApp e recupere seus cadastros.
            </p>
            <div className="mt-6 grid gap-4">
              <div>
                <Label htmlFor="claim-phone">Seu WhatsApp (com DDD)</Label>
                <Input id="claim-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98765-4321" />
              </div>
              <label className="flex items-start gap-2.5 text-xs leading-relaxed text-black/60 cursor-pointer">
                <input type="checkbox" checked={claimOptIn} onChange={(e) => setClaimOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                <span>Confirmo que este número é meu WhatsApp e aceito receber confirmações e lembretes por ele.</span>
              </label>
              <Button type="button" variant="outline" onClick={startClaim} disabled={claiming} className="w-full">
                {claiming ? "Buscando…" : "Recuperar meus agendamentos"}
              </Button>
            </div>
            {candidates && candidates.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/50">
                  Encontramos {candidates.length === 1 ? "1 cadastro" : `${candidates.length} cadastros`} — é você?
                </p>
                <div className="mt-3 grid gap-2.5">
                  {candidates.map((c) => (
                    <div key={`${c.salonId}:${c.clientId}`} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3">
                      <div>
                        <p className="text-sm font-bold">{c.name}</p>
                        <p className="text-xs text-black/50">{c.salonName} · {c.phoneMask}</p>
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
          /* ---- Vinculado: próximos agendamentos + ações ---- */
          <section className="mt-8">
            <h2 className="text-lg font-black uppercase tracking-tight">Meus próximos horários</h2>
            {appointments.length === 0 ? (
              <div className="mt-5 rounded-xl border border-black/10 bg-black/[0.02] px-5 py-6 text-center">
                <p className="text-sm font-bold text-black/70">Nenhum horário futuro por aqui.</p>
                <p className="mt-1 text-xs text-black/50">Use “Agendar agora” para marcar no seu estabelecimento.</p>
              </div>
            ) : (
              <ul className="mt-5 grid gap-3">
                {appointments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-5 py-4">
                    <div>
                      <p className="text-sm font-black uppercase tracking-tight">{a.serviceName || "Atendimento"}</p>
                      <p className="mt-0.5 text-xs text-black/50">
                        {a.staffName ? `${a.staffName} · ` : ""}{a.salonName}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-blue-700">{fmtWhen(a.startAt)}</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => askReschedule(a)}>Remarcar</Button>
                        <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => askCancel(a)}>Cancelar</Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* ---- Picker de estabelecimento (1ª escolha ou vínculos múltiplos) ---- */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white p-6 sm:p-8">
            <h3 className="text-lg font-black uppercase tracking-tight">
              {picker === "linked" ? "Escolha o estabelecimento" : "Qual é o seu estabelecimento?"}
            </h3>
            <p className="mt-2 text-sm text-black/60">
              {picker === "linked"
                ? "Você tem vínculo em mais de um estabelecimento."
                : "Escolha uma única vez — depois de agendar, ele vira o seu estabelecimento."}
            </p>
            <div className="mt-5 grid gap-2">
              {(picker === "linked" ? linkedMetas : uniqueSalons).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setPicker(null); setBooking(s); }}
                  className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3 text-left text-sm font-bold hover:border-blue-600 hover:bg-blue-50 transition-all cursor-pointer"
                >
                  <span>{s.name}</span>
                  <span className="text-blue-600">agendar →</span>
                </button>
              ))}
              {(picker === "all" ? uniqueSalons.length : linkedMetas.length) === 0 && (
                <p className="text-sm text-black/50">Nenhum estabelecimento disponível agora.</p>
              )}
            </div>
            <Button variant="outline" className="mt-6 w-full" onClick={() => setPicker(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* ---- Fluxo de agendamento (único método) ---- */}
      {booking && (
        <BookingModal
          salon={booking}
          linkedClient={(() => { const l = links.find((x) => x.salonId === booking.id); return l ? { clientId: l.kikinClientId } : null; })()}
          onClose={() => { setBooking(null); }}
          onSuccess={({ phone, whatsappOptIn }) => void handleBooked(booking, phone, whatsappOptIn)}
        />
      )}

      {/* ---- Modal de ações (cancelar/remarcar) ---- */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white p-6 sm:p-8">
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
                  Você está <b>remarcando</b>, não apenas cancelando. Seu horário atual <b>só será
                  liberado quando você confirmar o novo horário</b> — assim você nunca fica sem vaga.
                  Se a intenção for apenas <b>cancelar</b>, use o botão "Cancelar" no card do horário.
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
                <p className="mt-2 text-sm text-black/60">
                  {modal.servicesLabel} · mesmo profissional
                  {modal.group.length > 1 ? ` (${modal.group.length} serviços em sequência)` : ""}
                </p>
                <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
                  {nextDays(14).map((d) => {
                    const [yy, mm, dd] = d.split("-").map(Number);
                    const label = new Date(yy, mm - 1, dd).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
                    return (
                      <button key={d} type="button" onClick={() => pickSlotDate(d)}
                        className={cn("shrink-0 rounded-xl border px-3 py-2 text-xs font-bold uppercase cursor-pointer",
                          slotDate === d ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 hover:border-black/40")}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {slotDate && (slots.length === 0 ? (
                  <p className="mt-4 text-sm text-black/50">Nenhum horário livre neste dia para o profissional.</p>
                ) : (
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {slots.map((s) => (
                      <button key={s.start_at} type="button" onClick={() => confirmReschedule(s.start_at)}
                        className={cn("rounded-lg border py-2 text-sm font-bold cursor-pointer",
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
                  <Button variant="outline" className="w-full" onClick={() => setModal(null)} disabled={busy}>
                    {busy ? "Remarcando…" : "Fechar"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
