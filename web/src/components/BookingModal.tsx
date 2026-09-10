import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  type BookingSalonMeta,
  type BookingService,
  type BookingSlot,
  type BookingStaff,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { DateCalendar } from "@/components/ui/DateCalendar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/utils";
import { WHATSAPP_OPTIN_OPTIONAL_NOTE } from "@/lib/lgpdCopy";
import { subscribeRealtime } from "@/lib/realtime";

type Step = "servicos" | "profissionais" | "horario" | "dados" | "feito";

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);


function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

interface BookingModalProps {
  salon: BookingSalonMeta;
  /** quando a conta já tem vínculo: agenda direto no client (sem telefone) */
  linkedClient?: { clientId: string } | null;
  onClose: () => void;
  onSuccess: (info: { result: any; phone: string; whatsappOptIn: boolean }) => void;
}

/**
 * Fluxo de agendamento do portal (único método): serviços → profissional →
 * dia/horário reais → dados (telefone = WhatsApp + opt-in) → confirmar.
 * Roda DENTRO da conta do cliente (modal), sempre para um estabelecimento já escolhido.
 */
export function BookingModal({ salon, linkedClient, onClose, onSuccess }: BookingModalProps) {
  const { account } = useAuth();

  const [services, setServices] = useState<BookingService[]>([]);
  const [staff, setStaff] = useState<BookingStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("servicos");
  const [selectedServices, setSelectedServices] = useState<BookingService[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [clientName, setClientName] = useState(account?.fullName || "");
  const [clientPhone, setClientPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // shape unificada do retorno (public proxy ou interno por client)
  const [done, setDone] = useState<{ appointments: { appointment_id: string; service_name: string; start_at: string }[]; staff_name?: string } | null>(null);
  const notified = useRef(false);
  const holdRef = useRef<string | null>(null);
  /** Hold criado por ESTE navegador — para ignorar o eco do próprio hold. */
  const ownHoldRef = useRef<{ staffId: string; startAt: string } | null>(null);

  const serviceIds = useMemo(() => selectedServices.map((s) => s.id), [selectedServices]);
  const slug = salon.slug;

  // Espelho do estado para o handler de realtime (sem re-subscribir a cada render).
  const viewRef = useRef({ step, date, time, staffId, done, busy, serviceIds });
  viewRef.current = { step, date, time, staffId, done, busy, serviceIds };

  useEffect(() => {
    (async () => {
      try {
        const svc = await api.bookingServices(slug);
        setServices(svc);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Não foi possível carregar os serviços.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const toggleService = (svc: BookingService) => {
    setSelectedServices((prev) => (prev.some((s) => s.id === svc.id) ? prev.filter((s) => s.id !== svc.id) : [...prev, svc]));
    setStep("profissionais");
  };

  useEffect(() => {
    if (serviceIds.length === 0) return;
    setStaffId(null);
    setTime("");
    api
      .bookingStaff(slug, serviceIds)
      .then(setStaff)
      .catch(() => setStaff([]));
  }, [serviceIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!date || serviceIds.length === 0) return;
    api
      .bookingSlots(slug, { date, serviceIds, staffId })
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [date, serviceIds.join(","), staffId, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: outra pessoa (ou a secretária) mexeu na agenda deste estabelecimento.
  // Atualiza os horários em aberto e, se o horário escolhido foi tomado enquanto o
  // cliente preenchia os dados, volta para a lista com a mensagem de conflito.
  useEffect(() => {
    return subscribeRealtime((ev) => {
      const v = viewRef.current;
      if (v.done || ev.salonId !== salon.id) return;

      const AFFECTS_AVAILABILITY = new Set([
        "appointment.created",
        "appointment.updated",
        "appointment.cancelled",
        "appointment.deleted",
        "hold.created",
        "hold.released",
        "hold.expired",
      ]);
      if (!AFFECTS_AVAILABILITY.has(ev.type)) return;

      // Eco do próprio hold (este navegador reservou o horário): não trata como conflito.
      const isOwnHold =
        ev.type === "hold.created" &&
        ownHoldRef.current !== null &&
        ev.staffId === ownHoldRef.current.staffId &&
        ev.startAt === ownHoldRef.current.startAt;
      if (isOwnHold) return;

      // O horário selecionado foi reservado/ocupado por outra pessoa?
      let selectedStartIso = "";
      if (v.date && v.time) {
        const [yy, mm, dd] = v.date.split("-").map(Number);
        const [hh, min] = v.time.split(":").map(Number);
        selectedStartIso = new Date(yy, mm - 1, dd, hh, min).toISOString();
      }
      const hitSelected =
        v.step === "dados" &&
        !!v.time &&
        !!v.staffId &&
        !!ev.startAt &&
        ev.startAt === selectedStartIso &&
        ev.staffId === v.staffId;

      const takenByOther = ev.type === "appointment.created" || ev.type === "hold.created";
      if (takenByOther && hitSelected && !v.busy) {
        releaseCurrentHold();
        setError("Esse horário acabou de ser reservado por outra pessoa no mesmo minuto. Atualizamos a agenda — escolha outro.");
        setTime("");
        setStep("horario");
        setReloadTick((t) => t + 1);
        return;
      }

      if (v.date && v.serviceIds.length > 0) {
        setReloadTick((t) => t + 1);
      }
    });
  }, [salon.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const releaseCurrentHold = () => {
    if (holdRef.current) void api.releaseHold(holdRef.current).catch(() => undefined);
    holdRef.current = null;
    ownHoldRef.current = null;
  };

  const reserveHold = async (startAt: string, effStaffId: string) => {
    releaseCurrentHold();
    try {
      const res = await api.bookingHold({ salonId: salon.id, staffId: effStaffId, serviceIds, startAt });
      holdRef.current = res.hold.token;
      ownHoldRef.current = { staffId: effStaffId, startAt };
    } catch {
      holdRef.current = null; // hold é consultivo; segue mesmo se falhar
    }
  };

  const totalDuration = selectedServices.reduce((acc, s) => acc + (s.duration_min || 0), 0);
  const totalPrice = selectedServices.reduce((acc, s) => acc + (s.price || 0), 0);

  useEffect(() => {
    return () => {
      releaseCurrentHold();
    };
  }, []);

  const submit = async () => {
    if (!date || !time) return setError("Escolha dia e horário.");
    const phoneDigits = clientPhone.replace(/\D/g, "");
    if (!linkedClient) {
      if (clientName.trim().length < 2) return setError("Informe seu nome.");
      if (phoneDigits.length < 10) return setError("Informe um WhatsApp com DDD válido.");
    }
    setError(null);
    setBusy(true);
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const startAt = new Date(y, m - 1, d, hh, mm).toISOString();
    try {
      const raw: any = linkedClient
        ? await api.bookForLink({ salonId: salon.id, serviceIds, staffId, startAt, whatsappOptIn, holdToken: holdRef.current })
        : account
          ? await api.bookNewAtSalon({
              salonId: salon.id,
              serviceIds,
              staffId,
              startAt,
              name: clientName.trim(),
              phone: phoneDigits,
              whatsappOptIn,
              holdToken: holdRef.current,
            })
          : await api.bookingBook(slug, {
              serviceIds,
              staffId,
              startAt,
              clientName: clientName.trim(),
              clientPhone: phoneDigits,
              whatsappOptIn,
              holdToken: holdRef.current,
            });
      const items: any[] = raw?.created || raw?.appointments || [];
      const result = { appointments: items, staff_name: raw?.staff_name };
      setDone(result);
      setStep("feito");
      if (!notified.current) {
        notified.current = true;
        onSuccess({ result, phone: linkedClient ? "" : phoneDigits, whatsappOptIn });
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      const isConflict =
        code.includes("CONFLICT") ||
        (err instanceof ApiError && /indispon[íi]vel|conflito/i.test(err.message));
      if (isConflict) {
        // Horário foi ocupado entre a busca e o confirmar: mantém o MESMO profissional,
        // volta para a lista e a atualiza (o horário tomado não aparece mais).
        setError("Esse horário acabou de ser reservado por outra pessoa no mesmo minuto. Atualizamos a agenda — escolha outro.");
        releaseCurrentHold();
        setTime("");
        setStep("horario");
        setReloadTick((t) => t + 1);
      } else {
        setError(err instanceof ApiError ? err.message : "Não foi possível confirmar o horário.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-5 sm:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Agendar no seu estabelecimento</p>
            <h3 className="text-lg font-black uppercase tracking-tight">{salon.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-black/15 px-3 py-1 text-xs font-bold hover:bg-black/5 cursor-pointer">
            {done ? "Fechar" : "Sair"}
          </button>
        </div>

        {loading ? (
          <p className="mt-8 text-sm text-black/50">Carregando…</p>
        ) : loadError ? (
          <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>
        ) : done ? (
          <div className="mt-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 flex items-center justify-center text-2xl">✅</div>
            <h4 className="mt-4 text-xl font-black uppercase tracking-tight">Horário garantido!</h4>
            <div className="mt-5 rounded-xl border border-black/10 bg-black/[0.02] px-5 py-4 text-left space-y-1">
              {done.appointments.map((a) => (
                <p key={a.appointment_id} className="text-sm">
                  <b>{a.service_name}</b> · {fmtWhen(a.start_at)}
                </p>
              ))}
              <p className="text-xs text-black/50">Com {done.staff_name}</p>
            </div>
            <Button className="mt-6 w-full" onClick={onClose}>
              Ver meus agendamentos
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>
            )}

            {step === "servicos" && (
              <>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-black/50">1 · Escolha o serviço</p>
                <div className="mt-3 grid gap-2.5">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s)}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-4 py-3 text-left cursor-pointer",
                        selectedServices.some((x) => x.id === s.id) ? "border-blue-600 bg-blue-50" : "border-black/10 hover:border-black/30"
                      )}
                    >
                      <div>
                        <p className="text-sm font-bold">{s.name}</p>
                        <p className="text-xs text-black/50">{s.duration_min} min</p>
                      </div>
                      <p className="text-sm font-black">{fmtBRL(s.price)}</p>
                    </button>
                  ))}
                </div>
                {selectedServices.length > 0 && (
                  <div className="mt-6 flex items-center justify-between rounded-xl border border-black/10 px-4 py-3">
                    <p className="text-sm text-black/60">{selectedServices.length} serviço(s) · {totalDuration} min</p>
                    <Button size="sm" onClick={() => setStep("profissionais")}>Continuar →</Button>
                  </div>
                )}
              </>
            )}

            {step === "profissionais" && (
              <>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-black/50">2 · Profissional (opcional)</p>
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={() => { setStaffId(null); setStep("horario"); }}
                    className={cn("rounded-xl border px-4 py-3 text-left text-sm font-semibold cursor-pointer",
                      staffId === null ? "border-blue-600 bg-blue-50" : "border-black/10 hover:border-black/30")}>
                    Sem preferência
                  </button>
                  {staff.map((p) => (
                    <button key={p.id} type="button" onClick={() => { setStaffId(p.id); setStep("horario"); }}
                      className={cn("rounded-xl border px-4 py-3 text-left text-sm font-bold cursor-pointer",
                        staffId === p.id ? "border-blue-600 bg-blue-50" : "border-black/10 hover:border-black/30")}>
                      {p.name}
                    </button>
                  ))}
                  {staff.length === 0 && <p className="text-sm text-black/50">Nenhum profissional disponível para os serviços escolhidos.</p>}
                </div>
              </>
            )}

            {step === "horario" && (
              <>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-black/50">3 · Dia e horário</p>
                <DateCalendar value={date} onSelect={(d) => { setDate(d); setTime(""); }} />
                {!staffId && (
                  <p className="mt-2 text-xs text-black/50">
                    Mostramos horários livres de pelo menos um profissional — ao escolher, atribuímos o disponível.
                  </p>
                )}
                {(() => {
                  const visibleSlots = staffId ? slots.filter((s) => s.available_staff.includes(staffId)) : slots;
                  if (visibleSlots.length === 0) {
                    return <p className="mt-4 text-sm text-black/50">Nenhum horário livre neste dia para o profissional.</p>;
                  }
                  return (
                    <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {visibleSlots.map((s) => (
                        <button key={s.start_at} type="button"
                          onClick={() => {
                            const [yy, mm, dd] = date.split("-").map(Number);
                            const [hh, min] = s.start_at.split(":").map(Number);
                            const effStaff = staffId || s.available_staff[0];
                            setTime(s.start_at);
                            if (effStaff) {
                              setStaffId(effStaff);
                              void reserveHold(new Date(yy, mm - 1, dd, hh, min).toISOString(), effStaff);
                            }
                            setStep("dados");
                          }}
                          className={cn("h-10 rounded-lg border text-sm font-bold cursor-pointer",
                            time === s.start_at ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 hover:border-blue-600")}>
                          {s.start_at}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}

            {step === "dados" && (
              <>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-black/50">4 · Seus dados</p>
                <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm">
                  <p className="font-bold">{selectedServices.map((s) => s.name).join(" + ")}</p>
                  <p className="text-black/60">
                    {new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} às {time}
                    {" · "}{staff.find((p) => p.id === staffId)?.name || (staffId ? "profissional atribuído automaticamente" : "sem preferência")}
                  </p>
                </div>
                <div className="mt-5 grid gap-4">
                  {!linkedClient && (
                    <div>
                      <Label htmlFor="bm-name">Nome</Label>
                      <Input id="bm-name" autoComplete="name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Seu nome" />
                    </div>
                  )}
                  {!linkedClient ? (
                    <div>
                      <Label htmlFor="bm-phone">Seu WhatsApp (com DDD)</Label>
                      <Input id="bm-phone" type="tel" inputMode="tel" autoComplete="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="(11) 98765-4321" />
                    </div>
                  ) : (
                    <p className="rounded-xl bg-black/[0.03] px-4 py-3 text-xs text-black/60">
                      Você já está cadastrado neste estabelecimento — confirmamos o horário no seu cadastro vinculado.
                    </p>
                  )}
                  <label className="flex items-start gap-2.5 text-xs leading-relaxed text-black/60 cursor-pointer">
                    <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                    <span>Confirmo que este número é meu WhatsApp e aceito receber a confirmação do agendamento e lembretes por ele.</span>
                  </label>
                  {/* LGPD Art. 18, VIII — o lembrete é opcional; a recusa não impede o agendamento */}
                  <p className="text-[11px] leading-relaxed text-black/50">{WHATSAPP_OPTIN_OPTIONAL_NOTE}</p>
                  <div className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3">
                    <p className="text-sm font-bold">Total · {totalDuration} min</p>
                    <p className="text-sm font-black">{fmtBRL(totalPrice)}</p>
                  </div>
                  <Button type="button" className="w-full" disabled={busy} onClick={submit}>
                    {busy ? "Confirmando…" : "Confirmar horário"}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
