import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/inter";
import "./index.css";
import "./brand.css";
import { applyBrand, loadBrand } from "./shell/brand";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

// Before the first paint, so a stored brand never flashes the default one.
applyBrand(loadBrand());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
