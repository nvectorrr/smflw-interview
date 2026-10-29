import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./operator.css";
import "./workspace-states.css";
import "./result-review.css";
import "./classifier-layout.css";
import "./dropdown.css";
import "./theme.css";
import "./team-controls.css";
import "./motion.css";
import "./workspace-layout.css";
import { initializeTheme } from "./lib/theme";

initializeTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
