import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Home } from "./pages/Home";
import { AuthPage } from "./pages/AuthPage";
import { OAuthCallback } from "./pages/OAuthCallback";
import { AccountPage } from "./pages/AccountPage";
import { AgendarPage } from "./pages/AgendarPage";
import { LegalPage } from "./pages/LegalPage";

function ProtectedAccount() {
  const { authed, booting } = useAuth();
  if (booting) return null; // boot valida sessão salva antes de decidir
  if (!authed) return <Navigate to="/login" replace />;
  return <AccountPage />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<AuthPage key="login" mode="login" />} />
          <Route path="/cadastro" element={<AuthPage key="cadastro" mode="signup" />} />
          <Route path="/auth" element={<OAuthCallback />} />
          <Route path="/agendar/:slug" element={<AgendarPage />} />
          <Route path="/conta" element={<ProtectedAccount />} />
          <Route path="/termos" element={<LegalPage doc="termos" />} />
          <Route path="/privacidade" element={<LegalPage doc="privacidade" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
