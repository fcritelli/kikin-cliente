import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  ApiError,
  type BookPayload,
  type BookingSalonMeta,
  type BookingService,
  type BookingSlot,
  type BookingStaff,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/utils";

type Step = "servicos" | "profissionais" | "horario" | "dados" | "feito";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function nextDays(count: number): string[] {
  const days: string[] = [];
  const base = new Date();
  // começa amanhã
  base.setDate(base.getDate() + 1);
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const wd = date.toLocaleDateString("pt-BR", { weekday: "short" });
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${wd}, ${day}`;
}

const BOOKING_CONTEXT_KEY = "kc_booking_link";

/**
 * Agendamento pelo portal — mesmo fluxo do /agendar antigo do Kikin:
 * serviços → profissional → data/horário (disponibilidade real) → dados → confirmar.
 * Depois de confirmar: conta logada vincula na hora; convidado é convidado a criar
 * conta (o contexto salão+telefone fica guardado p/ vínculo automático).
 */
export function AgendarPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { account } = useAuth();

  const [salon, setSalon] = useState<BookingSalonMeta | null>(null);
  const [services, setServices] = useState<BookingService[]>([]);
  const [staff, setStaff] = useState<BookingStaff[]>([]);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("servicos");
  const [selectedServices, setSelectedServices] = useState<BookingService[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Awaited<ReturnType<typeof api.bookingBook>> | null>(null);

  const serviceIds = useMemo(() => selectedServices.map((s) => s.id), [selectedServices]);

  // ---- carrega salão/serviços (e profissionais quando houver serviços)
  useEffect(() => {
    (async () => {
      try {
        const [s, svc] = await Promise.all([api.bookingSalon(slug), api.bookingServices(slug)]);
        if (!s.online_booking_enabled) {
          setLoadError("O agendamento online está temporariamente desativado para este estabelecimento.");
        } else {
          setSalon(s);
          setServices(svc);
        }
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Estabelecimento não encontrado.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const toggleService = (svc: BookingService) => {
    setStep("profissionais");
    setError(null);
    setSelectedServices((prev) =>
      prev.some((s) => s.id === svc.id) ? prev.filter((s) => s.id !== svc.id) : [...prev, svc]
    );
  };

  // Carrega profissionais sempre que muda a seleção de serviços
  useEffect(() => {
    if (serviceIds.length === 0) return;
    setStaffId(null);
    setTime("");
    api
      .bookingStaff(slug, serviceIds)
      .then(setStaff)
      .catch(() => setStaff([]));
  }, [serviceIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickStaff = (id: string | null) => {
    setStaffId(id);
    setTime("");
    setStep("horario");
  };

  const pickDate = (d: string) => {
    setDate(d);
    setTime("");
  };

  // Busca horários quando há data (+ profissionais carregados)
  useEffect(() => {
    if (!date || serviceIds.length === 0) return;
    api
      .bookingSlots(slug, { date, serviceIds, staffId })
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [date, serviceIds.join(","), staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTime = (t: string) => {
    setTime(t);
    setStep("dados");
  };

  const totalDuration = selectedServices.reduce((acc, s) => acc + (s.duration_min || 0), 0);
  const totalPrice = selectedServices.reduce((acc, s) => acc + (s.price || 0), 0);

  const submit = async () => {
    if (clientName.trim().length < 2) return setError("Informe seu nome.");
    const phoneDigits = clientPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) return setError("Informe um telefone com DDD válido.");
    if (!date || !time) return setError("Escolha data e horário.");
    setError(null);
    setBooking(true);
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const startAt = new Date(y, m - 1, d, hh, mm).toISOString();
    const payload: BookPayload = {
      serviceIds,
      staffId,
      startAt,
      clientName: clientName.trim(),
      clientPhone: phoneDigits,
      whatsappOptIn,
    };
    try {
      const result = await api.bookingBook(slug, payload);
      setDone(result);
      // Conta logada → vínculo automático com o salão deste agendamento
      if (account && salon) {
        try {
          await api.autoLink({ salonId: salon.id, phone: phoneDigits, whatsappOptIn });
        } catch {
          // se o vínculo falhar (raro), o claim normal no /conta resolve
        }
      } else {
        // Convidado: guarda o contexto (salão + telefone + opt-in) para criar a conta já vinculada
        sessionStorage.setItem(BOOKING_CONTEXT_KEY, JSON.stringify({ salonId: salon?.id, phone: phoneDigits, whatsappOptIn }));
      }
      setStep("feito");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível confirmar o horário.");
    } finally {
      setBooking(false);
    }
  };

  const goConta = () => navigate("/conta");
  const createAccount = () => navigate("/cadastro");

  return (
    <div className="min-h-screen w-full bg-white text-black flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-black/10">
        <Link to="/" className="flex items-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-6 w-6 object-contain" />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-70">cliente</span>
          </span>
        </Link>
        <nav className="text-[11px] font-bold uppercase tracking-wider">
          {account ? (
            <Button variant="outline" size="sm" onClick={goConta}>
              Minha conta
            </Button>
          ) : (
            <Link to="/login" className="rounded-full border-2 border-black px-4 py-2 hover:bg-black hover:text-white transition-colors">
              Entrar
            </Link>
          )}
        </nav>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-10">
        {loading ? (
          <p className="text-sm text-black/50">Carregando…</p>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-red-700">{loadError}</p>
            <Button variant="outline" className="mt-6" onClick={() => navigate("/")}>
              Voltar para a home
            </Button>
          </div>
        ) : step === "feito" && done ? (
          /* ---- Confirmação ---- */
          <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8 text-center shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)]">
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 flex items-center justify-center text-2xl">
              ✅
            </div>
            <h1 className="mt-4 text-2xl font-black uppercase tracking-tight">Horário garantido!</h1>
            <p className="mt-2 text-sm text-black/60">{salon?.name}</p>
            <div className="mt-6 rounded-xl border border-black/10 bg-black/[0.02] px-5 py-4 text-left space-y-1">
              {done.appointments.map((a) => (
                <p key={a.appointment_id} className="text-sm">
                  <b>{a.service_name}</b> · {new Date(a.start_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                </p>
              ))}
              <p className="text-xs text-black/50">Com {done.staff_name}</p>
            </div>

            {account ? (
              <Button className="mt-6 w-full" onClick={goConta}>
                Ver meus agendamentos
              </Button>
            ) : (
              <div className="mt-6">
                <Button className="w-full" onClick={createAccount}>
                  Criar conta e acompanhar
                </Button>
                <p className="mt-2 text-xs text-black/50">
                  Use o mesmo telefone — vinculamos este salão à sua conta automaticamente.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Salão + passo a passo */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight">{salon?.name}</h1>
                {salon?.city && <p className="text-xs text-black/50">{salon.city} · {salon.state}</p>}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                {step} · passo {["servicos", "profissionais", "horario", "dados"].indexOf(step) + 1} de 4
              </div>
            </div>

            {error && (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            {step === "servicos" && (
              <section className="mt-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/50">
                  Escolha um ou mais serviços
                </p>
                <div className="mt-3 grid gap-2.5">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s)}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all cursor-pointer",
                        selectedServices.some((x) => x.id === s.id)
                          ? "border-blue-600 bg-blue-50"
                          : "border-black/10 bg-white hover:border-black/30"
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
                    <p className="text-sm text-black/60">
                      {selectedServices.length} serviço(s) · {totalDuration} min
                    </p>
                    <Button size="sm" onClick={() => setStep("profissionais")}>
                      Continuar →
                    </Button>
                  </div>
                )}
              </section>
            )}

            {step === "profissionais" && (
              <section className="mt-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/50">
                  Profissional (opcional)
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => pickStaff(null)}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all cursor-pointer",
                      staffId === null ? "border-blue-600 bg-blue-50" : "border-black/10 hover:border-black/30"
                    )}
                  >
                    Sem preferência
                  </button>
                  {staff.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickStaff(p.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all cursor-pointer",
                        staffId === p.id ? "border-blue-600 bg-blue-50" : "border-black/10 hover:border-black/30"
                      )}
                    >
                      <span className="text-sm font-bold">{p.name}</span>
                    </button>
                  ))}
                  {staff.length === 0 && (
                    <p className="text-sm text-black/50">Nenhum profissional disponível para os serviços escolhidos.</p>
                  )}
                </div>
              </section>
            )}

            {step === "horario" && (
              <section className="mt-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/50">Escolha dia e horário</p>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  {nextDays(14).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => pickDate(d)}
                      className={cn(
                        "shrink-0 rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-wide transition-all cursor-pointer",
                        date === d ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 hover:border-black/40"
                      )}
                    >
                      {formatDayLabel(d)}
                    </button>
                  ))}
                </div>
                {date && (
                  <div className="mt-5">
                    {slots.length === 0 ? (
                      <p className="text-sm text-black/50">Nenhum horário disponível neste dia.</p>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                        {slots.map((slot) => {
                          const available = !staffId || slot.available_staff.includes(staffId);
                          return (
                            <button
                              key={slot.start_at}
                              type="button"
                              disabled={!available}
                              onClick={() => pickTime(slot.start_at)}
                              className={cn(
                                "rounded-lg border py-2 text-sm font-bold transition-all cursor-pointer",
                                time === slot.start_at
                                  ? "border-blue-600 bg-blue-600 text-white"
                                  : "border-black/15 hover:border-blue-600",
                                !available && "opacity-30 cursor-not-allowed"
                              )}
                            >
                              {slot.start_at}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {step === "dados" && (
              <section className="mt-6">
                <div className="rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm">
                  <p className="font-bold">{selectedServices.map((s) => s.name).join(" + ")}</p>
                  <p className="text-black/60">
                    {new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} às {time}
                    {" · "}{staff.find((p) => p.id === staffId)?.name || "sem preferência"}
                  </p>
                </div>
                <div className="mt-6 grid gap-4">
                  <div>
                    <Label htmlFor="bk-name">Nome</Label>
                    <Input id="bk-name" autoComplete="name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Seu nome" />
                  </div>
                  <div>
                    <Label htmlFor="bk-phone">Seu WhatsApp (com DDD)</Label>
                    <Input id="bk-phone" type="tel" inputMode="tel" autoComplete="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="(11) 98765-4321" />
                  </div>
                  <label className="flex items-start gap-2.5 text-xs leading-relaxed text-black/60 cursor-pointer">
                    <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                    <span>
                      Confirmo que este número é meu WhatsApp e aceito receber a confirmação do
                      agendamento e lembretes por ele.
                    </span>
                  </label>
                  <div className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3">
                    <p className="text-sm font-bold">Total · {totalDuration} min</p>
                    <p className="text-sm font-black">{fmtBRL(totalPrice)}</p>
                  </div>
                  <Button type="button" className="w-full" disabled={booking} onClick={submit}>
                    {booking ? "Confirmando…" : "Confirmar horário"}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export { BOOKING_CONTEXT_KEY };
