import { app, config } from "./index.js";
import { startRealtimeRelay } from "./modules/realtime/realtime.service.js";

if (process.env.NODE_ENV !== "test") {
  app.listen(config.PORT, () => {
    console.log(`🚀 kikin-cliente server rodando na porta ${config.PORT}`);
    // Realtime: conecta ao stream interno de eventos do Kikin (reconecta sozinho).
    startRealtimeRelay();
  });
}
