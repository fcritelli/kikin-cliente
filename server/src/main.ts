import { app, config } from "./index.js";

if (process.env.NODE_ENV !== "test") {
  app.listen(config.PORT, () => {
    console.log(`🚀 kikin-cliente server rodando na porta ${config.PORT}`);
  });
}
