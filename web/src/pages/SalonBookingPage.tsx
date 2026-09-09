import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type BookingSalonMeta, type EstablishmentLink } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { BookingModal } from "@/components/BookingModal";
import { Button } from "@/components/ui/Button";

/**
 * Destino do LINK que o estabelecimento envia (ex.: cliente.kikin.com.br/e/<slug>).
 *
 * - Deslogado: o cliente entra/cadastra e volta para cá (next).
 * - Logado: agenda direto neste estabelecimento. Se a conta ainda não é vinculada,
 *   o vínculo nasce do próprio agendamento — o salão aparece no painel na hora
 *   (sem "recuperar cadastro por WhatsApp").
 */
export function SalonBookingPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { account } = useAuth();

  const [salon, setSalon] = useState<BookingSalonMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [links, setLinks] = useState<EstablishmentLink[]>([]);
  const [booking, setBooking] = useState<BookingSalonMeta | null>(null);
  const [justBooked, setJustBooked] = useState(false);

  useEffect(() => {
    let active = true;
    setSalon(null);
    setNotFound(false);
    setLoadError(null);
    api
      .bookingSalon(slug)
      .then((meta) => {
        if (active) setSalon(meta);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setLoadError(err instanceof ApiError ? err.message : "Não foi possível carregar o estabelecimento.");
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!account) return;
    api
      .myLinks()
      .then((r) => setLinks(r.links))
      .catch(() => setLinks([]));
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account) {
    const next = `/e/${slug}`;
    return (
      <Shell>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          {salon && (
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-600/30 bg-blue-600/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">
              Agendamento online
            </span>
          )}
          {notFound ? (
            <>
              <h1 className="mt-4 text-2xl font-black uppercase tracking-tight">Estabelecimento não encontrado</h1>
              <p className="mt-2 max-w-md text-sm text-black/60">Confira o link com o estabelecimento.</p>
            </>
          ) : loadError ? (
            <>
              <h1 className="mt-4 text-2xl font-black uppercase tracking-tight">Ops…</h1>
              <p className="mt-2 max-w-md text-sm text-black/60">{loadError}</p>
            </>
          ) : !salon ? (
            <p className="text-sm text-black/50">Carregando…</p>
          ) : (
            <>
              <h1 className="mt-4 text-3xl font-display font-semibold tracking-tight sm:text-4xl">{salon.name}</h1>
              <p className="mt-3 max-w-md text-sm text-black/60">
                Entre na sua conta para agendar direto na agenda real de <b>{salon.name}</b> — veja os horários
                disponíveis e confirme em segundos.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" onClick={() => navigate(`/login?next=${encodeURIComponent(next)}`)}>
                  Entrar e agendar
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate(`/cadastro?next=${encodeURIComponent(next)}`)}>
                  Criar minha conta
                </Button>
              </div>
              <p className="mt-4 text-xs text-black/50">
                Ao confirmar, seu cadastro neste estabelecimento é vinculado automaticamente ao seu painel.
              </p>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const link = (salon && links.find((l) => l.salonId === salon.id)) || null;

  return (
    <Shell
      right={
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-black/50">{account.email}</span>
          <Button variant="outline" size="sm" onClick={() => navigate("/conta")}>
            Meu painel
          </Button>
        </div>
      }
    >
      <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
        {notFound ? (
          <>
            <h1 className="text-2xl font-black uppercase tracking-tight">Estabelecimento não encontrado</h1>
            <p className="mt-2 max-w-md text-sm text-black/60">Confira o link com o estabelecimento.</p>
          </>
        ) : loadError ? (
          <>
            <h1 className="text-2xl font-black uppercase tracking-tight">Ops…</h1>
            <p className="mt-2 max-w-md text-sm text-black/60">{loadError}</p>
          </>
        ) : salon?.online_booking_enabled === false ? (
          <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/5 text-2xl">🔒</div>
            <h2 className="mt-4 text-xl font-black uppercase tracking-tight">Agendamento indisponível no momento</h2>
            <p className="mt-3 text-sm leading-relaxed text-black/60">
              Este estabelecimento ainda não ativou a Área do Cliente. Tente novamente mais tarde.
            </p>
            <Button variant="outline" className="mt-6 w-full" onClick={() => navigate("/")}>
              Voltar
            </Button>
          </div>
        ) : !salon ? (
          <p className="text-sm text-black/50">Carregando…</p>
        ) : justBooked ? (
          <div className="w-full max-w-md rounded-2xl border border-green-600/30 bg-green-50 p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl">✅</div>
            <h2 className="mt-4 text-xl font-black uppercase tracking-tight">Horário garantido!</h2>
            <p className="mt-3 text-sm leading-relaxed text-black/70">
              {link
                ? "Seu novo horário já aparece no painel."
                : "Seu cadastro neste estabelecimento foi vinculado automaticamente — ele já aparece no seu painel."}
            </p>
            <div className="mt-6 grid gap-2">
              <Button className="w-full" onClick={() => navigate("/conta")}>
                Ver no painel
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setJustBooked(false)}>
                Agendar outro horário
              </Button>
            </div>
          </div>
        ) : (
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-600/30 bg-blue-600/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">
              Agendamento online
            </span>
            <h1 className="mt-4 text-3xl font-display font-semibold tracking-tight sm:text-4xl">{salon.name}</h1>
            <p className="mt-3 max-w-md text-sm text-black/60">
              {link
                ? "Escolha serviço, profissional e horário na agenda real do estabelecimento."
                : "Já é cliente? Seu cadastro aqui é vinculado automaticamente quando você confirmar o horário."}
            </p>
            <Button size="lg" className="mt-7" onClick={() => setBooking(salon)}>
              Agendar agora
            </Button>
          </>
        )}
      </div>

      {booking && (
        <BookingModal
          salon={booking}
          linkedClient={(() => {
            const l = links.find((x) => x.salonId === booking.id);
            return l ? { clientId: l.kikinClientId } : null;
          })()}
          onClose={() => setBooking(null)}
          onSuccess={() => {
            setBooking(null);
            setJustBooked(true);
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-white text-black">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-6 w-6 object-contain" />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-70">cliente</span>
          </span>
        </Link>
        {right}
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
