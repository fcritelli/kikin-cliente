import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * LGPD Art. 18, VIII — o titular precisa saber que pode NÃO consentir e o que muda se não consentir.
 *
 * O opt-in de WhatsApp e as notificações push são consentimentos separados do contrato: recusar não
 * pode custar o serviço. O texto vive em `web/src/lib/lgpdCopy.ts` (fonte única) e precisa aparecer
 * em TODOS os pontos de coleta — se alguém adicionar uma tela nova com opt-in, este teste avisa.
 */
const raizWeb = [path.resolve(process.cwd(), "..", "web"), path.resolve(process.cwd(), "web")].find((c) =>
  existsSync(c)
) as string;

const TELAS_COM_OPTIN = [
  "src/pages/AuthPage.tsx",
  "src/pages/OAuthCallback.tsx",
  "src/pages/SalonBookingPage.tsx",
  "src/components/BookingModal.tsx",
];

describe("Art. 18, VIII — aviso nos pontos de opt-in", () => {
  it("existe a fonte única do texto, com as duas notas", () => {
    const fonte = readFileSync(path.join(raizWeb, "src/lib/lgpdCopy.ts"), "utf8");
    expect(fonte).toContain("WHATSAPP_OPTIN_OPTIONAL_NOTE");
    expect(fonte).toContain("PUSH_OPTIN_OPTIONAL_NOTE");
    // a nota precisa dizer que a recusa NÃO tira o serviço
    expect(fonte).toMatch(/não marcar, continua agendando/i);
    expect(fonte).toMatch(/Art. 18, VIII/);
  });

  for (const tela of TELAS_COM_OPTIN) {
    it(`${tela} usa a nota (não escreveu a sua própria)`, () => {
      const src = readFileSync(path.join(raizWeb, tela), "utf8");
      expect(src).toContain("WHATSAPP_OPTIN_OPTIONAL_NOTE");
      expect(src).toMatch(/from "@\/lib\/lgpdCopy"/);
    });
  }
});
