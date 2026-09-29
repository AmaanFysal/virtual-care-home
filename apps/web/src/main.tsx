import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connect } from "./net";
import { select } from "./selection";
import { useView } from "./store";
import "./styles.css";

connect();

// ?select=<person id>&follow=1 opens the inspector on someone (handy for demos and links).
const params = new URLSearchParams(location.search);
const wanted = params.get("select");
if (wanted) {
  const stop = useView.subscribe((state) => {
    if (!state.people[wanted]) return;
    stop();
    useView.setState({ following: params.get("follow") === "1" });
    select(wanted);
  });
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
