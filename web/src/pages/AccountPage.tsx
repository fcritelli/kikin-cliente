import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  api,
  ApiError,
  type BookingSalonMeta,
  type BookingSlot,
  type ClientCandidate,
  type EstablishmentLink,
  type FutureAppointment,
} from "@/lib/api";
import { BOOKING_CONTEXT_KEY } from "./AgendarPage";
import { cn } from "@/lib/utils";

type ModalState =
  | { kind: "cancel"; appointment: FutureAppointment }
  | { kind: "intent"; appointment: FutureAppointment; group: FutureAppointment[]; servicesLabel: string; totalMin: number }
  | { kind: "slots"; appointment: FutureAppointment; group: FutureAppointment[]; servicesLabel: string };

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
 * Área do cliente: vínculo (claim), agendar novo e cancelar/remarcar com a regra
 * da área do cliente (janela de 6h + limite suave; aplicadas no Kikin, fonte da verdade).
 */
export function AccountPage() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [links, setLinks] = useState<EstablishmentLink[]>([]);
  const [appointments, setAppointments] = useState<FutureAppointment[]>([]);

  // ---- claim
  const [phone, setPhone] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null);

  // ---- agendar novo
  const [bookSalons, setBookSalons] = useState<BookingSalonMeta[] | null>(null);

  // ---- cancelar/remarcar
  const [modal, setModal] = useState<ModalState | null>(null);
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

  // Auto-vínculo silencioso vindo de um agendamento feito como convidado
  useEffect(() => {
    if (loading) return;
    const raw = sessionStorage.getItem(BOOKING_CONTEXT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(BOOKING_CONTEXT_KEY);
    let ctx: { salonId?: string; phone?: string };
    try {
      ctx = JSON.parse(raw);
    } catch {
      return;
    }
    if (!ctx.salonId || !ctx.phone) return;
    (async () => {
      setClaiming(true);
      try {
        const res = await api.autoLink({ salonId: ctx.salonId!, phone: ctx.phone! });
        if (res.link) {
          setMessage("Seu agendamento foi vinculado à sua conta!");
          await refresh();
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Erro ao vincular seu agendamento.");
      } finally {
        setClaiming(false);
      }
    })();
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBookingSalons = async () => {
    if (bookSalons) return;
    try {
      const res = await api.bookingSalons();
      setBookSalons(res.salons);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao carregar estabelecimentos.");
    }
  };

  const slugBySalon = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of bookSalons || []) map[s.id] = s.slug;
    return map;
  }, [bookSalons]);

  /** Picker de salões: cada NOME aparece uma única vez; os vinculados à conta vêm primeiro. */
  const salonPicker = useMemo(() => {
    const all = bookSalons || [];
    const linked = links
      .map((l) => all.find((s) => s.id === l.salonId))
      .filter((s): s is BookingSalonMeta => Boolean(s));
    const linkedIds = new Set(linked.map((s) => s.id));
    const seen = new Set(linked.map((s) => s.name.trim().toLowerCase()));
    const others: BookingSalonMeta[] = [];
    for (const s of all) {
      if (linkedIds.has(s.id)) continue;
      const key = s.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      others.push(s);
    }
    others.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return { linked, others };
  }, [bookSalons, links]);

  const startClaim = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) return setError("Informe um telefone com DDD válido.");
    setError(null);
    setMessage(null);
    setClaiming(true);
    setCandidates(null);
    try {
      const res = await api.claimClients({ phone });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setMessage("Nenhum cadastro encontrado com este telefone. Confira o número usado na reserva.");
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
      await api.confirmLink({ salonId: candidate.salonId, phone, clientId: candidate.clientId });
      setCandidates(null);
      setPhone("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao confirmar o vínculo.");
    } finally {
      setClaiming(false);
    }
  };

  // ---- ações de agendamento

  /** agrupa os cards do MESMO grupo (multi-serviço vira um grupo único). */
  const groupOf = (appointment: FutureAppointment): FutureAppointment[] => {
    const key = appointment.groupId || appointment.id;
    return appointments.filter((a) => a.salonId === appointment.salonId && (a.groupId || a.id) === key);
  };

  const askCancel = (appointment: FutureAppointment) => {
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
    await loadBookingSalons();
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
      setModalError("Estabelecimento sem agendamento online disponível.");
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

        {/* Agendar novo — sempre disponível */}
        <section className="mt-8 rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight">Agendar novo horário</h2>
              <p className="text-xs text-black/50">Escolha um estabelecimento e veja os horários disponíveis.</p>
            </div>
            <Button size="sm" onClick={() => void loadBookingSalons()}>Agendar novo</Button>
          </div>
          {bookSalons && bookSalons.length > 0 && (
            <div className="mt-4 space-y-4">
              {salonPicker.linked.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1.5">
                    Seus estabelecimentos
                  </p>
                  <div className="grid gap-2">
                    {salonPicker.linked.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/agendar/${s.slug}`)}
                        className="flex items-center justify-between gap-3 rounded-xl border border-blue-600 bg-blue-50 px-4 py-3 text-left text-sm font-bold hover:bg-blue-100 transition-all cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-blue-600" />
                          {s.name}
                        </span>
                        <span className="text-blue-600">agendar →</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {salonPicker.others.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/40 mb-1.5">
                    {salonPicker.linked.length > 0 ? "Outros estabelecimentos" : "Estabelecimentos"}
                  </p>
                  <div className="grid gap-2">
                    {salonPicker.others.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/agendar/${s.slug}`)}
                        className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3 text-left text-sm font-bold hover:border-blue-600 hover:bg-blue-50 transition-all cursor-pointer"
                      >
                        <span>{s.name}</span>
                        <span className="text-blue-600">agendar →</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {salonPicker.linked.length === 0 && salonPicker.others.length === 0 && (
                <p className="text-xs text-black/50">Nenhum estabelecimento encontrado.</p>
              )}
            </div>
          )}
          {bookSalons && bookSalons.length === 0 && (
            <p className="mt-3 text-xs text-black/50">Nenhum estabelecimento com agendamento online disponível.</p>
          )}
        </section>

        {loading ? (
          <p className="mt-10 text-sm text-black/50">Carregando…</p>
        ) : links.length === 0 ? (
          /* ---- Primeiro acesso: vínculo (claim) ---- */
          <section className="mt-8 rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.1)]">
            <h2 className="text-lg font-black uppercase tracking-tight">Encontre seus agendamentos</h2>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              Já tem horário marcado em algum estabelecimento? Informe o telefone usado na reserva e
              buscaremos seus cadastros em todos os estabelecimentos. Seu telefone fica protegido
              (LGPD): só uma versão criptografada é usada na busca.
            </p>
            <div className="mt-6 grid gap-4">
              <div>
                <Label htmlFor="claim-phone">Telefone usado na reserva</Label>
                <Input id="claim-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98765-4321" />
              </div>
              <Button type="button" onClick={startClaim} disabled={claiming} className="w-full">
                {claiming ? "Buscando…" : "Encontrar meus agendamentos"}
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
                <p className="mt-1 text-xs text-black/50">Quando você agendar, ele aparecerá nesta lista.</p>
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
                        <Button variant="outline" size="sm" onClick={() => askReschedule(a)}>
                          Remarcar
                        </Button>
                        <Button variant="ghost" size="sm" className="!text-red-600 hover:!bg-red-50" onClick={() => askCancel(a)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* ---- Modal de ações ---- */}
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
                      <button
                        key={d}
                        type="button"
                        onClick={() => pickSlotDate(d)}
                        className={cn(
                          "shrink-0 rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-wide cursor-pointer",
                          slotDate === d ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 hover:border-black/40"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {slotDate && (
                  <div className="mt-4">
                    {slots.length === 0 ? (
                      <p className="text-sm text-black/50">Nenhum horário livre neste dia para o profissional.</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-2">
                        {slots.map((s) => (
                          <button
                            key={s.start_at}
                            type="button"
                            onClick={() => confirmReschedule(s.start_at)}
                            className={cn(
                              "rounded-lg border py-2 text-sm font-bold cursor-pointer",
                              slotTime === s.start_at ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 hover:border-blue-600"
                            )}
                          >
                            {s.start_at}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
