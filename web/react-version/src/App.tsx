import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import ForgotPassword from "./pages/ForgotPassword.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Account from "./pages/Account.tsx";
import TauriFloatingWidget from "./pages/TauriFloatingWidget.tsx";
import Landing from "./pages/Landing.tsx";
import About from "./pages/About.tsx";
import MeetTheTeam from "./pages/MeetTheTeam.tsx";

function isTauriWidgetUrl() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("widget") === "1";
}

function hasSession() {
  // Check for real JWT token instead of fake session object
  return !!sessionStorage.getItem("access_token");
}

function Protected({ children }: { children: React.ReactNode }) {
  return hasSession() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  if (isTauriWidgetUrl()) {
    return <TauriFloatingWidget />;
  }

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/about" element={<About />} />
      <Route path="/team" element={<MeetTheTeam />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route path="/account" element={<Account />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
